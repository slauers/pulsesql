use crate::cmd::background;
use crate::connection::types::{ConnectionConfig, OracleConnectionType};
use crate::db::{ColumnDef, QueryColumnMeta, QueryResult};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::ffi::OsString;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, ChildStdout, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::{Instant, SystemTime};
use std::{fs, io};
use tauri::{AppHandle, Manager};

const ORACLE_JDBC_VERSION: &str = "23.4.0.24.05";
const ORACLE_JDBC_URL: &str =
    "https://repo.maven.apache.org/maven2/com/oracle/database/jdbc/ojdbc11/23.4.0.24.05/ojdbc11-23.4.0.24.05.jar";
const ORACLE_JAVA_CLASS: &str = "OracleJdbcRunner";
const ORACLE_JAVA_SOURCE: &str = include_str!("../../oracle-jdbc-sidecar/OracleJdbcRunner.java");

static ORACLE_SIDECAR_ROOT: OnceLock<PathBuf> = OnceLock::new();

/// Long-lived Java sidecar process. Shared across all Oracle connections for a session.
/// Access is serialised through the Mutex so requests are never interleaved.
static SIDECAR_PROCESS: OnceLock<Mutex<Option<SidecarProcess>>> = OnceLock::new();

struct SidecarProcess {
    child: Child,
    stdin: io::BufWriter<ChildStdin>,
    stdout: BufReader<ChildStdout>,
}

fn sidecar_mutex() -> &'static Mutex<Option<SidecarProcess>> {
    SIDECAR_PROCESS.get_or_init(|| Mutex::new(None))
}

#[derive(Debug, Clone)]
pub struct OracleConnectionHandle {
    pub host: String,
    pub port: u16,
    pub database: String,
    pub connection_type: OracleConnectionType,
    pub user: String,
    pub password: String,
    pub driver_properties: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct OracleSuccessResponse {
    message: Option<String>,
    items: Option<Vec<String>>,
    columns: Option<Vec<String>>,
    column_meta: Option<Vec<QueryColumnMeta>>,
    rows: Option<Vec<Value>>,
    execution_time: Option<u64>,
    summary: Option<String>,
    total_rows: Option<u64>,
    page: Option<u32>,
    page_size: Option<u32>,
    column_defs: Option<Vec<ColumnDef>>,
}

/// Request sent to the persistent sidecar over stdin (one JSON line per call).
#[derive(Debug, Serialize)]
struct OracleRequest<'a> {
    command: &'a str,
    host: &'a str,
    port: u16,
    database: &'a str,
    oracle_connection_type: &'a str,
    user: &'a str,
    password: &'a str,
    oracle_driver_properties: Option<&'a str>,
    query: Option<&'a str>,
    page: Option<u32>,
    page_size: Option<u32>,
    schema: Option<&'a str>,
    table: Option<&'a str>,
}

pub fn create_handle(
    config: &ConnectionConfig,
    host: &str,
    port: u16,
) -> Result<OracleConnectionHandle, String> {
    let timeout_millis = config.connect_timeout_seconds() * 1000;

    Ok(OracleConnectionHandle {
        host: host.to_string(),
        port,
        database: config.database_name()?.to_string(),
        connection_type: config
            .oracle_connection_type
            .clone()
            .unwrap_or(OracleConnectionType::ServiceName),
        user: config.user.clone(),
        password: config.password.clone().unwrap_or_default(),
        driver_properties: Some(merge_driver_properties(
            config.oracle_driver_properties.as_deref(),
            &[
                ("oracle.net.CONNECT_TIMEOUT", timeout_millis.to_string()),
                ("oracle.jdbc.ReadTimeout", (timeout_millis * 3).to_string()),
            ],
        )),
    })
}

pub async fn test_connection(handle: &OracleConnectionHandle) -> Result<(), String> {
    invoke_sidecar("test", handle, None, None, None, None, None).map(|_| ())
}

pub async fn open_connection(
    handle: &OracleConnectionHandle,
) -> Result<OracleConnectionHandle, String> {
    invoke_sidecar("open", handle, None, None, None, None, None)?;
    Ok(handle.clone())
}

pub async fn list_databases(handle: &OracleConnectionHandle) -> Result<Vec<String>, String> {
    let response = invoke_sidecar("listDatabases", handle, None, None, None, None, None)?;
    Ok(response.items.unwrap_or_default())
}

pub async fn list_schemas(handle: &OracleConnectionHandle) -> Result<Vec<String>, String> {
    let response = invoke_sidecar("listSchemas", handle, None, None, None, None, None)?;
    Ok(response.items.unwrap_or_default())
}

