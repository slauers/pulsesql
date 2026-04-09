pub mod connection;
pub mod db;
pub mod engines;
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
        .manage(db::DbState::new())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                if let Some(icon) = app.default_window_icon().cloned() {
                    let _ = window.set_icon(icon);
                }
            }

            Ok(())
        })
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
            db::execute_query
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
