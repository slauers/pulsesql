use crate::db::ColumnDef;
use crate::metadata::model::LocalColumn;
use chrono::Utc;
use sqlx::SqlitePool;

pub async fn init(pool: &SqlitePool) -> Result<(), String> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS metadata_schemas (
          id TEXT PRIMARY KEY,
          config_id TEXT NOT NULL,
          name TEXT NOT NULL,
          is_default INTEGER NOT NULL DEFAULT 0,
          refreshed_at TEXT NOT NULL,
          UNIQUE(config_id, name)
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to create metadata_schemas table: {e}"))?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_metadata_schemas_config_id ON metadata_schemas (config_id)",
    )
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to create schemas index: {e}"))?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS metadata_tables (
          id TEXT PRIMARY KEY,
          config_id TEXT NOT NULL,
          schema_name TEXT NOT NULL,
          name TEXT NOT NULL,
          table_type TEXT NOT NULL DEFAULT 'BASE TABLE',
          refreshed_at TEXT NOT NULL,
          UNIQUE(config_id, schema_name, name)
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to create metadata_tables table: {e}"))?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_metadata_tables_config_schema ON metadata_tables (config_id, schema_name)",
    )
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to create tables index: {e}"))?;

    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS metadata_columns (
          id TEXT PRIMARY KEY,
          config_id TEXT NOT NULL,
          schema_name TEXT NOT NULL,
          table_name TEXT NOT NULL,
          column_name TEXT NOT NULL,
          data_type TEXT NOT NULL,
          nullable INTEGER,
          default_value TEXT,
          is_auto_increment INTEGER,
          ordinal_position INTEGER NOT NULL DEFAULT 0,
          is_primary_key INTEGER,
          is_foreign_key INTEGER,
          refreshed_at TEXT NOT NULL,
          UNIQUE(config_id, schema_name, table_name, column_name)
        )
        "#,
    )
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to create metadata_columns table: {e}"))?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_metadata_columns_table ON metadata_columns (config_id, schema_name, table_name)",
    )
    .execute(pool)
    .await
    .map_err(|e| format!("Failed to create columns index: {e}"))?;

    Ok(())
}

pub async fn upsert_schemas(
    pool: &SqlitePool,
    config_id: &str,
    schema_names: &[String],
) -> Result<(), String> {
    let now = Utc::now().to_rfc3339();
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| format!("Failed to begin transaction: {e}"))?;

    sqlx::query("DELETE FROM metadata_schemas WHERE config_id = ?")
        .bind(config_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Failed to delete schemas: {e}"))?;

    for name in schema_names {
        let id = format!("{config_id}::{name}");
        sqlx::query(
            "INSERT INTO metadata_schemas (id, config_id, name, is_default, refreshed_at) VALUES (?, ?, ?, 0, ?)",
        )
        .bind(&id)
        .bind(config_id)
        .bind(name)
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Failed to insert schema '{name}': {e}"))?;
    }

    tx.commit()
        .await
        .map_err(|e| format!("Failed to commit schemas: {e}"))
}

pub async fn upsert_tables(
    pool: &SqlitePool,
    config_id: &str,
    schema_name: &str,
    table_names: &[String],
) -> Result<(), String> {
    let now = Utc::now().to_rfc3339();
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| format!("Failed to begin transaction: {e}"))?;

    sqlx::query(
        "DELETE FROM metadata_tables WHERE config_id = ? AND schema_name = ?",
    )
    .bind(config_id)
    .bind(schema_name)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Failed to delete tables: {e}"))?;

    for name in table_names {
        let id = format!("{config_id}::{schema_name}::{name}");
        sqlx::query(
            "INSERT INTO metadata_tables (id, config_id, schema_name, name, table_type, refreshed_at) VALUES (?, ?, ?, ?, 'BASE TABLE', ?)",
        )
        .bind(&id)
        .bind(config_id)
        .bind(schema_name)
        .bind(name)
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Failed to insert table '{name}': {e}"))?;
    }

    tx.commit()
        .await
        .map_err(|e| format!("Failed to commit tables: {e}"))
}

