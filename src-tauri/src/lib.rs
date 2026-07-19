mod fonts;
mod native_menu;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  #[cfg(target_os = "macos")]
  let updater = tauri_plugin_updater::Builder::new().target("darwin-universal");
  #[cfg(not(target_os = "macos"))]
  let updater = tauri_plugin_updater::Builder::new();

  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
      fonts::match_system_font,
      native_menu::sync_native_menu_state
    ])
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_sql::Builder::default().build())
    .plugin(updater.build())
    .setup(|app| {
      native_menu::install(app)?;
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
