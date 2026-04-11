use crate::connection::types::ConnectionConfig;
use crate::db::{ColumnDef, QueryColumnMeta, QueryResult};
use serde_json::{json, Map, Value};
use sqlx::{mysql::MySqlPoolOptions, Column, Executor, MySqlPool, Row, TypeInfo};
use std::time::{Duration, Instant};

const DEFAULT_PAGE_SIZE: u32 = 100;

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
        "SELECT column_name, data_type, (is_nullable = 'YES') AS nullable, column_default AS default_value, (extra LIKE '%auto_increment%') AS is_auto_increment FROM information_schema.columns WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position",
    )
    .bind(schema)
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|error| error.to_string())
}

pub async fn execute_query(
    pool: &MySqlPool,
    query: &str,
    page: Option<u32>,
    page_size: Option<u32>,
) -> Result<QueryResult, String> {
    execute_query_inner(
        pool,
        query,
        page.unwrap_or(1),
        page_size.unwrap_or(DEFAULT_PAGE_SIZE),
    )
    .await
}

async fn execute_query_inner<'e, E>(
    executor: E,
    query: &str,
    page: u32,
    page_size: u32,
) -> Result<QueryResult, String>
where
    E: Executor<'e, Database = sqlx::MySql> + Copy,
{
    let trimmed = query.trim();
    let started_at = Instant::now();
    let normalized_page = page.max(1);
    let normalized_page_size = page_size.clamp(1, 1_000);
    let offset = u64::from(normalized_page - 1) * u64::from(normalized_page_size);

    let execution = async {
        if is_paginable_result_query(trimmed) {
            let paged_sql = format!(
                "SELECT * FROM ({trimmed}) AS blacktable_page LIMIT {normalized_page_size} OFFSET {offset}"
            );
            let count_sql =
                format!("SELECT COUNT(*) AS blacktable_total FROM ({trimmed}) AS blacktable_count");

            let rows = sqlx::query(&paged_sql)
                .fetch_all(executor)
                .await
                .map_err(|error| error.to_string())?;
            let total_rows = sqlx::query_scalar::<_, i64>(&count_sql)
                .fetch_one(executor)
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
            let column_meta = rows
                .first()
                .map(|row| {
                    row.columns()
                        .iter()
                        .map(|column| QueryColumnMeta {
                            name: column.name().to_string(),
                            data_type: column.type_info().name().to_string(),
                        })
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
                column_meta,
                rows,
                execution_time: started_at.elapsed().as_millis() as u64,
                summary: None,
                total_rows: Some(total_rows.max(0) as u64),
                page: Some(normalized_page),
                page_size: Some(normalized_page_size),
            })
        } else if is_result_set_query(trimmed) {
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
            let column_meta = rows
                .first()
                .map(|row| {
                    row.columns()
                        .iter()
                        .map(|column| QueryColumnMeta {
                            name: column.name().to_string(),
                            data_type: column.type_info().name().to_string(),
                        })
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
                column_meta,
                rows,
                execution_time: started_at.elapsed().as_millis() as u64,
                summary: None,
                total_rows: None,
                page: None,
                page_size: None,
            })
        } else {
            let result = sqlx::query(trimmed)
                .execute(executor)
                .await
                .map_err(|error| error.to_string())?;

            Ok(QueryResult {
                columns: vec!["Rows Affected".into()],
                column_meta: vec![QueryColumnMeta {
                    name: "Rows Affected".into(),
                    data_type: "BIGINT".into(),
                }],
                rows: vec![json!({ "Rows Affected": result.rows_affected() })],
                execution_time: started_at.elapsed().as_millis() as u64,
                summary: None,
                total_rows: None,
                page: None,
                page_size: None,
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

fn is_paginable_result_query(query: &str) -> bool {
    let upper = query.trim_start().to_uppercase();
    upper.starts_with("SELECT") || upper.starts_with("WITH")
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
