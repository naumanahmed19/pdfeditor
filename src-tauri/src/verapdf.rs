use serde::Serialize;
use serde_json::Value;
use std::{
    env,
    ffi::OsString,
    path::{Path, PathBuf},
    process::{Command, Output},
};
use tempfile::Builder;

const NOT_FOUND_PREFIX: &str = "VERAPDF_NOT_FOUND:";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VeraPdfOutput {
    executable: String,
    report: Value,
}

#[tauri::command]
pub async fn validate_pdfa_with_verapdf(
    bytes: Vec<u8>,
    flavour: Option<String>,
) -> Result<VeraPdfOutput, String> {
    tauri::async_runtime::spawn_blocking(move || validate(bytes, flavour))
        .await
        .map_err(|error| format!("veraPDF validation task failed: {error}"))?
}

fn validate(bytes: Vec<u8>, flavour: Option<String>) -> Result<VeraPdfOutput, String> {
    if bytes.is_empty() {
        return Err("Cannot validate an empty PDF.".into());
    }

    let flavour = validated_flavour(flavour.as_deref().unwrap_or("2b"))?;
    let executable = find_executable().ok_or_else(|| {
        format!(
            "{NOT_FOUND_PREFIX} Install veraPDF, add it to PATH, or set VERAPDF_EXECUTABLE to its launcher."
        )
    })?;

    // veraPDF normally ignores files without a .pdf extension. NamedTempFile
    // keeps the handle alive for the whole validation and removes it on drop.
    let mut input = Builder::new()
        .prefix("pickpdf-verapdf-")
        .suffix(".pdf")
        .tempfile()
        .map_err(|error| format!("Could not create the temporary PDF: {error}"))?;
    std::io::Write::write_all(&mut input, &bytes)
        .map_err(|error| format!("Could not write the temporary PDF: {error}"))?;
    input
        .as_file_mut()
        .sync_all()
        .map_err(|error| format!("Could not finish writing the temporary PDF: {error}"))?;

    let output = run_verapdf(&executable, flavour, input.path())
        .map_err(|error| format!("Could not start veraPDF: {error}"))?;
    let stdout = String::from_utf8(output.stdout)
        .map_err(|_| "veraPDF returned a report that was not UTF-8.".to_string())?;

    // A non-compliant PDF is still a successful validation job. Prefer a valid
    // JSON report over the process status and only treat missing/malformed output
    // as an execution failure.
    let report = serde_json::from_str::<Value>(&stdout).map_err(|error| {
        let stderr = clipped(&String::from_utf8_lossy(&output.stderr), 2_000);
        if output.status.success() {
            format!("veraPDF returned invalid JSON: {error}. {stderr}")
        } else {
            format!(
                "veraPDF exited with {} and did not return a JSON report. {stderr}",
                output.status
            )
        }
    })?;

    Ok(VeraPdfOutput {
        executable: executable.to_string_lossy().into_owned(),
        report,
    })
}

fn validated_flavour(value: &str) -> Result<&str, String> {
    match value {
        "1a" | "1b" | "2a" | "2b" | "2u" | "3a" | "3b" | "3u" | "4" | "4e" | "4f" | "ua1"
        | "ua2" => Ok(value),
        _ => Err(format!("Unsupported veraPDF validation profile: {value}")),
    }
}

fn run_verapdf(executable: &Path, flavour: &str, input: &Path) -> std::io::Result<Output> {
    #[cfg(target_os = "windows")]
    let mut command = {
        // Windows veraPDF installations expose a .bat launcher, which must be
        // executed by cmd.exe rather than CreateProcess directly.
        let mut command = Command::new("cmd.exe");
        command.arg("/D").arg("/C").arg(executable);
        command
    };

    #[cfg(not(target_os = "windows"))]
    let mut command = Command::new(executable);

    command
        .arg("--format")
        .arg("json")
        .arg("--flavour")
        .arg(flavour)
        .arg("--loglevel")
        .arg("0")
        .arg("--maxfailuresdisplayed")
        .arg("25")
        .arg(input)
        .output()
}

fn find_executable() -> Option<PathBuf> {
    if let Some(configured) = env::var_os("VERAPDF_EXECUTABLE").filter(|value| !value.is_empty()) {
        let path = PathBuf::from(configured);
        if path.is_file() {
            return Some(path);
        }
    }

    #[cfg(target_os = "windows")]
    let names = ["verapdf.bat", "verapdf.cmd"];
    #[cfg(not(target_os = "windows"))]
    let names = ["verapdf", "verapdf"];

    if let Some(path) = find_on_path(&names) {
        return Some(path);
    }

    let mut candidates = Vec::new();
    if let Some(home) = home_dir() {
        #[cfg(target_os = "windows")]
        candidates.extend([
            home.join("verapdf").join("verapdf.bat"),
            home.join("veraPDF").join("verapdf.bat"),
        ]);
        #[cfg(not(target_os = "windows"))]
        candidates.extend([
            home.join("verapdf").join("verapdf"),
            home.join("veraPDF").join("verapdf"),
        ]);
    }

    #[cfg(not(target_os = "windows"))]
    candidates.extend([
        PathBuf::from("/usr/local/bin/verapdf"),
        PathBuf::from("/opt/verapdf/verapdf"),
    ]);

    candidates.into_iter().find(|path| path.is_file())
}

fn find_on_path(names: &[&str]) -> Option<PathBuf> {
    let path = env::var_os("PATH")?;
    for directory in env::split_paths(&path) {
        for name in names {
            let candidate = directory.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn home_dir() -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    let key = "USERPROFILE";
    #[cfg(not(target_os = "windows"))]
    let key = "HOME";
    env::var_os(key)
        .filter(|value: &OsString| !value.is_empty())
        .map(PathBuf::from)
}

fn clipped(value: &str, max_chars: usize) -> String {
    let trimmed = value.trim();
    if trimmed.chars().count() <= max_chars {
        return trimmed.to_string();
    }
    let mut clipped: String = trimmed.chars().take(max_chars).collect();
    clipped.push_str("…");
    clipped
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_supported_profiles() {
        for flavour in ["1b", "2b", "4", "ua1", "ua2"] {
            assert_eq!(validated_flavour(flavour), Ok(flavour));
        }
    }

    #[test]
    fn rejects_arguments_disguised_as_profiles() {
        assert!(validated_flavour("--off").is_err());
        assert!(validated_flavour("2b file.pdf").is_err());
    }
}
