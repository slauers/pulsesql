use crate::connection::types::{ConnectionConfig, DatabaseEngine};
use crate::engines::{mysql, oracle, postgres};
use crate::history::model::{NewQueryHistoryItem, QueryHistoryFilter, QueryHistoryItem};
use crate::history::service::HistoryState;
use crate::ssh::tunnel::{start_ssh_tunnel, SshTunnelHandle};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{pool::PoolConnection, MySql, MySqlPool, PgPool, Postgres};
use std::collections::HashMap;
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct ColumnDef {
    pub column_name: String,
    pub data_type: String,
    pub nullable: Option<bool>,
    pub default_value: Option<String>,
    pub is_auto_increment: Option<bool>,
    pub is_primary_key: Option<bool>,
    pub is_foreign_key: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct QueryColumnMeta {
    pub name: String,
    pub data_type: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub column_meta: Vec<QueryColumnMeta>,
    pub rows: Vec<Value>,
    pub execution_time: u64,
    pub summary: Option<String>,
    pub total_rows: Option<u64>,
    pub page: Option<u32>,
    pub page_size: Option<u32>,
}

#[derive(Clone)]
pub enum ConnectionPool {
    Postgres(PgPool),
    Mysql(MySqlPool),
    Oracle(oracle::OracleConnectionHandle),
}

pub enum ActiveTransactionConnection {
    Postgres(PoolConnection<Postgres>),
    Mysql(PoolConnection<MySql>),
}

pub struct ManagedConnection {
    config: ConnectionConfig,
    pool: ConnectionPool,
    tunnel: Option<SshTunnelHandle>,
    autocommit_enabled: bool,
    transaction: Option<ActiveTransactionConnection>,
}

impl ManagedConnection {
    async fn close(self) {
        drop(self.transaction);

        match self.pool {
            ConnectionPool::Postgres(pool) => pool.close().await,
            ConnectionPool::Mysql(pool) => pool.close().await,
            ConnectionPool::Oracle(_) => {}
        }

        if let Some(tunnel) = self.tunnel {
            tunnel.stop();
        }
    }
}

pub struct DbState {
    connections: Mutex<HashMap<String, ManagedConnection>>,
}

impl DbState {
    pub fn new() -> Self {
        Self {
            connections: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExecuteQueryPayload {
    pub result: QueryResult,
    pub history_item_id: String,
    pub autocommit_enabled: bool,
    pub transaction_open: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ServerTimePayload {
    pub value: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ConnectionTransactionStatePayload {
    pub autocommit_enabled: bool,
    pub transaction_open: bool,
    pub supported: bool,
}

fn resolve_runtime_target(
    config: &ConnectionConfig,
) -> Result<(String, u16, Option<SshTunnelHandle>), String> {
    if config.ssh.as_ref().is_some_and(|ssh| ssh.enabled) {
        let tunnel = start_ssh_tunnel(config)?;
        return Ok(("127.0.0.1".into(), tunnel.local_port(), Some(tunnel)));
    }

    Ok((config.host.clone(), config.port, None))
}

fn build_connection_url(
    config: &ConnectionConfig,
    host: &str,
    port: u16,
) -> Result<String, String> {
    match config.engine {
        DatabaseEngine::Postgres => postgres::build_connection_url(config, host, port),
        DatabaseEngine::Mysql => mysql::build_connection_url(config, host, port),
        DatabaseEngine::Oracle => Err("Oracle JDBC uses a sidecar runtime, not a SQLx URL".into()),
    }
}

fn connection_pool_from_managed(connection: &ManagedConnection) -> ConnectionPool {
    match &connection.pool {
        ConnectionPool::Postgres(pool) => ConnectionPool::Postgres(pool.clone()),
        ConnectionPool::Mysql(pool) => ConnectionPool::Mysql(pool.clone()),
        ConnectionPool::Oracle(connection) => ConnectionPool::Oracle(connection.clone()),
    }
}

async fn get_connection_pool(
    state: &tauri::State<'_, DbState>,
    conn_id: &str,
) -> Result<ConnectionPool, String> {
    let connections = state.connections.lock().await;
    let connection = connections
        .get(conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    Ok(connection_pool_from_managed(connection))
}

#[tauri::command]
pub async fn test_ssh_tunnel(config: ConnectionConfig) -> Result<String, String> {
    let tunnel = start_ssh_tunnel(&config)?;
    let port = tunnel.local_port();
    tunnel.stop();
    Ok(format!("SSH tunnel ready on local port {port}"))
}

#[tauri::command]
pub async fn test_connection(config: ConnectionConfig) -> Result<String, String> {
    let (host, port, tunnel) = resolve_runtime_target(&config)?;
    let timeout_seconds = config.connect_timeout_seconds();

    let result = match config.engine {
        DatabaseEngine::Postgres => {
            let url = build_connection_url(&config, &host, port)?;
            postgres::test_connection(&url, timeout_seconds).await
        }
        DatabaseEngine::Mysql => {
            let url = build_connection_url(&config, &host, port)?;
            mysql::test_connection(&url, timeout_seconds).await
        }
        DatabaseEngine::Oracle => {
            let oracle_handle = oracle::create_handle(&config, &host, port)?;
            oracle::test_connection(&oracle_handle).await
        }
    };

    if let Some(tunnel) = tunnel {
        tunnel.stop();
    }

    result.map(|_| "Connection successful".into())
}

#[tauri::command]
pub async fn open_connection(
    state: tauri::State<'_, DbState>,
    config: ConnectionConfig,
) -> Result<String, String> {
    let (host, port, tunnel) = resolve_runtime_target(&config)?;
    let timeout_seconds = config.connect_timeout_seconds();

    let pool = match config.engine {
        DatabaseEngine::Postgres => {
            let url = build_connection_url(&config, &host, port)?;
            ConnectionPool::Postgres(postgres::open_connection(&url, timeout_seconds).await?)
        }
        DatabaseEngine::Mysql => {
            let url = build_connection_url(&config, &host, port)?;
            ConnectionPool::Mysql(mysql::open_connection(&url, timeout_seconds).await?)
        }
        DatabaseEngine::Oracle => {
            let oracle_handle = oracle::create_handle(&config, &host, port)?;
            ConnectionPool::Oracle(oracle::open_connection(&oracle_handle).await?)
        }
    };

    let managed = ManagedConnection {
        config: config.clone(),
        pool,
        tunnel,
        autocommit_enabled: true,
        transaction: None,
    };

    let existing = {
        let mut connections = state.connections.lock().await;
        connections.insert(config.id.clone(), managed)
    };

    if let Some(existing) = existing {
        existing.close().await;
    }

    Ok(config.id)
}

#[tauri::command]
pub async fn close_connection(
    state: tauri::State<'_, DbState>,
    id: String,
) -> Result<String, String> {
    let existing = {
        let mut connections = state.connections.lock().await;
        connections.remove(&id)
    };

    match existing {
        Some(connection) => {
            connection.close().await;
            Ok("Connection closed".into())
        }
        None => Err("Connection not found".into()),
    }
}

#[tauri::command]
pub async fn list_databases(
    state: tauri::State<'_, DbState>,
    conn_id: String,
) -> Result<Vec<String>, String> {
    match get_connection_pool(&state, &conn_id).await? {
        ConnectionPool::Postgres(pool) => postgres::list_databases(&pool).await,
        ConnectionPool::Mysql(pool) => mysql::list_databases(&pool).await,
        ConnectionPool::Oracle(connection) => oracle::list_databases(&connection).await,
    }
}

#[tauri::command]
pub async fn list_schemas(
    state: tauri::State<'_, DbState>,
    conn_id: String,
) -> Result<Vec<String>, String> {
    match get_connection_pool(&state, &conn_id).await? {
        ConnectionPool::Postgres(pool) => postgres::list_schemas(&pool).await,
        ConnectionPool::Mysql(pool) => mysql::list_schemas(&pool).await,
        ConnectionPool::Oracle(connection) => oracle::list_schemas(&connection).await,
    }
}

#[tauri::command]
pub async fn list_tables(
    state: tauri::State<'_, DbState>,
    conn_id: String,
    schema: String,
) -> Result<Vec<String>, String> {
    match get_connection_pool(&state, &conn_id).await? {
        ConnectionPool::Postgres(pool) => postgres::list_tables(&pool, &schema).await,
        ConnectionPool::Mysql(pool) => mysql::list_tables(&pool, &schema).await,
        ConnectionPool::Oracle(connection) => oracle::list_tables(&connection, &schema).await,
    }
}

#[tauri::command]
pub async fn list_columns(
    state: tauri::State<'_, DbState>,
    conn_id: String,
    schema: String,
    table: String,
) -> Result<Vec<ColumnDef>, String> {
    match get_connection_pool(&state, &conn_id).await? {
        ConnectionPool::Postgres(pool) => postgres::list_columns(&pool, &schema, &table).await,
        ConnectionPool::Mysql(pool) => mysql::list_columns(&pool, &schema, &table).await,
        ConnectionPool::Oracle(connection) => {
            oracle::list_columns(&connection, &schema, &table).await
        }
    }
}

#[tauri::command]
pub fn execute_query(
    state: tauri::State<'_, DbState>,
    history: tauri::State<'_, HistoryState>,
    conn_id: String,
    query: String,
    page: Option<u32>,
    page_size: Option<u32>,
    known_total_rows: Option<u64>,
) -> Result<ExecuteQueryPayload, String> {
    tauri::async_runtime::block_on(async {
        let t_total = Instant::now();

        // Resolve connection metadata before executing — avoids a second mutex lock after the
        // query completes just to look up the connection name.
        let t_meta = Instant::now();
        let connection_details = resolve_connection_history_details(&state, &conn_id).await?;
        eprintln!("[db] resolve_connection_details: {}ms", t_meta.elapsed().as_millis());

        let t_exec = Instant::now();
        let execution = execute_query_on_managed_connection(
            &state,
            &conn_id,
            &query,
            page,
            page_size,
            known_total_rows,
        )
        .await;
        eprintln!("[db] execute_query_on_managed_connection: {}ms", t_exec.elapsed().as_millis());

        let now = now_iso_like();
        let history_item_id = new_history_id();

        match execution {
            Ok(result) => {
                let row_count =
                    i64::try_from(result.result.total_rows.unwrap_or(result.result.rows.len() as u64))
                        .unwrap_or(i64::MAX);

                // Fire-and-forget: history write does not block the response to the frontend.
                history.record_spawned(NewQueryHistoryItem {
                    id: history_item_id.clone(),
                    connection_id: conn_id,
                    connection_name: connection_details.0,
                    database_name: connection_details.1,
                    schema_name: None,
                    query_text: query.trim().to_string(),
                    executed_at: now,
                    duration_ms: Some(
                        i64::try_from(result.result.execution_time).unwrap_or(i64::MAX),
                    ),
                    status: "success".into(),
                    error_message: None,
                    row_count: Some(row_count),
                });

                let payload = ExecuteQueryPayload {
                    result: result.result,
                    history_item_id,
                    autocommit_enabled: result.autocommit_enabled,
                    transaction_open: result.transaction_open,
                };
                eprintln!("[db] total execute_query command: {}ms", t_total.elapsed().as_millis());
                Ok(payload)
            }
            Err(error) => {
                // Fire-and-forget for error history too.
                history.record_spawned(NewQueryHistoryItem {
                    id: history_item_id.clone(),
                    connection_id: conn_id,
                    connection_name: connection_details.0,
                    database_name: connection_details.1,
                    schema_name: None,
                    query_text: query.trim().to_string(),
                    executed_at: now,
                    duration_ms: None,
                    status: "error".into(),
                    error_message: Some(error.clone()),
                    row_count: None,
                });

                Err(error)
            }
        }
    })
}

#[tauri::command]
pub fn set_connection_autocommit(
    state: tauri::State<'_, DbState>,
    conn_id: String,
    enabled: bool,
) -> Result<ConnectionTransactionStatePayload, String> {
    tauri::async_runtime::block_on(async {
        let mut connections = state.connections.lock().await;
        let connection = connections
            .get_mut(&conn_id)
            .ok_or_else(|| "Connection not found".to_string())?;

        if matches!(connection.pool, ConnectionPool::Oracle(_)) {
            return Err("Autocommit ON/OFF ainda nao esta disponivel para Oracle.".to_string());
        }

        if enabled {
            commit_active_transaction_if_needed(connection).await?;
        }

        connection.autocommit_enabled = enabled;

        Ok(ConnectionTransactionStatePayload {
            autocommit_enabled: connection.autocommit_enabled,
            transaction_open: connection.transaction.is_some(),
            supported: true,
        })
    })
}

#[tauri::command]
pub async fn get_server_time(
    state: tauri::State<'_, DbState>,
    conn_id: String,
) -> Result<ServerTimePayload, String> {
    let pool = get_connection_pool(&state, &conn_id).await?;
    let query = match &pool {
        ConnectionPool::Postgres(_) | ConnectionPool::Mysql(_) => "SELECT NOW()",
        ConnectionPool::Oracle(_) => "SELECT SYSDATE FROM DUAL",
    };

    let result = match pool {
        ConnectionPool::Postgres(pool) => postgres::execute_query(&pool, query, None, None, None).await,
        ConnectionPool::Mysql(pool) => mysql::execute_query(&pool, query, None, None, None).await,
        ConnectionPool::Oracle(connection) => {
            oracle::execute_query(&connection, query, None, None).await
        }
    }?;

    Ok(ServerTimePayload {
        value: extract_server_time_value(&result)?,
    })
}

struct ExecutionWithState {
    result: QueryResult,
    autocommit_enabled: bool,
    transaction_open: bool,
}

async fn execute_query_on_managed_connection(
    state: &tauri::State<'_, DbState>,
    conn_id: &str,
    query: &str,
    page: Option<u32>,
    page_size: Option<u32>,
    known_total_rows: Option<u64>,
) -> Result<ExecutionWithState, String> {
    let pooled_execution = {
        let mut connections = state.connections.lock().await;
        let connection = connections
            .get_mut(conn_id)
            .ok_or_else(|| "Connection not found".to_string())?;

        if connection.autocommit_enabled || matches!(connection.pool, ConnectionPool::Oracle(_)) {
            connection.transaction = None;
            Some((
                connection_pool_from_managed(connection),
                connection.autocommit_enabled,
            ))
        } else {
            None
        }
    };

    if let Some((pool, autocommit_enabled)) = pooled_execution {
        let result = match pool {
            ConnectionPool::Postgres(pool) => {
                postgres::execute_query(&pool, query, page, page_size, known_total_rows).await
            }
            ConnectionPool::Mysql(pool) => {
                mysql::execute_query(&pool, query, page, page_size, known_total_rows).await
            }
            ConnectionPool::Oracle(handle) => {
                oracle::execute_query(&handle, query, page, page_size).await
            }
        }?;

        return Ok(ExecutionWithState {
            result,
            autocommit_enabled,
            transaction_open: false,
        });
    }

    let mut connections = state.connections.lock().await;
    let connection = connections
        .get_mut(conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    let result =
        execute_manual_transaction_query(connection, query, page, page_size, known_total_rows)
            .await?;

    Ok(ExecutionWithState {
        result,
        autocommit_enabled: connection.autocommit_enabled,
        transaction_open: connection.transaction.is_some(),
    })
}

async fn execute_manual_transaction_query(
    connection: &mut ManagedConnection,
    query: &str,
    page: Option<u32>,
    page_size: Option<u32>,
    known_total_rows: Option<u64>,
) -> Result<QueryResult, String> {
    match classify_transaction_statement(query) {
        TransactionStatementKind::Commit => {
            commit_active_transaction_if_needed(connection).await?;
            Ok(build_transaction_summary_result("Transaction committed."))
        }
        TransactionStatementKind::Rollback => {
            rollback_active_transaction_if_needed(connection).await?;
            Ok(build_transaction_summary_result("Transaction rolled back."))
        }
        TransactionStatementKind::Dml => {
            ensure_manual_transaction_started(connection).await?;
            match connection.transaction.as_mut() {
                Some(ActiveTransactionConnection::Postgres(active)) => {
                    postgres::execute_query_on_connection(active, query, page, page_size, known_total_rows).await
                }
                Some(ActiveTransactionConnection::Mysql(active)) => {
                    mysql::execute_query_on_connection(active, query, page, page_size, known_total_rows).await
                }
                _ => Err("Autocommit OFF nao suportado para esta engine.".to_string()),
            }
        }
        TransactionStatementKind::Other => match connection.transaction.as_mut() {
            Some(ActiveTransactionConnection::Postgres(active)) => {
                postgres::execute_query_on_connection(active, query, page, page_size, known_total_rows).await
            }
            Some(ActiveTransactionConnection::Mysql(active)) => {
                mysql::execute_query_on_connection(active, query, page, page_size, known_total_rows).await
            }
            _ => match &connection.pool {
                ConnectionPool::Postgres(pool) => {
                    postgres::execute_query(pool, query, page, page_size, known_total_rows).await
                }
                ConnectionPool::Mysql(pool) => {
                    mysql::execute_query(pool, query, page, page_size, known_total_rows).await
                }
                ConnectionPool::Oracle(handle) => {
                    oracle::execute_query(handle, query, page, page_size).await
                }
            },
        },
    }
}

async fn ensure_manual_transaction_started(connection: &mut ManagedConnection) -> Result<(), String> {
    if connection.transaction.is_some() {
        return Ok(());
    }

    match &connection.pool {
        ConnectionPool::Postgres(pool) => {
            let mut pooled = pool.acquire().await.map_err(|error| error.to_string())?;
            postgres::begin_transaction(&mut pooled).await?;
            connection.transaction = Some(ActiveTransactionConnection::Postgres(pooled));
            Ok(())
        }
        ConnectionPool::Mysql(pool) => {
            let mut pooled = pool.acquire().await.map_err(|error| error.to_string())?;
            mysql::begin_transaction(&mut pooled).await?;
            connection.transaction = Some(ActiveTransactionConnection::Mysql(pooled));
            Ok(())
        }
        ConnectionPool::Oracle(_) => Err("Autocommit OFF nao suportado para esta engine.".to_string()),
    }
}

async fn commit_active_transaction_if_needed(connection: &mut ManagedConnection) -> Result<(), String> {
    if let Some(mut transaction) = connection.transaction.take() {
        match &mut transaction {
            ActiveTransactionConnection::Postgres(active) => postgres::commit_transaction(active).await?,
            ActiveTransactionConnection::Mysql(active) => mysql::commit_transaction(active).await?,
        }
    }

    Ok(())
}

async fn rollback_active_transaction_if_needed(connection: &mut ManagedConnection) -> Result<(), String> {
    if let Some(mut transaction) = connection.transaction.take() {
        match &mut transaction {
            ActiveTransactionConnection::Postgres(active) => postgres::rollback_transaction(active).await?,
            ActiveTransactionConnection::Mysql(active) => mysql::rollback_transaction(active).await?,
        }
    }

    Ok(())
}

enum TransactionStatementKind {
    Commit,
    Rollback,
    Dml,
    Other,
}

fn classify_transaction_statement(query: &str) -> TransactionStatementKind {
    let normalized = query.trim_start().to_uppercase();

    if normalized.starts_with("COMMIT") {
        return TransactionStatementKind::Commit;
    }

    if normalized.starts_with("ROLLBACK") {
        return TransactionStatementKind::Rollback;
    }

    if normalized.starts_with("INSERT")
        || normalized.starts_with("UPDATE")
        || normalized.starts_with("DELETE")
    {
        return TransactionStatementKind::Dml;
    }

    TransactionStatementKind::Other
}

#[tauri::command]
pub async fn list_query_history(
    history: tauri::State<'_, HistoryState>,
    filter: Option<QueryHistoryFilter>,
) -> Result<Vec<QueryHistoryItem>, String> {
    history.list(filter.unwrap_or(QueryHistoryFilter {
        query: None,
        connection_id: None,
        status: None,
        limit: Some(50),
        offset: Some(0),
    }))
    .await
}

#[tauri::command]
pub async fn delete_query_history_item(
    history: tauri::State<'_, HistoryState>,
    id: String,
) -> Result<(), String> {
    history.delete_item(&id).await
}

#[tauri::command]
pub async fn clear_query_history(
    history: tauri::State<'_, HistoryState>,
) -> Result<(), String> {
    history.clear().await
}

async fn resolve_connection_history_details(
    state: &tauri::State<'_, DbState>,
    conn_id: &str,
) -> Result<(String, Option<String>), String> {
    let connections = state.connections.lock().await;
    let connection = connections
        .get(conn_id)
        .ok_or_else(|| "Connection not found".to_string())?;

    Ok((
        connection.config.name.clone(),
        connection.config.database.clone(),
    ))
}

fn new_history_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!("hist-{nanos}")
}

fn now_iso_like() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    millis.to_string()
}

fn extract_server_time_value(result: &QueryResult) -> Result<String, String> {
    let row = result
        .rows
        .first()
        .and_then(Value::as_object)
        .ok_or_else(|| "Failed to decode server time: no row returned".to_string())?;

    let value = row
        .values()
        .find_map(extract_time_fragment)
        .ok_or_else(|| "Failed to decode server time: unsupported value".to_string())?;

    Ok(value)
}

fn extract_time_fragment(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => extract_hms_fragment(text),
        Value::Number(number) => extract_hms_fragment(&number.to_string()),
        _ => None,
    }
}

fn extract_hms_fragment(input: &str) -> Option<String> {
    let bytes = input.as_bytes();
    if bytes.len() < 8 {
        return None;
    }

    for start in 0..=bytes.len() - 8 {
        let candidate = &bytes[start..start + 8];
        if candidate[2] == b':'
            && candidate[5] == b':'
            && candidate[0].is_ascii_digit()
            && candidate[1].is_ascii_digit()
            && candidate[3].is_ascii_digit()
            && candidate[4].is_ascii_digit()
            && candidate[6].is_ascii_digit()
            && candidate[7].is_ascii_digit()
        {
            return Some(input[start..start + 8].to_string());
        }
    }

    None
}

fn build_transaction_summary_result(summary: &str) -> QueryResult {
    QueryResult {
        columns: vec![],
        column_meta: vec![],
        rows: vec![],
        execution_time: 0,
        summary: Some(summary.to_string()),
        total_rows: None,
        page: None,
        page_size: None,
    }
}
