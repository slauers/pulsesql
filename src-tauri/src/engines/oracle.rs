use crate::connection::types::{ConnectionConfig, OracleConnectionType};
use crate::db::{ColumnDef, QueryResult};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;
use std::time::{Instant, SystemTime};
use tauri::{AppHandle, Manager};

const ORACLE_JDBC_VERSION: &str = "23.4.0.24.05";
const ORACLE_JDBC_URL: &str =
    "https://repo.maven.apache.org/maven2/com/oracle/database/jdbc/ojdbc11/23.4.0.24.05/ojdbc11-23.4.0.24.05.jar";
const ORACLE_JAVA_CLASS: &str = "OracleJdbcRunner";
const ORACLE_JAVA_SOURCE: &str = include_str!("../../oracle-jdbc-sidecar/OracleJdbcRunner.java");

static ORACLE_SIDECAR_ROOT: OnceLock<PathBuf> = OnceLock::new();

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
    rows: Option<Vec<Value>>,
    execution_time: Option<u64>,
    column_defs: Option<Vec<ColumnDef>>,
}

#[derive(Debug, Serialize)]
struct OracleRequest<'a> {
    host: &'a str,
    port: u16,
    database: &'a str,
    oracle_connection_type: &'a str,
    user: &'a str,
    password: &'a str,
    oracle_driver_properties: Option<&'a str>,
    query: Option<&'a str>,
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
    invoke_sidecar("test", handle, None, None, None).map(|_| ())
}

pub async fn open_connection(
    handle: &OracleConnectionHandle,
) -> Result<OracleConnectionHandle, String> {
    invoke_sidecar("open", handle, None, None, None)?;
    Ok(handle.clone())
}

pub async fn list_databases(handle: &OracleConnectionHandle) -> Result<Vec<String>, String> {
    let response = invoke_sidecar("listDatabases", handle, None, None, None)?;
    Ok(response.items.unwrap_or_default())
}

pub async fn list_schemas(handle: &OracleConnectionHandle) -> Result<Vec<String>, String> {
    let response = invoke_sidecar("listSchemas", handle, None, None, None)?;
    Ok(response.items.unwrap_or_default())
}

pub async fn list_tables(
    handle: &OracleConnectionHandle,
    schema: &str,
) -> Result<Vec<String>, String> {
    let response = invoke_sidecar("listTables", handle, None, Some(schema), None)?;
    Ok(response.items.unwrap_or_default())
}

pub async fn list_columns(
    handle: &OracleConnectionHandle,
    schema: &str,
    table: &str,
) -> Result<Vec<ColumnDef>, String> {
    let response = invoke_sidecar("listColumns", handle, None, Some(schema), Some(table))?;
    Ok(response.column_defs.unwrap_or_default())
}

pub async fn execute_query(
    handle: &OracleConnectionHandle,
    query: &str,
) -> Result<QueryResult, String> {
    let started_at = Instant::now();
    let response = invoke_sidecar("executeQuery", handle, Some(query), None, None)?;

    Ok(QueryResult {
        columns: response.columns.unwrap_or_default(),
        rows: response.rows.unwrap_or_default(),
        execution_time: response
            .execution_time
            .unwrap_or_else(|| started_at.elapsed().as_millis() as u64),
    })
}

pub fn init_sidecar_root(app: &AppHandle) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve Oracle app data directory: {error}"))?;

    let sidecar_root = app_data_dir.join("oracle-jdbc-sidecar");

    ORACLE_SIDECAR_ROOT
        .set(sidecar_root)
        .map_err(|_| "Oracle sidecar root was already initialized".to_string())
}

fn invoke_sidecar(
    command: &str,
    handle: &OracleConnectionHandle,
    query: Option<&str>,
    schema: Option<&str>,
    table: Option<&str>,
) -> Result<OracleSuccessResponse, String> {
    let sidecar_root = oracle_sidecar_root()?;
    let classes_dir = sidecar_root.join("classes");
    let request_file = sidecar_root.join("request.json");
    let response_file = sidecar_root.join("response.json");
    let stderr_file = sidecar_root.join("stderr.log");

    fs::create_dir_all(&sidecar_root)
        .map_err(|error| format!("Failed to prepare Oracle sidecar directory: {error}"))?;

    ensure_oracle_driver(&sidecar_root)?;
    ensure_oracle_sidecar_compiled(&sidecar_root, &classes_dir)?;

    let request = OracleRequest {
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
        schema,
        table,
    };

    fs::write(
        &request_file,
        serde_json::to_vec(&request)
            .map_err(|error| format!("Failed to encode Oracle request: {error}"))?,
    )
    .map_err(|error| format!("Failed to write Oracle sidecar request: {error}"))?;

    if response_file.exists() {
        let _ = fs::remove_file(&response_file);
    }

    if stderr_file.exists() {
        let _ = fs::remove_file(&stderr_file);
    }

    let classpath = build_classpath(
        &classes_dir,
        &sidecar_root.join(format!("ojdbc11-{ORACLE_JDBC_VERSION}.jar")),
    );

    let output = Command::new("java")
        .arg("-cp")
        .arg(classpath)
        .arg(ORACLE_JAVA_CLASS)
        .arg(command)
        .arg(&request_file)
        .arg(&response_file)
        .output()
        .map_err(|error| format_oracle_java_launch_error("executar", &error.to_string()))?;

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if !output.status.success() {
        let response_error = read_error_response(&response_file);
        let mut parts = vec![];

        if let Some(response_error) = response_error {
            parts.push(response_error);
        }

        if !stderr.is_empty() {
            parts.push(stderr);
        }

        let message = if parts.is_empty() {
            format!("Oracle JDBC sidecar failed with status {}", output.status)
        } else {
            parts.join(" | ")
        };

        return Err(humanize_oracle_sidecar_error(&message));
    }

    let response_bytes = fs::read(&response_file)
        .map_err(|error| format!("Failed to read Oracle sidecar response: {error}"))?;

    let response_json: Value = serde_json::from_slice(&response_bytes)
        .map_err(|error| format!("Failed to decode Oracle sidecar response: {error}"))?;

    if let Some(error) = response_json.get("error").and_then(Value::as_str) {
        return Err(error.to_string());
    }

    serde_json::from_value(response_json)
        .map_err(|error| format!("Failed to parse Oracle sidecar payload: {error}"))
}

fn read_error_response(response_file: &Path) -> Option<String> {
    let bytes = fs::read(response_file).ok()?;
    let value = serde_json::from_slice::<Value>(&bytes).ok()?;
    value
        .get("error")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
}

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

    let output = Command::new("javac")
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

    let output = Command::new("curl")
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
    format!("{}:{}", classes_dir.display(), jar_path.display())
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

    let current_dir = std::env::current_dir()
        .map_err(|error| format!("Failed to resolve current directory: {error}"))?;

    Ok(current_dir.join("target").join("oracle-jdbc-sidecar"))
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
            "Conexao Oracle requer Java/JDK instalado e disponivel para o aplicativo.",
            "Instale um JDK e configure o macOS para encontrá-lo fora do terminal.",
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

    normalized.to_string()
}

fn format_oracle_java_launch_error(action: &str, details: &str) -> String {
    format!(
        "Nao foi possivel {action} o runtime Oracle porque o Java/JDK nao esta disponivel para o aplicativo. Detalhe tecnico: {details}"
    )
}
