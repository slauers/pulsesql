use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct QueryHistoryItem {
    pub id: String,
    pub connection_id: String,
    pub connection_name: String,
    pub database_name: Option<String>,
    pub schema_name: Option<String>,
    pub query_text: String,
    pub executed_at: String,
    pub duration_ms: Option<i64>,
    pub status: String,
    pub error_message: Option<String>,
    pub row_count: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryHistoryFilter {
    pub query: Option<String>,
    pub connection_id: Option<String>,
    pub status: Option<String>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewQueryHistoryItem {
    pub id: String,
    pub connection_id: String,
    pub connection_name: String,
    pub database_name: Option<String>,
    pub schema_name: Option<String>,
    pub query_text: String,
    pub executed_at: String,
    pub duration_ms: Option<i64>,
    pub status: String,
    pub error_message: Option<String>,
    pub row_count: Option<i64>,
}
