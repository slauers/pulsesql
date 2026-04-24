use crate::connection::types::ConnectionConfig;
use crate::db::{ColumnDef, QueryColumnMeta, QueryResult};
use serde_json::{json, Value};
use sqlx::{
    pool::PoolConnection, postgres::PgConnection, postgres::PgPoolOptions, raw_sql, Column,
    PgPool, Postgres, Row, TypeInfo,
};
use std::time::{Duration, Instant};

const DEFAULT_PAGE_SIZE: u32 = 100;
const QUERY_TIMEOUT_SECONDS: u64 = 30;

pub fn build_connection_url(
    config: &ConnectionConfig,
    host: &str,
    port: u16,
) -> Result<String, String> {
    let password = config.password.as_deref().unwrap_or("");
    let database = config.database_name()?;

    Ok(format!(
        "postgres://{}:{}@{}:{}/{}?sslmode={}",
        config.user,
        password,
        host,
        port,
        database,
        config.postgres_ssl_mode()
    ))
}

pub async fn test_connection(url: &str, timeout_seconds: u64) -> Result<(), String> {
    let connection = PgPool::connect(url);

    match tokio::time::timeout(Duration::from_secs(timeout_seconds), connection).await {
        Ok(Ok(pool)) => {
            pool.close().await;
            Ok(())
        }
        Ok(Err(error)) => Err(format!("Connection failed: {error}")),
        Err(_) => Err(format!("Connection timed out after {timeout_seconds} seconds")),
    }
}

pub async fn open_connection(url: &str, timeout_seconds: u64) -> Result<PgPool, String> {
    PgPoolOptions::new()
        .max_connections(5)
        .min_connections(2)
        .acquire_timeout(Duration::from_secs(timeout_seconds))
        .idle_timeout(Duration::from_secs(300))
        .max_lifetime(Duration::from_secs(3600))
        .test_before_acquire(false)
        .connect(url)
        .await
        .map_err(|error| format!("Failed to open PostgreSQL connection: {error}"))
}

pub async fn list_databases(pool: &PgPool) -> Result<Vec<String>, String> {
    sqlx::query_scalar::<_, String>("SELECT datname FROM pg_database WHERE datistemplate = false")
        .persistent(false)
        .fetch_all(pool)
        .await
        .map_err(|error| error.to_string())
}

pub async fn list_schemas(pool: &PgPool) -> Result<Vec<String>, String> {
    sqlx::query_scalar::<_, String>(
        "SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_toast')",
    )
    .persistent(false)
    .fetch_all(pool)
    .await
    .map_err(|error| error.to_string())
}

pub async fn list_tables(pool: &PgPool, schema: &str) -> Result<Vec<String>, String> {
    sqlx::query_scalar::<_, String>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE'",
    )
    .bind(schema)
    .persistent(false)
    .fetch_all(pool)
    .await
    .map_err(|error| error.to_string())
}

pub async fn list_columns(
    pool: &PgPool,
    schema: &str,
    table: &str,
) -> Result<Vec<ColumnDef>, String> {
    sqlx::query_as::<_, ColumnDef>(
        "SELECT c.column_name, c.data_type, (c.is_nullable = 'YES') AS nullable, c.column_default AS default_value, (c.column_default ILIKE 'nextval(%') AS is_auto_increment, (pk.column_name IS NOT NULL) AS is_primary_key, (fk.column_name IS NOT NULL) AS is_foreign_key FROM information_schema.columns c LEFT JOIN (SELECT kcu.column_name FROM information_schema.key_column_usage kcu JOIN information_schema.table_constraints tc ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema AND tc.table_name = kcu.table_name WHERE tc.constraint_type = 'PRIMARY KEY' AND kcu.table_schema = $1 AND kcu.table_name = $2) pk ON pk.column_name = c.column_name LEFT JOIN (SELECT kcu.column_name FROM information_schema.key_column_usage kcu JOIN information_schema.table_constraints tc ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema AND tc.table_name = kcu.table_name WHERE tc.constraint_type = 'FOREIGN KEY' AND kcu.table_schema = $1 AND kcu.table_name = $2) fk ON fk.column_name = c.column_name WHERE c.table_schema = $1 AND c.table_name = $2 ORDER BY c.ordinal_position",
    )
    .bind(schema)
    .bind(table)
    .persistent(false)
    .fetch_all(pool)
    .await
    .map_err(|error| error.to_string())
}

