pub mod cmd;
pub mod connection;
pub mod updater;
pub mod db;
pub mod engines;
pub mod history;
pub mod jdk;
pub mod ssh;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use std::sync::Mutex;

const SPLASH_WINDOW_LABEL: &str = "splash";
const MAIN_WINDOW_LABEL: &str = "main";
const LOCK_SPLASH_FOR_DEV: bool = false;

#[derive(Clone, Serialize)]
struct SplashProgressPayload {
    progress: u8,
    label: Option<String>,
}

#[derive(Clone, Serialize)]
struct SplashState {
    progress: u8,
    label: Option<String>,
    finished: bool,
}

impl Default for SplashState {
    fn default() -> Self {
        Self {
            progress: 8,
            label: Some("Preparing workspace".to_string()),
            finished: false,
        }
    }
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn update_splash_progress(
    app: AppHandle,
    splash_state: tauri::State<Mutex<SplashState>>,
    progress: u8,
    label: Option<String>,
) -> Result<(), String> {
    let payload = {
        let mut state = splash_state
            .lock()
            .map_err(|_| "Failed to lock splash state".to_string())?;
        state.progress = progress.min(100);
        state.label = label.clone();

        SplashProgressPayload {
            progress: state.progress,
            label: state.label.clone(),
        }
    };

    app.emit_to(SPLASH_WINDOW_LABEL, "splash:progress", payload)
        .map_err(|error| format!("Failed to emit splash progress: {error}"))
}

#[tauri::command]
fn reveal_main_window(
    app: AppHandle,
    splash_state: tauri::State<Mutex<SplashState>>,
) -> Result<(), String> {
    if LOCK_SPLASH_FOR_DEV {
        return Ok(());
    }

    finalize_startup(&app, &splash_state, true)
}

#[tauri::command]
fn close_splash_window(app: AppHandle) -> Result<(), String> {
    if let Some(splash_window) = app.get_webview_window(SPLASH_WINDOW_LABEL) {
        splash_window
            .close()
            .map_err(|error| format!("Failed to close splash window: {error}"))?;
    }

    Ok(())
}

#[tauri::command]
fn get_splash_state(splash_state: tauri::State<Mutex<SplashState>>) -> Result<SplashState, String> {
    let state = splash_state
        .lock()
        .map_err(|_| "Failed to lock splash state".to_string())?;
    Ok(state.clone())
}

#[tauri::command]
fn reopen_splash_window(
    app: AppHandle,
    splash_state: tauri::State<Mutex<SplashState>>,
) -> Result<(), String> {
    {
        let mut state = splash_state
            .lock()
            .map_err(|_| "Failed to lock splash state".to_string())?;
        *state = SplashState::default();
    }

    if let Some(splash_window) = app.get_webview_window(SPLASH_WINDOW_LABEL) {
        let _ = splash_window.close();
    }

    create_splash_window(&app)?;

    let payload = {
        let state = splash_state
            .lock()
            .map_err(|_| "Failed to lock splash state".to_string())?;

        SplashProgressPayload {
            progress: state.progress,
            label: state.label.clone(),
        }
    };

    app.emit_to(SPLASH_WINDOW_LABEL, "splash:progress", payload)
        .map_err(|error| format!("Failed to emit splash progress: {error}"))
}

fn create_splash_window(app: &AppHandle) -> Result<(), String> {
    if app.get_webview_window(SPLASH_WINDOW_LABEL).is_some() {
        return Ok(());
    }

    let builder = WebviewWindowBuilder::new(
        app,
        SPLASH_WINDOW_LABEL,
        WebviewUrl::App("splash.html".into()),
    )
        .title("PulseSQL")
        .inner_size(306.0, 264.0)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .closable(false)
        .decorations(false)
        .center()
        .visible(false)
        .always_on_top(true)
        .transparent(true);

    builder
        .build()
        .map(|_| ())
        .map_err(|error| format!("Failed to create splash window: {error}"))
}

fn finalize_startup(
    app: &AppHandle,
    splash_state: &tauri::State<Mutex<SplashState>>,
    focus_main: bool,
) -> Result<(), String> {
    {
        let mut state = splash_state
            .lock()
            .map_err(|_| "Failed to lock splash state".to_string())?;

        if state.finished {
            return Ok(());
        }

        state.progress = 100;
        state.label = Some("Ready".to_string());
        state.finished = true;
    }

    if let Some(main_window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = main_window.show();
        if focus_main {
            let _ = main_window.set_focus();
        }
    }

    app.emit_to(SPLASH_WINDOW_LABEL, "splash:finish", ())
        .map_err(|error| format!("Failed to emit splash finish event: {error}"))?;

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(220)).await;
        if let Some(splash_window) = app_handle.get_webview_window(SPLASH_WINDOW_LABEL) {
            let _ = splash_window.close();
        }
    });

    Ok(())
}

#[tauri::command]
fn check_jdk_status() -> Result<jdk::JdkStatus, String> {
    let sidecar_root = engines::oracle::sidecar_root()?;
    Ok(jdk::detect_jdk(&sidecar_root))
}

#[tauri::command]
async fn download_install_jdk(app: AppHandle) -> Result<(), String> {
    let sidecar_root = engines::oracle::sidecar_root()?;
    tokio::task::spawn_blocking(move || jdk::download_install_jdk(&app, &sidecar_root))
        .await
        .map_err(|e| format!("Instalacao falhou inesperadamente: {e}"))?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let history_state = tauri::async_runtime::block_on(history::service::HistoryState::new(
                &app.handle(),
            ))?;
            engines::oracle::init_sidecar_root(&app.handle())?;
            app.manage(db::DbState::new());
            app.manage(history_state);

            if let Some(window) = app.get_webview_window("main") {
                let _ = window.hide();
                if let Some(icon) = app.default_window_icon().cloned() {
                    let _ = window.set_icon(icon);
                }
            }

            create_splash_window(&app.handle())?;

            if !LOCK_SPLASH_FOR_DEV {
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_secs(4)).await;
                    let splash_state = app_handle.state::<Mutex<SplashState>>();
                    let _ = finalize_startup(&app_handle, &splash_state, false);
                });
            }

            Ok(())
        })
        .manage(Mutex::new(SplashState::default()))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            update_splash_progress,
            reveal_main_window,
            close_splash_window,
            get_splash_state,
            reopen_splash_window,
            db::test_connection,
            db::test_ssh_tunnel,
            db::open_connection,
            db::close_connection,
            db::list_databases,
            db::list_schemas,
            db::list_tables,
            db::list_columns,
            db::execute_query,
            db::list_query_history,
            db::delete_query_history_item,
            db::clear_query_history,
            check_jdk_status,
            download_install_jdk,
            updater::check_for_updates,
            updater::install_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