pub async fn list_tables(
    handle: &OracleConnectionHandle,
    schema: &str,
) -> Result<Vec<String>, String> {
    let response = invoke_sidecar("listTables", handle, None, None, None, Some(schema), None)?;
    Ok(response.items.unwrap_or_default())
}

pub async fn list_columns(
    handle: &OracleConnectionHandle,
    schema: &str,
    table: &str,
) -> Result<Vec<ColumnDef>, String> {
    let response = invoke_sidecar("listColumns", handle, None, None, None, Some(schema), Some(table))?;
    Ok(response.column_defs.unwrap_or_default())
}

pub async fn execute_query(
    handle: &OracleConnectionHandle,
    query: &str,
    page: Option<u32>,
    page_size: Option<u32>,
) -> Result<QueryResult, String> {
    let started_at = Instant::now();
    let response = invoke_sidecar(
        "executeQuery",
        handle,
        Some(query),
        page,
        page_size,
        None,
        None,
    )?;

    Ok(QueryResult {
        columns: response.columns.unwrap_or_default(),
        column_meta: response.column_meta.unwrap_or_default(),
        rows: response.rows.unwrap_or_default(),
        execution_time: response
            .execution_time
            .unwrap_or_else(|| started_at.elapsed().as_millis() as u64),
        summary: response.summary,
        total_rows: response.total_rows,
        page: response.page,
        page_size: response.page_size,
    })
}

pub fn sidecar_root() -> Result<PathBuf, String> {
    oracle_sidecar_root()
}

pub fn init_sidecar_root(app: &AppHandle) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .or_else(|_| app.path().app_local_data_dir())
        .or_else(|_| std::env::current_dir())
        .map_err(|error| format!("Failed to resolve Oracle app data directory: {error}"))?;

    let sidecar_root = app_data_dir.join("oracle-jdbc-sidecar");

    ORACLE_SIDECAR_ROOT
        .set(sidecar_root)
        .map_err(|_| "Oracle sidecar root was already initialized".to_string())
}

// ---------------------------------------------------------------------------
// Core invocation — persistent stdin/stdout process
// ---------------------------------------------------------------------------

fn invoke_sidecar(
    command: &str,
    handle: &OracleConnectionHandle,
    query: Option<&str>,
    page: Option<u32>,
    page_size: Option<u32>,
    schema: Option<&str>,
    table: Option<&str>,
) -> Result<OracleSuccessResponse, String> {
    let sidecar_root = oracle_sidecar_root()?;
    let classes_dir = sidecar_root.join("classes");

    fs::create_dir_all(&sidecar_root)
        .map_err(|error| format!("Failed to prepare Oracle sidecar directory: {error}"))?;

    ensure_oracle_driver(&sidecar_root)?;
    ensure_oracle_sidecar_compiled(&sidecar_root, &classes_dir)?;

    let request = OracleRequest {
        command,
        host: &handle.host,
        port: handle.port,
        database: &handle.database,
        oracle_connection_type: match handle.connection_type {
            OracleConnectionType::ServiceName => "serviceName",
            OracleConnectionType::Sid => "sid",
        },
        user: &handle.user,
        password: &handle.password,
        oracle_driver_properties: handle.driver_properties.as_deref(),
        query,
        page,
        page_size,
        schema,
        table,
    };

    let request_json = serde_json::to_string(&request)
        .map_err(|error| format!("Failed to encode Oracle request: {error}"))?;

    // First attempt — use or start the persistent JVM process.
    let result = call_persistent_sidecar(&sidecar_root, &classes_dir, &request_json);

    match result {
        Ok(response) => Ok(response),
        Err(io_error) => {
            // The process may have crashed. Kill it, clear the slot and retry once.
            let mutex = sidecar_mutex();
            if let Ok(mut guard) = mutex.lock() {
                if let Some(ref mut proc) = *guard {
                    let _ = proc.child.kill();
                    let _ = proc.child.wait();
                }
                *guard = None;
            }

            call_persistent_sidecar(&sidecar_root, &classes_dir, &request_json)
                .map_err(|_| humanize_oracle_sidecar_error(&io_error))
        }
    }
}

