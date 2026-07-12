#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  #[cfg(target_os = "macos")]
  let updater = tauri_plugin_updater::Builder::new().target("darwin-universal");
  #[cfg(not(target_os = "macos"))]
  let updater = tauri_plugin_updater::Builder::new();

  tauri::Builder::default()
    .plugin(tauri_plugin_process::init())
    .plugin(updater.build())
    .setup(|app| {
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
