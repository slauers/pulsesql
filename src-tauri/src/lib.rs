pub mod connection;
pub mod db;
pub mod engines;
pub mod history;
pub mod ssh;

use tauri::Manager;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
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
                if let Some(icon) = app.default_window_icon().cloned() {
                    let _ = window.set_icon(icon);
                }
            }

            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
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
            db::clear_query_history
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
