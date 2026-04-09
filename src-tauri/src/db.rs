use crate::connection::types::{ConnectionConfig, DatabaseEngine};
use crate::engines::{mysql, oracle, postgres};
use crate::ssh::tunnel::{start_ssh_tunnel, SshTunnelHandle};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{MySqlPool, PgPool};
use std::collections::HashMap;
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

    let result = match config.engine {
        DatabaseEngine::Postgres => {
            let url = build_connection_url(&config, &host, port)?;
            postgres::test_connection(&url).await
        }
        DatabaseEngine::Mysql => {
            let url = build_connection_url(&config, &host, port)?;
            mysql::test_connection(&url).await
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

    let pool = match config.engine {
        DatabaseEngine::Postgres => {
            let url = build_connection_url(&config, &host, port)?;
            ConnectionPool::Postgres(postgres::open_connection(&url).await?)
        }
        DatabaseEngine::Mysql => {
            let url = build_connection_url(&config, &host, port)?;
            ConnectionPool::Mysql(mysql::open_connection(&url).await?)
        }
        DatabaseEngine::Oracle => {
            let oracle_handle = oracle::create_handle(&config, &host, port)?;
            ConnectionPool::Oracle(oracle::open_connection(&oracle_handle).await?)
        }
    };

    let managed = ManagedConnection { pool, tunnel };

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
    conn_id: String,
    query: String,
) -> Result<QueryResult, String> {
    match get_connection_pool(&state, &conn_id).await? {
        ConnectionPool::Postgres(pool) => postgres::execute_query(&pool, &query).await,
        ConnectionPool::Mysql(pool) => mysql::execute_query(&pool, &query).await,
        ConnectionPool::Oracle(connection) => oracle::execute_query(&connection, &query).await,
    }
}
