use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct LocalSchema {
    pub id: String,
    pub config_id: String,
    pub name: String,
    pub is_default: bool,
    pub refreshed_at: String,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct LocalTable {
    pub id: String,
    pub config_id: String,
    pub schema_name: String,
    pub name: String,
    pub table_type: String,
    pub refreshed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct LocalColumn {
    pub id: String,
    pub config_id: String,
    pub schema_name: String,
    pub table_name: String,
    pub column_name: String,
    pub data_type: String,
    pub nullable: Option<bool>,
    pub default_value: Option<String>,
    pub is_auto_increment: Option<bool>,
    pub ordinal_position: i64,
    pub is_primary_key: Option<bool>,
    pub is_foreign_key: Option<bool>,
    pub refreshed_at: String,
}