/// Writes one JSON request line to the sidecar's stdin and reads one response line from stdout.
fn call_persistent_sidecar(
    sidecar_root: &Path,
    classes_dir: &Path,
    request_json: &str,
) -> Result<OracleSuccessResponse, String> {
    let mutex = sidecar_mutex();
    let mut guard = mutex
        .lock()
        .map_err(|_| "Oracle sidecar mutex poisoned".to_string())?;

    if guard.is_none() {
        *guard = Some(start_sidecar_server(sidecar_root, classes_dir)?);
    }

    let proc = guard.as_mut().unwrap();

    // Send request line.
    proc.stdin
        .write_all(request_json.as_bytes())
        .and_then(|_| proc.stdin.write_all(b"\n"))
        .and_then(|_| proc.stdin.flush())
        .map_err(|error| format!("Failed to write to Oracle sidecar: {error}"))?;

    // Read response line.
    let mut response_line = String::new();
    proc.stdout
        .read_line(&mut response_line)
        .map_err(|error| format!("Failed to read from Oracle sidecar: {error}"))?;

    if response_line.is_empty() {
        return Err("Oracle sidecar closed its stdout unexpectedly".to_string());
    }

    let response_json: Value = serde_json::from_str(response_line.trim())
        .map_err(|error| format!("Failed to decode Oracle sidecar response: {error}"))?;

    if let Some(error) = response_json.get("error").and_then(Value::as_str) {
        return Err(error.to_string());
    }

    serde_json::from_value(response_json)
        .map_err(|error| format!("Failed to parse Oracle sidecar payload: {error}"))
}

/// Spawns a new long-lived Java sidecar process in `--server` mode.
fn start_sidecar_server(sidecar_root: &Path, classes_dir: &Path) -> Result<SidecarProcess, String> {
    let classpath = build_classpath(
        classes_dir,
        &sidecar_root.join(format!("ojdbc11-{ORACLE_JDBC_VERSION}.jar")),
    );

    let java_exe = crate::jdk::get_java_exe(sidecar_root);
    let mut child = background(java_exe)
        .arg("-cp")
        .arg(classpath)
        .arg(ORACLE_JAVA_CLASS)
        .arg("--server")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|error| format_oracle_java_launch_error("iniciar", &error.to_string()))?;

    let stdin = io::BufWriter::new(
        child
            .stdin
            .take()
            .ok_or_else(|| "Failed to capture Oracle sidecar stdin".to_string())?,
    );
    let stdout = BufReader::new(
        child
            .stdout
            .take()
            .ok_or_else(|| "Failed to capture Oracle sidecar stdout".to_string())?,
    );

    Ok(SidecarProcess { child, stdin, stdout })
}

// ---------------------------------------------------------------------------
// Setup helpers
// ---------------------------------------------------------------------------

