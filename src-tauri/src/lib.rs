mod fonts;
mod native_menu;
mod verapdf;

use std::sync::Mutex;
#[cfg(any(target_os = "android", target_os = "ios", target_os = "macos"))]
use tauri::{Emitter, Manager};

#[derive(Default)]
struct OpenedUrls(Mutex<Vec<String>>);

#[tauri::command]
fn take_opened_urls(state: tauri::State<'_, OpenedUrls>) -> Vec<String> {
  std::mem::take(&mut *state.0.lock().expect("opened URL state poisoned"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let builder = tauri::Builder::default()
    .manage(OpenedUrls::default())
    .invoke_handler(tauri::generate_handler![
      take_opened_urls,
      fonts::match_system_font,
      native_menu::sync_native_menu_state,
      verapdf::validate_pdfa_with_verapdf
    ])
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_sql::Builder::default().build())
    .plugin(tauri_plugin_dialog::init());

  #[cfg(not(any(target_os = "android", target_os = "ios")))]
  let builder = {
    #[cfg(target_os = "macos")]
    let updater = tauri_plugin_updater::Builder::new().target("darwin-universal");
    #[cfg(not(target_os = "macos"))]
    let updater = tauri_plugin_updater::Builder::new();
    builder.plugin(updater.build())
  };

  builder
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
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|_app, _event| {
      #[cfg(any(target_os = "android", target_os = "ios", target_os = "macos"))]
      if let tauri::RunEvent::Opened { urls } = _event {
        let urls = urls.iter().map(ToString::to_string).collect::<Vec<_>>();
        _app
          .state::<OpenedUrls>()
          .0
          .lock()
          .expect("opened URL state poisoned")
          .extend(urls.clone());
        let _ = _app.emit("pickpdf:opened", urls);
      }
    });
}
