use crate::connection::types::{ConnectionConfig, DatabaseEngine};
use crate::engines::{mysql, oracle, postgres};
use crate::history::model::{NewQueryHistoryItem, QueryHistoryFilter, QueryHistoryItem};
use crate::history::service::HistoryState;
use crate::ssh::tunnel::{start_ssh_tunnel, SshTunnelHandle};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{MySqlPool, PgPool};
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::sync::Mutex;

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct ColumnDef {
    pub column_name: String,
    pub data_type: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Value>,
    pub execution_time: u64,
}

#[derive(Clone)]
pub enum ConnectionPool {
    Postgres(PgPool),
    Mysql(MySqlPool),
    Oracle(oracle::OracleConnectionHandle),
}

pub struct ManagedConnection {
    config: ConnectionConfig,
    pool: ConnectionPool,
    tunnel: Option<SshTunnelHandle>,
}

impl ManagedConnection {
    async fn close(self) {
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
pub async fn execute_query(
    state: tauri::State<'_, DbState>,
    history: tauri::State<'_, HistoryState>,
    conn_id: String,
    query: String,
) -> Result<ExecuteQueryPayload, String> {
    let pool = get_connection_pool(&state, &conn_id).await?;
    let execution = match pool {
        ConnectionPool::Postgres(pool) => postgres::execute_query(&pool, &query).await,
        ConnectionPool::Mysql(pool) => mysql::execute_query(&pool, &query).await,
        ConnectionPool::Oracle(connection) => oracle::execute_query(&connection, &query).await,
    };

    let now = now_iso_like();
    let history_item_id = new_history_id();
    let connection_details = resolve_connection_history_details(&state, &conn_id).await?;

    match execution {
        Ok(result) => {
            let row_count = i64::try_from(result.rows.len()).unwrap_or(i64::MAX);
            history
                .record(NewQueryHistoryItem {
                    id: history_item_id.clone(),
                    connection_id: conn_id,
                    connection_name: connection_details.0,
                    database_name: connection_details.1,
                    schema_name: None,
                    query_text: query.trim().to_string(),
                    executed_at: now,
                    duration_ms: Some(i64::try_from(result.execution_time).unwrap_or(i64::MAX)),
                    status: "success".into(),
                    error_message: None,
                    row_count: Some(row_count),
                })
                .await?;

            Ok(ExecuteQueryPayload {
                result,
                history_item_id,
            })
        }
        Err(error) => {
            history
                .record(NewQueryHistoryItem {
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
                })
                .await?;

            Err(error)
        }
    }
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
