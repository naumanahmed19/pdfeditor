//! Installed-font lookup for the text editor. A PDF names its fonts (e.g.
//! "UniversLTStd-LightUltraCn"); when that exact face is installed on this
//! machine, editing can use the complete real font instead of a lookalike.
//! The frontend enforces the OS/2 fsType embedding license check.

use std::sync::OnceLock;

fn database() -> &'static fontdb::Database {
  static DB: OnceLock<fontdb::Database> = OnceLock::new();
  DB.get_or_init(|| {
    let mut db = fontdb::Database::new();
    db.load_system_fonts();
    db
  })
}

/// Lowercased alphanumerics only — tolerates "-", spaces and case drift
/// between a PDF BaseFont name and the installed face's PostScript name.
fn normalize(name: &str) -> String {
  name
    .chars()
    .filter(|c| c.is_ascii_alphanumeric())
    .collect::<String>()
    .to_ascii_lowercase()
}

/// Bytes of the installed font whose PostScript name matches `name`
/// (exact first, then normalized). Only standalone font files are returned:
/// a face inside a .ttc collection can't be loaded by PDFium or FontFace.
#[tauri::command]
pub fn match_system_font(name: String) -> Option<Vec<u8>> {
  let db = database();
  let wanted = normalize(&name);
  if wanted.is_empty() {
    return None;
  }

  let mut fallback: Option<&fontdb::FaceInfo> = None;
  for face in db.faces() {
    if face.index != 0 {
      continue;
    }
    if face.post_script_name == name {
      fallback = Some(face);
      break;
    }
    if fallback.is_none() && normalize(&face.post_script_name) == wanted {
      fallback = Some(face);
    }
  }

  let face = fallback?;
  match &face.source {
    fontdb::Source::File(path) | fontdb::Source::SharedFile(path, _) => {
      let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
      if ext == "ttc" || ext == "otc" {
        return None;
      }
      std::fs::read(path).ok()
    }
    fontdb::Source::Binary(data) => Some((*data).as_ref().as_ref().to_vec()),
  }
}

#[cfg(test)]
mod tests {
  use super::normalize;

  #[test]
  fn normalize_tolerates_separators_and_case() {
    assert_eq!(normalize("UniversLTStd-LightUltraCn"), "universltstdlightultracn");
    assert_eq!(normalize("Arial Bold MT"), "arialboldmt");
    assert_eq!(normalize(""), "");
  }
}