pub async fn execute_query(
    pool: &PgPool,
    query: &str,
    page: Option<u32>,
    page_size: Option<u32>,
    known_total_rows: Option<u64>,
) -> Result<QueryResult, String> {
    execute_query_on_pool(
        pool,
        query,
        page.unwrap_or(1),
        page_size.unwrap_or(DEFAULT_PAGE_SIZE),
        known_total_rows,
    )
    .await
}

pub async fn execute_query_on_connection(
    connection: &mut PoolConnection<Postgres>,
    query: &str,
    page: Option<u32>,
    page_size: Option<u32>,
    known_total_rows: Option<u64>,
) -> Result<QueryResult, String> {
    execute_query_on_active_connection(
        connection.as_mut(),
        query,
        page.unwrap_or(1),
        page_size.unwrap_or(DEFAULT_PAGE_SIZE),
        known_total_rows,
    )
    .await
}

pub async fn begin_transaction(connection: &mut PoolConnection<Postgres>) -> Result<(), String> {
    raw_sql("BEGIN")
        .execute(connection.as_mut())
        .await
        .map(|_| ())
        .map_err(|error| error.to_string())
}

pub async fn commit_transaction(connection: &mut PoolConnection<Postgres>) -> Result<(), String> {
    raw_sql("COMMIT")
        .execute(connection.as_mut())
        .await
        .map(|_| ())
        .map_err(|error| error.to_string())
}

pub async fn rollback_transaction(connection: &mut PoolConnection<Postgres>) -> Result<(), String> {
    raw_sql("ROLLBACK")
        .execute(connection.as_mut())
        .await
        .map(|_| ())
        .map_err(|error| error.to_string())
}

async fn execute_query_on_pool(
    pool: &PgPool,
    query: &str,
    page: u32,
    page_size: u32,
    known_total_rows: Option<u64>,
) -> Result<QueryResult, String> {
    let trimmed = query.trim();
    let started_at = Instant::now();
    let normalized_page = page.max(1);
    let normalized_page_size = page_size.clamp(1, 1_000);
    let offset = u64::from(normalized_page - 1) * u64::from(normalized_page_size);

    let execution = async {
        if is_paginable_result_query(trimmed) {
            let count_sql =
                format!("SELECT COUNT(*) AS blacktable_total FROM ({trimmed}) AS blacktable_count");

            let data_sql = format!(
                "SELECT to_jsonb(blacktable_page) AS __blacktable_json, blacktable_page.*
                 FROM ({trimmed}) AS blacktable_page
                 LIMIT {normalized_page_size} OFFSET {offset}"
            );

            // Run COUNT and data queries in parallel.
            // When total rows is already known (page navigation), skip the COUNT query.
            let t_queries = Instant::now();
            let (total_rows, rows_raw) = tokio::try_join!(
                async {
                    match known_total_rows {
                        Some(known) => Ok::<i64, String>(known as i64),
                        None => fetch_total_rows_on_pool(pool, &count_sql).await,
                    }
                },
                async {
                    raw_sql(&data_sql)
                        .fetch_all(pool)
                        .await
                        .map_err(|error| error.to_string())
                },
            )?;
            eprintln!("[pg] parallel COUNT+data: {}ms", t_queries.elapsed().as_millis());

            let t_decode = Instant::now();
            let (columns, column_meta) = extract_columns_and_meta_from_jsonb(&rows_raw);
            let rows = decode_jsonb_rows(rows_raw)?;
            eprintln!("[pg] decode+meta: {}ms | total: {}ms", t_decode.elapsed().as_millis(), started_at.elapsed().as_millis());

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
            let data_sql = format!(
                "SELECT to_jsonb(blacktable_row) AS __blacktable_json, blacktable_row.*
                 FROM ({trimmed}) AS blacktable_row"
            );

            let t_query = Instant::now();
            let rows_raw = raw_sql(&data_sql)
                .fetch_all(pool)
                .await
                .map_err(|error| error.to_string())?;
            eprintln!("[pg] SHOW/EXPLAIN data: {}ms", t_query.elapsed().as_millis());

            let (columns, column_meta) = extract_columns_and_meta_from_jsonb(&rows_raw);
            let rows = decode_jsonb_rows(rows_raw)?;

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
            let result = raw_sql(trimmed)
                .execute(pool)
                .await
                .map_err(|error| error.to_string())?;

            Ok(build_command_result(
                trimmed,
                result.rows_affected(),
                started_at.elapsed().as_millis() as u64,
            ))
        }
    };

    match tokio::time::timeout(Duration::from_secs(QUERY_TIMEOUT_SECONDS), execution).await {
        Ok(result) => result,
        Err(_) => Err(format!(
            "Query timed out after {QUERY_TIMEOUT_SECONDS} seconds."
        )),
    }
}

