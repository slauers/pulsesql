use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DatabaseEngine {
    Postgres,
    Mysql,
    Oracle,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum OracleConnectionType {
    ServiceName,
    Sid,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SshAuthMethod {
    Password,
    PrivateKey,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SshConfig {
    pub enabled: bool,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub user: Option<String>,
    pub auth_method: Option<SshAuthMethod>,
    pub password: Option<String>,
    pub private_key_path: Option<String>,
    pub passphrase: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionConfig {
    pub id: String,
    pub name: String,
    pub engine: DatabaseEngine,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub password: Option<String>,
    pub database: Option<String>,
    pub connect_timeout_seconds: Option<u64>,
    pub auto_reconnect: Option<bool>,
    pub oracle_connection_type: Option<OracleConnectionType>,
    pub oracle_driver_properties: Option<String>,
    pub ssh: Option<SshConfig>,
}

impl ConnectionConfig {
    pub fn database_name(&self) -> Result<&str, String> {
        self.database
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| "Database name is required".to_string())
    }

    pub fn connect_timeout_seconds(&self) -> u64 {
        self.connect_timeout_seconds.unwrap_or(10).clamp(3, 120)
    }

    pub fn auto_reconnect(&self) -> bool {
        self.auto_reconnect.unwrap_or(true)
    }
}