pub async fn upsert_columns(
    pool: &SqlitePool,
    config_id: &str,
    schema_name: &str,
    table_name: &str,
    columns: &[ColumnDef],
) -> Result<(), String> {
    let now = Utc::now().to_rfc3339();
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| format!("Failed to begin transaction: {e}"))?;

    sqlx::query(
        "DELETE FROM metadata_columns WHERE config_id = ? AND schema_name = ? AND table_name = ?",
    )
    .bind(config_id)
    .bind(schema_name)
    .bind(table_name)
    .execute(&mut *tx)
    .await
    .map_err(|e| format!("Failed to delete columns: {e}"))?;

    for (pos, col) in columns.iter().enumerate() {
        let id = format!("{config_id}::{schema_name}::{table_name}::{}", col.column_name);
        sqlx::query(
            r#"
            INSERT INTO metadata_columns (
              id, config_id, schema_name, table_name,
              column_name, data_type, nullable, default_value,
              is_auto_increment, ordinal_position, is_primary_key, is_foreign_key, refreshed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(&id)
        .bind(config_id)
        .bind(schema_name)
        .bind(table_name)
        .bind(&col.column_name)
        .bind(&col.data_type)
        .bind(col.nullable)
        .bind(&col.default_value)
        .bind(col.is_auto_increment)
        .bind(pos as i64)
        .bind(col.is_primary_key)
        .bind(col.is_foreign_key)
        .bind(&now)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Failed to insert column '{}': {e}", col.column_name))?;
    }

    tx.commit()
        .await
        .map_err(|e| format!("Failed to commit columns: {e}"))
}

pub async fn load_schema_names(
    pool: &SqlitePool,
    config_id: &str,
) -> Result<Vec<String>, String> {
    sqlx::query_scalar::<_, String>(
        "SELECT name FROM metadata_schemas WHERE config_id = ? ORDER BY name",
    )
    .bind(config_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to load schema names: {e}"))
}

pub async fn load_table_names(
    pool: &SqlitePool,
    config_id: &str,
    schema_name: &str,
) -> Result<Vec<String>, String> {
    sqlx::query_scalar::<_, String>(
        "SELECT name FROM metadata_tables WHERE config_id = ? AND schema_name = ? ORDER BY name",
    )
    .bind(config_id)
    .bind(schema_name)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to load table names: {e}"))
}

pub async fn load_columns(
    pool: &SqlitePool,
    config_id: &str,
    schema_name: &str,
    table_name: &str,
) -> Result<Vec<LocalColumn>, String> {
    sqlx::query_as::<_, LocalColumn>(
        r#"
        SELECT
          id, config_id, schema_name, table_name,
          column_name, data_type, nullable, default_value,
          is_auto_increment, ordinal_position, is_primary_key, is_foreign_key, refreshed_at
        FROM metadata_columns
        WHERE config_id = ? AND schema_name = ? AND table_name = ?
        ORDER BY ordinal_position
        "#,
    )
    .bind(config_id)
    .bind(schema_name)
    .bind(table_name)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("Failed to load columns: {e}"))
}

pub async fn clear_all(pool: &SqlitePool) -> Result<(), String> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| format!("Failed to begin transaction: {e}"))?;

    sqlx::query("DELETE FROM metadata_schemas")
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Failed to clear schemas: {e}"))?;

    sqlx::query("DELETE FROM metadata_tables")
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Failed to clear tables: {e}"))?;

    sqlx::query("DELETE FROM metadata_columns")
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Failed to clear columns: {e}"))?;

    tx.commit()
        .await
        .map_err(|e| format!("Failed to commit clear_all: {e}"))
}

pub async fn invalidate(pool: &SqlitePool, config_id: &str) -> Result<(), String> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|e| format!("Failed to begin transaction: {e}"))?;

    sqlx::query("DELETE FROM metadata_schemas WHERE config_id = ?")
        .bind(config_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Failed to delete schemas: {e}"))?;

    sqlx::query("DELETE FROM metadata_tables WHERE config_id = ?")
        .bind(config_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Failed to delete tables: {e}"))?;

    sqlx::query("DELETE FROM metadata_columns WHERE config_id = ?")
        .bind(config_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("Failed to delete columns: {e}"))?;

    tx.commit()
        .await
        .map_err(|e| format!("Failed to commit invalidation: {e}"))
}
