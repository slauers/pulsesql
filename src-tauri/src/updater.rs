use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;

#[derive(serde::Serialize, Clone)]
pub struct UpdateInfo {
    pub version: String,
    pub body: Option<String>,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgress {
    pub downloaded: u64,
    pub total: Option<u64>,
    pub percent: Option<u8>,
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

    let app_emit = app.clone();
    let mut downloaded: u64 = 0;

    update
        .download_and_install(
            move |chunk, total| {
                downloaded += chunk as u64;
                let percent = total.map(|t| {
                    if t == 0 { 0u8 } else { (downloaded * 100 / t).min(100) as u8 }
                });
                let _ = app_emit.emit(
                    "update-progress",
                    UpdateProgress { downloaded, total, percent },
                );
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;

    app.restart();
}
