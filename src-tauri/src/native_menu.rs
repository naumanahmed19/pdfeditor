#[cfg(target_os = "macos")]
use tauri::{
  menu::{
    Menu, MenuBuilder, MenuItem, MenuItemKind, SubmenuBuilder, HELP_SUBMENU_ID,
    WINDOW_SUBMENU_ID,
  },
};

#[cfg(target_os = "macos")]
use tauri::Emitter;

#[cfg(target_os = "macos")]
const EVENT_NAME: &str = "pickpdf:native-menu";

#[cfg(target_os = "macos")]
fn item(
  app: &tauri::App,
  id: &str,
  text: &str,
  accelerator: Option<&str>,
) -> tauri::Result<MenuItem<tauri::Wry>> {
  MenuItem::with_id(app, id, text, true, accelerator)
}

#[cfg(target_os = "macos")]
fn build_menu(app: &tauri::App) -> tauri::Result<Menu<tauri::Wry>> {
  let application = SubmenuBuilder::with_id(app, "pickpdf.application", "PickPDF")
    .item(&item(app, "pickpdf.about", "About PickPDF", None)?)
    .separator()
    .item(&item(
      app,
      "pickpdf.settings",
      "Settings…",
      Some("CmdOrCtrl+,"),
    )?)
    .separator()
    .services()
    .separator()
    .hide()
    .hide_others()
    .show_all()
    .separator()
    .quit()
    .build()?;

  let file = SubmenuBuilder::with_id(app, "pickpdf.file", "File")
    .item(&item(
      app,
      "pickpdf.file.open",
      "Open PDF…",
      Some("CmdOrCtrl+O"),
    )?)
    .item(&item(
      app,
      "pickpdf.file.new-template",
      "New from Template…",
      Some("CmdOrCtrl+N"),
    )?)
    .separator()
    .item(&item(
      app,
      "pickpdf.file.save",
      "Save",
      Some("CmdOrCtrl+S"),
    )?)
    .item(&item(
      app,
      "pickpdf.file.download-copy",
      "Download a Copy…",
      Some("CmdOrCtrl+Shift+S"),
    )?)
    .item(&item(
      app,
      "pickpdf.file.print",
      "Print…",
      Some("CmdOrCtrl+P"),
    )?)
    .separator()
    .item(&item(
      app,
      "pickpdf.file.properties",
      "Document Properties…",
      None,
    )?)
    .item(&item(
      app,
      "pickpdf.file.security",
      "Protect Document…",
      None,
    )?)
    .item(&item(
      app,
      "pickpdf.file.sign",
      "Sign with Certificate…",
      None,
    )?)
    .separator()
    .item(&item(
      app,
      "pickpdf.file.close-document",
      "Close Document",
      Some("CmdOrCtrl+W"),
    )?)
    .build()?;

  let edit = SubmenuBuilder::with_id(app, "pickpdf.edit", "Edit")
    .undo()
    .redo()
    .separator()
    .cut()
    .copy()
    .paste()
    .select_all()
    .build()?;

  let view = SubmenuBuilder::with_id(app, "pickpdf.view", "View")
    .item(&item(
      app,
      "pickpdf.view.sidebar",
      "Toggle Sidebar",
      Some("CmdOrCtrl+\\"),
    )?)
    .item(&item(
      app,
      "pickpdf.view.search",
      "Find in Document…",
      Some("CmdOrCtrl+F"),
    )?)
    .item(&item(
      app,
      "pickpdf.view.command-palette",
      "Command Palette…",
      Some("CmdOrCtrl+K"),
    )?)
    .separator()
    .fullscreen()
    .build()?;

  let tools = SubmenuBuilder::with_id(app, "pickpdf.tools", "Tools")
    .text("pickpdf.tools.organize", "Organize Pages")
    .text("pickpdf.tools.create-images", "Images to PDF…")
    .text("pickpdf.tools.create-document", "Word or Text to PDF…")
    .text("pickpdf.tools.merge", "Merge PDFs")
    .text("pickpdf.tools.split", "Split & Extract")
    .text("pickpdf.tools.watermark", "Watermark & Numbers")
    .text("pickpdf.tools.header-footer", "Headers & Footers…")
    .text("pickpdf.tools.crop", "Crop Pages…")
    .text("pickpdf.tools.compress", "Compress…")
    .separator()
    .text("pickpdf.tools.export", "Export…")
    .text("pickpdf.tools.compare", "Compare Documents…")
    .text("pickpdf.tools.pdfa", "PDF/A Check…")
    .separator()
    .text("pickpdf.tools.ocr", "Make Searchable (OCR)")
    .text("pickpdf.tools.flatten", "Flatten Document")
    .build()?;

  let window = SubmenuBuilder::with_id(app, WINDOW_SUBMENU_ID, "Window")
    .minimize()
    .maximize()
    .separator()
    .bring_all_to_front()
    .build()?;

  let help = SubmenuBuilder::with_id(app, HELP_SUBMENU_ID, "Help").build()?;

  MenuBuilder::new(app)
    .items(&[
      &application,
      &file,
      &edit,
      &view,
      &tools,
      &window,
      &help,
    ])
    .build()
}

