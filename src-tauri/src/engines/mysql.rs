use crate::connection::types::ConnectionConfig;
use crate::db::{ColumnDef, QueryResult};
use serde_json::{json, Map, Value};
use sqlx::{mysql::MySqlPoolOptions, Column, Executor, MySqlPool, Row};
use std::time::{Duration, Instant};

pub fn build_connection_url(
    config: &ConnectionConfig,
    host: &str,
    port: u16,
) -> Result<String, String> {
    let password = config.password.as_deref().unwrap_or("");
    let database = config.database_name()?;

    Ok(format!(
        "mysql://{}:{}@{}:{}/{}",
        config.user, password, host, port, database
    ))
}

pub async fn test_connection(url: &str, timeout_seconds: u64) -> Result<(), String> {
    let connection = MySqlPool::connect(url);

    match tokio::time::timeout(Duration::from_secs(timeout_seconds), connection).await {
        Ok(Ok(pool)) => {
            pool.close().await;
            Ok(())
        }
        Ok(Err(error)) => Err(format!("Connection failed: {error}")),
        Err(_) => Err(format!("Connection timed out after {timeout_seconds} seconds")),
    }
}

pub async fn open_connection(url: &str, timeout_seconds: u64) -> Result<MySqlPool, String> {
    MySqlPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(Duration::from_secs(timeout_seconds))
        .idle_timeout(Duration::from_secs(60))
        .test_before_acquire(true)
        .connect(url)
        .await
        .map_err(|error| format!("Failed to open MySQL connection: {error}"))
}

pub async fn list_databases(pool: &MySqlPool) -> Result<Vec<String>, String> {
    sqlx::query_scalar::<_, String>("SHOW DATABASES")
        .fetch_all(pool)
        .await
        .map_err(|error| error.to_string())
}

pub async fn list_schemas(pool: &MySqlPool) -> Result<Vec<String>, String> {
    sqlx::query_scalar::<_, String>(
        "SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| error.to_string())
}

pub async fn list_tables(pool: &MySqlPool, schema: &str) -> Result<Vec<String>, String> {
    sqlx::query_scalar::<_, String>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE'",
    )
    .bind(schema)
    .fetch_all(pool)
    .await
    .map_err(|error| error.to_string())
}

pub async fn list_columns(
    pool: &MySqlPool,
    schema: &str,
    table: &str,
) -> Result<Vec<ColumnDef>, String> {
    sqlx::query_as::<_, ColumnDef>(
        "SELECT column_name, data_type, (is_nullable = 'YES') AS nullable, column_default AS default_value FROM information_schema.columns WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position",
    )
    .bind(schema)
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|error| error.to_string())
}

pub async fn execute_query(pool: &MySqlPool, query: &str) -> Result<QueryResult, String> {
    execute_query_inner(pool, query).await
}

async fn execute_query_inner<'e, E>(executor: E, query: &str) -> Result<QueryResult, String>
where
    E: Executor<'e, Database = sqlx::MySql>,
{
    let trimmed = query.trim();
    let started_at = Instant::now();

    let execution = async {
        if is_result_set_query(trimmed) {
            let rows = sqlx::query(trimmed)
                .fetch_all(executor)
                .await
                .map_err(|error| error.to_string())?;

            let columns = rows
                .first()
                .map(|row| {
                    row.columns()
                        .iter()
                        .map(|column| column.name().to_string())
                        .collect()
                })
                .unwrap_or_else(Vec::new);

            let rows = rows
                .iter()
                .map(|row| {
                    let mut object = Map::new();
                    for (index, column) in row.columns().iter().enumerate() {
                        object.insert(column.name().to_string(), mysql_value_to_json(row, index));
                    }
                    Value::Object(object)
                })
                .collect();

            Ok(QueryResult {
                columns,
                rows,
                execution_time: started_at.elapsed().as_millis() as u64,
                summary: None,
            })
        } else {
            let result = sqlx::query(trimmed)
                .execute(executor)
                .await
                .map_err(|error| error.to_string())?;

            Ok(QueryResult {
                columns: vec!["Rows Affected".into()],
                rows: vec![json!({ "Rows Affected": result.rows_affected() })],
                execution_time: started_at.elapsed().as_millis() as u64,
                summary: None,
            })
        }
    };

    match tokio::time::timeout(Duration::from_secs(30), execution).await {
        Ok(result) => result,
        Err(_) => Err("Query timed out after 30 seconds.".into()),
    }
}

fn is_result_set_query(query: &str) -> bool {
    let upper = query.trim_start().to_uppercase();
    upper.starts_with("SELECT")
        || upper.starts_with("WITH")
        || upper.starts_with("SHOW")
        || upper.starts_with("EXPLAIN")
        || upper.starts_with("DESCRIBE")
}

fn mysql_value_to_json(row: &sqlx::mysql::MySqlRow, index: usize) -> Value {
    if let Ok(value) = row.try_get::<Option<bool>, _>(index) {
        return value.map(Value::Bool).unwrap_or(Value::Null);
    }
    if let Ok(value) = row.try_get::<Option<i64>, _>(index) {
        return value.map(Value::from).unwrap_or(Value::Null);
    }
    if let Ok(value) = row.try_get::<Option<i32>, _>(index) {
        return value.map(Value::from).unwrap_or(Value::Null);
    }
    if let Ok(value) = row.try_get::<Option<u64>, _>(index) {
        return value.map(Value::from).unwrap_or(Value::Null);
    }
    if let Ok(value) = row.try_get::<Option<f64>, _>(index) {
        return value.map(Value::from).unwrap_or(Value::Null);
    }
    if let Ok(value) = row.try_get::<Option<f32>, _>(index) {
        return value
            .map(|item| Value::from(item as f64))
            .unwrap_or(Value::Null);
    }
    if let Ok(value) = row.try_get::<Option<String>, _>(index) {
        return value.map(Value::String).unwrap_or(Value::Null);
    }

    Value::String("<unsupported>".into())
}
