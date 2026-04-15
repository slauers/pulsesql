use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

#[derive(serde::Serialize)]
pub struct UpdateInfo {
    pub version: String,
    pub body: Option<String>,
}

#[tauri::command]
pub async fn check_for_updates(app: AppHandle) -> Result<Option<UpdateInfo>, String> {
    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => {
            let msg = e.to_string();
            // Updater not configured (missing pubkey) — treat as no update available.
            if msg.contains("pubkey") || msg.contains("public key") || msg.contains("no pub") {
                return Ok(None);
            }
            return Err(msg);
        }
    };

    match updater.check().await {
        Ok(Some(update)) => Ok(Some(UpdateInfo {
            version: update.version.clone(),
            body: update.body.clone(),
        })),
        Ok(None) => Ok(None),
        Err(e) => {
            // Network errors or manifest not found are non-fatal — just skip silently.
            let msg = e.to_string();
            if msg.contains("404") || msg.contains("network") || msg.contains("connect") {
                return Ok(None);
            }
            Err(msg)
        }
    }
}

#[tauri::command]
pub async fn install_update(app: AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| e.to_string())?;

    let update = updater
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No update available".to_string())?;

    update
        .download_and_install(|_chunk, _total| {}, || {})
        .await
        .map_err(|e| e.to_string())?;

    app.restart();
}
