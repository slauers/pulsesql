use crate::history::model::{NewQueryHistoryItem, QueryHistoryFilter, QueryHistoryItem};
use crate::history::repository;
use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Manager};

const MAX_HISTORY_ITEMS: i64 = 2000;

pub struct HistoryState {
    pool: SqlitePool,
}

impl HistoryState {
    pub async fn new(app: &AppHandle) -> Result<Self, String> {
        let db_path = resolve_history_db_path(app)?;
        let parent_dir = db_path
            .parent()
            .ok_or_else(|| "Failed to resolve query history directory".to_string())?;

        std::fs::create_dir_all(parent_dir)
            .map_err(|error| format!("Failed to create history directory: {error}"))?;

        let url = format!("sqlite://{}?mode=rwc", db_path.to_string_lossy());
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .acquire_timeout(Duration::from_secs(5))
            .connect(&url)
            .await
            .map_err(|error| format!("Failed to open query history database: {error}"))?;

        repository::init(&pool).await?;

        Ok(Self { pool })
    }

    pub async fn record(&self, item: NewQueryHistoryItem) -> Result<(), String> {
        repository::insert(&self.pool, &item).await?;
        repository::trim_excess(&self.pool, MAX_HISTORY_ITEMS).await?;
        Ok(())
    }

    /// Records history in a background task — does not block the caller.
    pub fn record_spawned(&self, item: NewQueryHistoryItem) {
        let pool = self.pool.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(error) = repository::insert(&pool, &item).await {
                eprintln!("[history] Failed to record query: {error}");
            }
            let _ = repository::trim_excess(&pool, MAX_HISTORY_ITEMS).await;
        });
    }

    pub async fn list(&self, filter: QueryHistoryFilter) -> Result<Vec<QueryHistoryItem>, String> {
        repository::list(&self.pool, &filter).await
    }

    pub async fn delete_item(&self, id: &str) -> Result<(), String> {
        repository::delete_item(&self.pool, id).await
    }

    pub async fn clear(&self) -> Result<(), String> {
        repository::clear(&self.pool).await
    }
}

fn resolve_history_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;

    Ok(app_data_dir.join("pulsesql-history.sqlite"))
}