pub fn install(app: &mut tauri::App) -> tauri::Result<()> {
  #[cfg(target_os = "macos")]
  {
    app.set_menu(build_menu(app)?)?;
    app.on_menu_event(|app_handle, event| {
      let id = event.id().as_ref();
      if id.starts_with("pickpdf.") {
        let _ = app_handle.emit(EVENT_NAME, id);
      }
    });
  }

  #[cfg(not(target_os = "macos"))]
  {
    let _ = app;
  }

  Ok(())
}

#[cfg(target_os = "macos")]
fn set_submenu_items_enabled(
  submenu: &tauri::menu::Submenu<tauri::Wry>,
  ids: &[&str],
  enabled: bool,
) -> tauri::Result<()> {
  for id in ids {
    if let Some(MenuItemKind::MenuItem(item)) = submenu.get(*id) {
      item.set_enabled(enabled)?;
    }
  }
  Ok(())
}

#[tauri::command]
pub fn sync_native_menu_state(
  app: tauri::AppHandle,
  has_pdf: bool,
  ocr_busy: bool,
  active_protected: bool,
) -> Result<(), String> {
  #[cfg(target_os = "macos")]
  {
    let menu = app.menu().ok_or("native application menu is unavailable")?;

    if let Some(MenuItemKind::Submenu(file)) = menu.get("pickpdf.file") {
      set_submenu_items_enabled(
        &file,
        &[
          "pickpdf.file.save",
          "pickpdf.file.download-copy",
          "pickpdf.file.print",
          "pickpdf.file.properties",
          "pickpdf.file.security",
          "pickpdf.file.sign",
          "pickpdf.file.close-document",
        ],
        has_pdf,
      )
      .map_err(|error| error.to_string())?;

      if let Some(MenuItemKind::MenuItem(security)) = file.get("pickpdf.file.security") {
        security
          .set_text(if active_protected {
            "Document Security…"
          } else {
            "Protect Document…"
          })
          .map_err(|error| error.to_string())?;
      }
    }

    if let Some(MenuItemKind::Submenu(tools)) = menu.get("pickpdf.tools") {
      set_submenu_items_enabled(
        &tools,
        &["pickpdf.tools.ocr"],
        has_pdf && !ocr_busy,
      )
      .map_err(|error| error.to_string())?;
      set_submenu_items_enabled(
        &tools,
        &["pickpdf.tools.flatten"],
        has_pdf,
      )
      .map_err(|error| error.to_string())?;
    }

    if let Some(MenuItemKind::Submenu(view)) = menu.get("pickpdf.view") {
      set_submenu_items_enabled(
        &view,
        &["pickpdf.view.search"],
        has_pdf,
      )
      .map_err(|error| error.to_string())?;
    }
  }

  #[cfg(not(target_os = "macos"))]
  {
    let _ = (app, has_pdf, ocr_busy, active_protected);
  }

  Ok(())
}