async fn execute_query_on_active_connection(
    connection: &mut PgConnection,
    query: &str,
    page: u32,
    page_size: u32,
    known_total_rows: Option<u64>,
) -> Result<QueryResult, String> {
    let trimmed = query.trim();
    let started_at = Instant::now();
    let normalized_page = page.max(1);
    let normalized_page_size = page_size.clamp(1, 1_000);
    let offset = u64::from(normalized_page - 1) * u64::from(normalized_page_size);

    let execution = async {
        if is_paginable_result_query(trimmed) {
            let count_sql =
                format!("SELECT COUNT(*) AS blacktable_total FROM ({trimmed}) AS blacktable_count");

            let data_sql = format!(
                "SELECT to_jsonb(blacktable_page) AS __blacktable_json, blacktable_page.*
                 FROM ({trimmed}) AS blacktable_page
                 LIMIT {normalized_page_size} OFFSET {offset}"
            );

            // Single connection — cannot parallelize; skip COUNT when already known.
            let total_rows = match known_total_rows {
                Some(known) => known as i64,
                None => fetch_total_rows_on_connection(connection, &count_sql).await?,
            };

            let rows_raw = raw_sql(&data_sql)
                .fetch_all(&mut *connection)
                .await
                .map_err(|error| error.to_string())?;

            let (columns, column_meta) = extract_columns_and_meta_from_jsonb(&rows_raw);
            let rows = decode_jsonb_rows(rows_raw)?;

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
            let data_sql = format!(
                "SELECT to_jsonb(blacktable_row) AS __blacktable_json, blacktable_row.*
                 FROM ({trimmed}) AS blacktable_row"
            );

            let rows_raw = raw_sql(&data_sql)
                .fetch_all(&mut *connection)
                .await
                .map_err(|error| error.to_string())?;

            let (columns, column_meta) = extract_columns_and_meta_from_jsonb(&rows_raw);
            let rows = decode_jsonb_rows(rows_raw)?;

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
            let result = raw_sql(trimmed)
                .execute(&mut *connection)
                .await
                .map_err(|error| error.to_string())?;

            Ok(build_command_result(
                trimmed,
                result.rows_affected(),
                started_at.elapsed().as_millis() as u64,
            ))
        }
    };

    match tokio::time::timeout(Duration::from_secs(QUERY_TIMEOUT_SECONDS), execution).await {
        Ok(result) => result,
        Err(_) => Err(format!(
            "Query timed out after {QUERY_TIMEOUT_SECONDS} seconds."
        )),
    }
}

async fn fetch_total_rows_on_pool(pool: &PgPool, sql: &str) -> Result<i64, String> {
    let rows = raw_sql(sql)
        .fetch_all(pool)
        .await
        .map_err(|error| error.to_string())?;

    let row = rows
        .first()
        .ok_or_else(|| "Failed to decode PostgreSQL total row count: no rows returned".to_string())?;

    row.try_get::<i64, _>("blacktable_total")
        .map_err(|error| format!("Failed to decode PostgreSQL total row count: {error}"))
}

