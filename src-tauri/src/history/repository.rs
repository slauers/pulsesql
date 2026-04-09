use crate::history::model::{NewQueryHistoryItem, QueryHistoryFilter, QueryHistoryItem};
use sqlx::{QueryBuilder, SqlitePool};

pub async fn init(pool: &SqlitePool) -> Result<(), String> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS query_history (
          id TEXT PRIMARY KEY,
          connection_id TEXT NOT NULL,
          connection_name TEXT NOT NULL,
          database_name TEXT,
          schema_name TEXT,
          query_text TEXT NOT NULL,
          executed_at TEXT NOT NULL,
          duration_ms INTEGER,
          status TEXT NOT NULL,
          error_message TEXT,
          row_count INTEGER
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|error| format!("Failed to create query_history table: {error}"))?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_query_history_executed_at ON query_history (executed_at DESC)",
    )
    .execute(pool)
    .await
    .map_err(|error| format!("Failed to create executed_at index: {error}"))?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_query_history_connection_id ON query_history (connection_id)",
    )
    .execute(pool)
    .await
    .map_err(|error| format!("Failed to create connection_id index: {error}"))?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_query_history_status ON query_history (status)",
    )
    .execute(pool)
    .await
    .map_err(|error| format!("Failed to create status index: {error}"))?;

    Ok(())
}

pub async fn insert(pool: &SqlitePool, item: &NewQueryHistoryItem) -> Result<(), String> {
    sqlx::query(
        r#"
        INSERT INTO query_history (
          id,
          connection_id,
          connection_name,
          database_name,
          schema_name,
          query_text,
          executed_at,
          duration_ms,
          status,
          error_message,
          row_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        "#,
    )
    .bind(&item.id)
    .bind(&item.connection_id)
    .bind(&item.connection_name)
    .bind(&item.database_name)
    .bind(&item.schema_name)
    .bind(&item.query_text)
    .bind(&item.executed_at)
    .bind(item.duration_ms)
    .bind(&item.status)
    .bind(&item.error_message)
    .bind(item.row_count)
    .execute(pool)
    .await
    .map_err(|error| format!("Failed to insert query history item: {error}"))?;

    Ok(())
}

pub async fn list(
    pool: &SqlitePool,
    filter: &QueryHistoryFilter,
) -> Result<Vec<QueryHistoryItem>, String> {
    let limit = i64::from(filter.limit.unwrap_or(50).clamp(1, 200));
    let offset = i64::from(filter.offset.unwrap_or(0));

    let mut builder = QueryBuilder::new(
        "SELECT id, connection_id, connection_name, database_name, schema_name, query_text, executed_at, duration_ms, status, error_message, row_count FROM query_history WHERE 1 = 1",
    );

    if let Some(query) = filter.query.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
        builder.push(" AND query_text LIKE ");
        builder.push_bind(format!("%{query}%"));
    }

    if let Some(connection_id) = filter
        .connection_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        builder.push(" AND connection_id = ");
        builder.push_bind(connection_id);
    }

    if let Some(status) = filter.status.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
        builder.push(" AND status = ");
        builder.push_bind(status);
    }

    builder.push(" ORDER BY executed_at DESC LIMIT ");
    builder.push_bind(limit);
    builder.push(" OFFSET ");
    builder.push_bind(offset);

    builder
        .build_query_as::<QueryHistoryItem>()
        .fetch_all(pool)
        .await
        .map_err(|error| format!("Failed to load query history: {error}"))
}

pub async fn delete_item(pool: &SqlitePool, id: &str) -> Result<(), String> {
    sqlx::query("DELETE FROM query_history WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await
        .map_err(|error| format!("Failed to delete query history item: {error}"))?;

    Ok(())
}

pub async fn clear(pool: &SqlitePool) -> Result<(), String> {
    sqlx::query("DELETE FROM query_history")
        .execute(pool)
        .await
        .map_err(|error| format!("Failed to clear query history: {error}"))?;

    Ok(())
}

pub async fn trim_excess(pool: &SqlitePool, max_items: i64) -> Result<(), String> {
    sqlx::query(
        r#"
        DELETE FROM query_history
        WHERE id IN (
          SELECT id
          FROM query_history
          ORDER BY executed_at DESC
          LIMIT -1 OFFSET ?
        )
        "#,
    )
    .bind(max_items)
    .execute(pool)
    .await
    .map_err(|error| format!("Failed to trim query history: {error}"))?;

    Ok(())
}
