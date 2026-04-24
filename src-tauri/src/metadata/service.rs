use crate::db::ColumnDef;
use crate::metadata::repository;
use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Manager};

pub struct MetadataStoreState {
    pool: SqlitePool,
}

impl MetadataStoreState {
    pub async fn new(app: &AppHandle) -> Result<Self, String> {
        let db_path = resolve_db_path(app)?;
        let parent_dir = db_path
            .parent()
            .ok_or_else(|| "Failed to resolve metadata store directory".to_string())?;

        std::fs::create_dir_all(parent_dir)
            .map_err(|e| format!("Failed to create metadata directory: {e}"))?;

        let url = format!("sqlite://{}?mode=rwc", db_path.to_string_lossy());
        let pool = SqlitePoolOptions::new()
            .max_connections(2)
            .acquire_timeout(Duration::from_secs(5))
            .connect(&url)
            .await
            .map_err(|e| format!("Failed to open metadata store: {e}"))?;

        repository::init(&pool).await?;

        Ok(Self { pool })
    }
}

fn resolve_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {e}"))?;

    Ok(app_data_dir.join("pulsesql-metadata.sqlite"))
}

#[tauri::command]
pub async fn get_local_schemas(
    config_id: String,
    state: tauri::State<'_, MetadataStoreState>,
) -> Result<Vec<String>, String> {
    repository::load_schema_names(&state.pool, &config_id).await
}

#[tauri::command]
pub async fn get_local_tables(
    config_id: String,
    schema_name: String,
    state: tauri::State<'_, MetadataStoreState>,
) -> Result<Vec<String>, String> {
    repository::load_table_names(&state.pool, &config_id, &schema_name).await
}

#[tauri::command]
pub async fn get_local_columns(
    config_id: String,
    schema_name: String,
    table_name: String,
    state: tauri::State<'_, MetadataStoreState>,
) -> Result<Vec<ColumnDef>, String> {
    let cols =
        repository::load_columns(&state.pool, &config_id, &schema_name, &table_name).await?;
    Ok(cols
        .into_iter()
        .map(|c| ColumnDef {
            column_name: c.column_name,
            data_type: c.data_type,
            nullable: c.nullable,
            default_value: c.default_value,
            is_auto_increment: c.is_auto_increment,
            is_primary_key: c.is_primary_key,
            is_foreign_key: c.is_foreign_key,
        })
        .collect())
}

#[tauri::command]
pub async fn save_local_schemas(
    config_id: String,
    schemas: Vec<String>,
    state: tauri::State<'_, MetadataStoreState>,
) -> Result<(), String> {
    repository::upsert_schemas(&state.pool, &config_id, &schemas).await
}

#[tauri::command]
pub async fn save_local_tables(
    config_id: String,
    schema_name: String,
    tables: Vec<String>,
    state: tauri::State<'_, MetadataStoreState>,
) -> Result<(), String> {
    repository::upsert_tables(&state.pool, &config_id, &schema_name, &tables).await
}

#[tauri::command]
pub async fn save_local_columns(
    config_id: String,
    schema_name: String,
    table_name: String,
    columns: Vec<ColumnDef>,
    state: tauri::State<'_, MetadataStoreState>,
) -> Result<(), String> {
    repository::upsert_columns(&state.pool, &config_id, &schema_name, &table_name, &columns).await
}

#[tauri::command]
pub async fn clear_all_local_metadata(
    state: tauri::State<'_, MetadataStoreState>,
) -> Result<(), String> {
    repository::clear_all(&state.pool).await
}

#[tauri::command]
pub async fn invalidate_local_metadata(
    config_id: String,
    state: tauri::State<'_, MetadataStoreState>,
) -> Result<(), String> {
    repository::invalidate(&state.pool, &config_id).await
}