async fn fetch_total_rows_on_connection(
    connection: &mut PgConnection,
    sql: &str,
) -> Result<i64, String> {
    let rows = raw_sql(sql)
        .fetch_all(&mut *connection)
        .await
        .map_err(|error| error.to_string())?;

    let row = rows
        .first()
        .ok_or_else(|| "Failed to decode PostgreSQL total row count: no rows returned".to_string())?;

    row.try_get::<i64, _>("blacktable_total")
        .map_err(|error| format!("Failed to decode PostgreSQL total row count: {error}"))
}

fn build_command_result(query: &str, rows_affected: u64, execution_time: u64) -> QueryResult {
    if is_do_block(query) {
        return QueryResult {
            columns: Vec::new(),
            column_meta: Vec::new(),
            rows: Vec::new(),
            execution_time,
            summary: Some(
                "Bloco DO executado com sucesso. RAISE NOTICE e emitido pelo PostgreSQL como notice do servidor; ele nao retorna linhas no result set."
                    .into(),
            ),
            total_rows: None,
            page: None,
            page_size: None,
        };
    }

    QueryResult {
        columns: vec!["Rows Affected".into()],
        column_meta: vec![QueryColumnMeta {
            name: "Rows Affected".into(),
            data_type: "BIGINT".into(),
        }],
        rows: vec![json!({ "Rows Affected": rows_affected })],
        execution_time,
        summary: None,
        total_rows: None,
        page: None,
        page_size: None,
    }
}

fn decode_jsonb_rows(rows: Vec<sqlx::postgres::PgRow>) -> Result<Vec<Value>, String> {
    rows.into_iter()
        .map(|row| match row.try_get::<Value, _>("__blacktable_json") {
            Ok(value) => Ok(value),
            Err(error) => Err(format!("Failed to decode PostgreSQL row JSON: {error}")),
        })
        .collect()
}

/// Extracts column names and type metadata from the actual PostgreSQL row metadata.
/// This preserves the original SELECT order; reading keys from the JSON payload would
/// alphabetize them because the JSON object map does not keep insertion order here.
fn extract_columns_and_meta_from_jsonb(
    rows: &[sqlx::postgres::PgRow],
) -> (Vec<String>, Vec<QueryColumnMeta>) {
    let Some(first) = rows.first() else {
        return (Vec::new(), Vec::new());
    };

    let columns: Vec<String> = first
        .columns()
        .iter()
        .filter(|column| column.name() != "__blacktable_json")
        .map(|column| column.name().to_string())
        .collect();

    let column_meta: Vec<QueryColumnMeta> = first
        .columns()
        .iter()
        .filter(|column| column.name() != "__blacktable_json")
        .map(|column| QueryColumnMeta {
            name: column.name().to_string(),
            data_type: column.type_info().name().to_string(),
        })
        .collect();

    (columns, column_meta)
}

fn is_result_set_query(query: &str) -> bool {
    let upper = strip_leading_sql_comments(query).to_uppercase();
    upper.starts_with("SELECT")
        || upper.starts_with("WITH")
        || upper.starts_with("SHOW")
        || upper.starts_with("EXPLAIN")
}

fn is_paginable_result_query(query: &str) -> bool {
    let upper = strip_leading_sql_comments(query).to_uppercase();
    upper.starts_with("SELECT") || upper.starts_with("WITH")
}

fn is_do_block(query: &str) -> bool {
    strip_leading_sql_comments(query).to_uppercase().starts_with("DO ")
}

fn strip_leading_sql_comments(query: &str) -> &str {
    let mut rest = query.trim_start();

    loop {
        if let Some(next) = rest.strip_prefix("--") {
            rest = match next.find('\n') {
                Some(index) => next[index + 1..].trim_start(),
                None => "",
            };
            continue;
        }

        if let Some(next) = rest.strip_prefix("/*") {
            rest = match next.find("*/") {
                Some(index) => next[index + 2..].trim_start(),
                None => "",
            };
            continue;
        }

        return rest;
    }
}