fn ensure_oracle_sidecar_compiled(sidecar_root: &Path, classes_dir: &Path) -> Result<(), String> {
    let source_path = ensure_oracle_java_source(sidecar_root)?;
    let class_file = classes_dir.join(format!("{ORACLE_JAVA_CLASS}.class"));

    let should_compile =
        !class_file.exists() || file_mtime(&source_path)? > file_mtime(&class_file)?;

    if !should_compile {
        return Ok(());
    }

    fs::create_dir_all(classes_dir)
        .map_err(|error| format!("Failed to create Oracle sidecar classes directory: {error}"))?;

    let classpath = sidecar_root.join(format!("ojdbc11-{ORACLE_JDBC_VERSION}.jar"));

    let javac_exe = crate::jdk::get_javac_exe(sidecar_root);
    let output = background(javac_exe)
        .arg("-cp")
        .arg(classpath)
        .arg("-d")
        .arg(classes_dir)
        .arg(&source_path)
        .output()
        .map_err(|error| format_oracle_java_launch_error("compilar", &error.to_string()))?;

    if !output.status.success() {
        return Err(humanize_oracle_sidecar_error(&format!(
            "Failed to compile Oracle JDBC sidecar: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }

    // If the source was recompiled while the old server process is running, kill it so the
    // next invocation picks up the freshly compiled class.
    let mutex = sidecar_mutex();
    if let Ok(mut guard) = mutex.lock() {
        if let Some(ref mut proc) = *guard {
            let _ = proc.child.kill();
            let _ = proc.child.wait();
        }
        *guard = None;
    }

    Ok(())
}

fn ensure_oracle_java_source(sidecar_root: &Path) -> Result<PathBuf, String> {
    let source_path = sidecar_root.join(format!("{ORACLE_JAVA_CLASS}.java"));
    let should_write = match fs::read_to_string(&source_path) {
        Ok(existing) => existing != ORACLE_JAVA_SOURCE,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => true,
        Err(error) => {
            return Err(format!(
                "Failed to read Oracle sidecar source from {}: {error}",
                source_path.display()
            ));
        }
    };

    if should_write {
        fs::write(&source_path, ORACLE_JAVA_SOURCE).map_err(|error| {
            format!(
                "Failed to write Oracle sidecar source to {}: {error}",
                source_path.display()
            )
        })?;
    }

    Ok(source_path)
}

fn ensure_oracle_driver(sidecar_root: &Path) -> Result<(), String> {
    let jar_path = sidecar_root.join(format!("ojdbc11-{ORACLE_JDBC_VERSION}.jar"));

    if jar_path.exists() {
        return Ok(());
    }

    let temp_path = sidecar_root.join(format!("ojdbc11-{ORACLE_JDBC_VERSION}.jar.download"));

    let output = background("curl")
        .arg("-fL")
        .arg(ORACLE_JDBC_URL)
        .arg("-o")
        .arg(&temp_path)
        .output()
        .map_err(|error| format!("Failed to start Oracle JDBC download: {error}"))?;

    if !output.status.success() {
        return Err(format!(
            "Failed to download Oracle JDBC driver: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    fs::rename(&temp_path, &jar_path)
        .map_err(|error| format!("Failed to finalize Oracle JDBC driver download: {error}"))?;

    Ok(())
}

fn build_classpath(classes_dir: &Path, jar_path: &Path) -> String {
    std::env::join_paths([classes_dir, jar_path])
        .unwrap_or_else(|_| {
            let mut fallback = OsString::from(classes_dir.as_os_str());
            let separator = if cfg!(windows) { ";" } else { ":" };
            fallback.push(separator);
            fallback.push(jar_path.as_os_str());
            fallback
        })
        .to_string_lossy()
        .into_owned()
}

fn merge_driver_properties(
    user_properties: Option<&str>,
    defaults: &[(&str, String)],
) -> String {
    let mut lines = vec![];

    for (key, value) in defaults {
        let user_overrode = user_properties.is_some_and(|properties| {
            properties
                .lines()
                .map(str::trim)
                .any(|line| line.starts_with(&format!("{key}=")))
        });

        if !user_overrode {
            lines.push(format!("{key}={value}"));
        }
    }

    if let Some(user_properties) = user_properties {
        let trimmed = user_properties.trim();
        if !trimmed.is_empty() {
            lines.push(trimmed.to_string());
        }
    }

    lines.join("\n")
}

fn oracle_sidecar_root() -> Result<PathBuf, String> {
    if let Some(path) = ORACLE_SIDECAR_ROOT.get() {
        return Ok(path.clone());
    }

    let fallback_root = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf))
        .or_else(|| std::env::current_dir().ok())
        .map(|root| root.join("oracle-jdbc-sidecar"))
        .ok_or_else(|| "Failed to resolve Oracle sidecar directory".to_string())?;

    Ok(fallback_root)
}

fn file_mtime(path: &Path) -> Result<SystemTime, String> {
    fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .map_err(|error| {
            format!(
                "Failed to inspect file metadata for {}: {error}",
                path.display()
            )
        })
}

fn humanize_oracle_sidecar_error(message: &str) -> String {
    let normalized = message.trim();
    let lower = normalized.to_lowercase();

    if lower.contains("unable to locate a java runtime")
        || lower.contains("failed to run javac for oracle sidecar")
        || lower.contains("failed to run oracle jdbc sidecar")
        || lower.contains("failed to compile oracle jdbc sidecar")
    {
        return [
            "Java/JDK nao disponivel para o aplicativo.",
            "Use o botao 'Instalar JDK' no formulario de conexao Oracle para instalar automaticamente.",
            "Detalhe tecnico:",
            normalized,
        ]
        .join(" ");
    }

    if lower.contains("failed to download oracle jdbc driver") {
        return [
            "Nao foi possivel preparar o driver Oracle JDBC.",
            "Verifique sua conexao com a internet ou regras de proxy/firewall.",
            "Detalhe tecnico:",
            normalized,
        ]
        .join(" ");
    }

    // Java version too old to load ojdbc11 (requires Java 11+)
    if lower.contains("unsupported class file major version")
        || lower.contains("has been compiled by a more recent version")
    {
        return [
            "Versao do Java incompativel com o driver Oracle (ojdbc11 requer Java 11+).",
            "Use o botao 'Instalar JDK' para instalar o JDK Eclipse Temurin 21 automaticamente.",
            "Detalhe tecnico:",
            normalized,
        ]
        .join(" ");
    }

    normalized.to_string()
}

fn format_oracle_java_launch_error(action: &str, details: &str) -> String {
    format!(
        "Java/JDK nao disponivel para {action} o runtime Oracle. Use o botao 'Instalar JDK' no formulario de conexao Oracle. Detalhe: {details}"
    )
}
