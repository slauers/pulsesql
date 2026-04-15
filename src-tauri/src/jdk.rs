use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Emitter};

const JDK_DIR_NAME: &str = "jdk-bundled";

#[derive(Debug, Clone, Serialize)]
pub struct JdkStatus {
    pub available: bool,
    pub version: Option<String>,
    pub source: String, // "bundled" | "system" | "none"
}

#[derive(Clone, Serialize)]
struct JdkProgressPayload {
    progress: u8,
    label: String,
}

/// Returns the java executable to use: bundled JDK if installed, else system "java".
pub fn get_java_exe(sidecar_root: &Path) -> PathBuf {
    let bundled = bundled_java_exe(sidecar_root);
    if bundled.exists() {
        return bundled;
    }
    if let Some(p) = java_home_exe("java") {
        return p;
    }
    PathBuf::from("java")
}

/// Returns the javac executable to use: bundled JDK if installed, else system "javac".
pub fn get_javac_exe(sidecar_root: &Path) -> PathBuf {
    let bundled = bundled_javac_exe(sidecar_root);
    if bundled.exists() {
        return bundled;
    }
    if let Some(p) = java_home_exe("javac") {
        return p;
    }
    PathBuf::from("javac")
}

/// Resolves `{JAVA_HOME}/bin/<name>[.exe]` if the env var is set and the file exists.
fn java_home_exe(name: &str) -> Option<PathBuf> {
    let java_home = std::env::var("JAVA_HOME").ok()?;
    let exe_name = if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    };
    let path = PathBuf::from(java_home).join("bin").join(exe_name);
    path.exists().then_some(path)
}

/// Checks whether a usable JDK is available (bundled or system).
pub fn detect_jdk(sidecar_root: &Path) -> JdkStatus {
    let bundled = bundled_java_exe(sidecar_root);
    if bundled.exists() {
        return JdkStatus {
            available: true,
            version: read_java_version(&bundled),
            source: "bundled".to_string(),
        };
    }

    // Try JAVA_HOME first — on Windows the JDK installer adds only java.exe to the
    // global PATH; javac lives in the JDK bin dir pointed to by JAVA_HOME.
    if let Some(javac) = java_home_exe("javac") {
        if let Some(java) = java_home_exe("java") {
            return JdkStatus {
                available: true,
                version: read_java_version(&java),
                source: "system".to_string(),
            };
        }
        let _ = javac; // JAVA_HOME has javac but no java — unusual, fall through
    }

    match Command::new("java").arg("-version").output() {
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            if let Some(version) = parse_java_version(&stderr) {
                // Confirm javac is also reachable; otherwise it is a JRE, not a JDK.
                let javac_ok = java_home_exe("javac").is_some()
                    || Command::new("javac")
                        .arg("-version")
                        .output()
                        .map(|o| o.status.success())
                        .unwrap_or(false);

                if javac_ok {
                    return JdkStatus {
                        available: true,
                        version: Some(version),
                        source: "system".to_string(),
                    };
                }
            }
            jdk_not_found()
        }
        Err(_) => jdk_not_found(),
    }
}

fn jdk_not_found() -> JdkStatus {
    JdkStatus {
        available: false,
        version: None,
        source: "none".to_string(),
    }
}

fn bundled_java_exe(sidecar_root: &Path) -> PathBuf {
    let jdk_dir = sidecar_root.join(JDK_DIR_NAME);

    // Eclipse Temurin on macOS uses a Contents/Home layout inside the JDK directory.
    if cfg!(target_os = "macos") {
        let macos_path = jdk_dir.join("Contents").join("Home").join("bin").join("java");
        if macos_path.exists() {
            return macos_path;
        }
    }

    if cfg!(windows) {
        jdk_dir.join("bin").join("java.exe")
    } else {
        jdk_dir.join("bin").join("java")
    }
}

fn bundled_javac_exe(sidecar_root: &Path) -> PathBuf {
    let jdk_dir = sidecar_root.join(JDK_DIR_NAME);

    if cfg!(target_os = "macos") {
        let macos_path = jdk_dir
            .join("Contents")
            .join("Home")
            .join("bin")
            .join("javac");
        if macos_path.exists() {
            return macos_path;
        }
    }

    if cfg!(windows) {
        jdk_dir.join("bin").join("javac.exe")
    } else {
        jdk_dir.join("bin").join("javac")
    }
}

fn read_java_version(java_exe: &Path) -> Option<String> {
    let output = Command::new(java_exe).arg("-version").output().ok()?;
    // java -version writes to stderr
    parse_java_version(&String::from_utf8_lossy(&output.stderr))
}

fn parse_java_version(text: &str) -> Option<String> {
    // First line is like: openjdk version "21.0.5" 2024-10-15
    text.lines().next().and_then(|line| {
        let start = line.find('"')? + 1;
        let end = line[start..].find('"')? + start;
        Some(line[start..end].to_string())
    })
}

/// Returns the Adoptium Temurin JDK 21 download URL for the current platform.
fn jdk_download_url() -> Option<&'static str> {
    if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        Some("https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jdk/hotspot/normal/eclipse")
    } else if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        Some("https://api.adoptium.net/v3/binary/latest/21/ga/mac/aarch64/jdk/hotspot/normal/eclipse")
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        Some("https://api.adoptium.net/v3/binary/latest/21/ga/mac/x64/jdk/hotspot/normal/eclipse")
    } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        Some("https://api.adoptium.net/v3/binary/latest/21/ga/linux/x64/jdk/hotspot/normal/eclipse")
    } else if cfg!(all(target_os = "linux", target_arch = "aarch64")) {
        Some("https://api.adoptium.net/v3/binary/latest/21/ga/linux/aarch64/jdk/hotspot/normal/eclipse")
    } else {
        None
    }
}

fn emit_progress(app: &AppHandle, progress: u8, label: &str) {
    let _ = app.emit(
        "jdk:progress",
        JdkProgressPayload {
            progress,
            label: label.to_string(),
        },
    );
}

/// Downloads and installs Eclipse Temurin JDK 21 into `{sidecar_root}/jdk-bundled/`.
/// Emits `jdk:progress` events throughout the process.
pub fn download_install_jdk(app: &AppHandle, sidecar_root: &Path) -> Result<(), String> {
    let url = jdk_download_url().ok_or_else(|| {
        "Plataforma nao suportada para instalacao automatica do JDK. Instale manualmente e tente novamente.".to_string()
    })?;

    fs::create_dir_all(sidecar_root)
        .map_err(|e| format!("Falha ao preparar diretorio do JDK: {e}"))?;

    emit_progress(app, 5, "Iniciando download do JDK Eclipse Temurin 21...");

    let ext = if cfg!(windows) { "zip" } else { "tar.gz" };
    let download_path = sidecar_root.join(format!("jdk-download.{ext}"));

    if download_path.exists() {
        let _ = fs::remove_file(&download_path);
    }

    emit_progress(
        app,
        10,
        "Baixando JDK Eclipse Temurin 21... (pode demorar alguns minutos)",
    );

    let curl_out = Command::new("curl")
        .args(["-fL", "--retry", "3", url, "-o"])
        .arg(&download_path)
        .output()
        .map_err(|e| format!("Nao foi possivel iniciar o download do JDK: {e}"))?;

    if !curl_out.status.success() {
        return Err(format!(
            "Falha no download do JDK. Verifique sua conexao com a internet. Detalhe: {}",
            String::from_utf8_lossy(&curl_out.stderr).trim()
        ));
    }

    emit_progress(app, 65, "Extraindo JDK...");

    let extract_dir = sidecar_root.join("jdk-extract-tmp");
    if extract_dir.exists() {
        fs::remove_dir_all(&extract_dir)
            .map_err(|e| format!("Falha ao limpar diretorio temporario: {e}"))?;
    }
    fs::create_dir_all(&extract_dir)
        .map_err(|e| format!("Falha ao criar diretorio de extracao: {e}"))?;

    extract_jdk_archive(&download_path, &extract_dir)?;

    emit_progress(app, 85, "Configurando JDK...");

    let jdk_final = sidecar_root.join(JDK_DIR_NAME);
    if jdk_final.exists() {
        fs::remove_dir_all(&jdk_final)
            .map_err(|e| format!("Falha ao remover JDK anterior: {e}"))?;
    }

    let extracted = find_jdk_dir(&extract_dir)
        .ok_or_else(|| "Nao foi possivel localizar o diretorio do JDK apos a extracao.".to_string())?;

    fs::rename(&extracted, &jdk_final)
        .map_err(|e| format!("Falha ao mover JDK para o destino final: {e}"))?;

    let _ = fs::remove_file(&download_path);
    let _ = fs::remove_dir_all(&extract_dir);

    let java_exe = bundled_java_exe(sidecar_root);
    if !java_exe.exists() {
        return Err(format!(
            "Instalacao incompleta: executavel nao encontrado em '{}'. Tente novamente.",
            java_exe.display()
        ));
    }

    emit_progress(app, 100, "JDK instalado com sucesso!");
    Ok(())
}

fn extract_jdk_archive(archive: &Path, dest: &Path) -> Result<(), String> {
    if cfg!(windows) {
        let out = Command::new("powershell")
            .args(["-NoProfile", "-Command"])
            .arg(format!(
                "Expand-Archive -Path '{}' -DestinationPath '{}' -Force",
                archive.display(),
                dest.display()
            ))
            .output()
            .map_err(|e| format!("Falha ao iniciar extracao do JDK: {e}"))?;

        if !out.status.success() {
            return Err(format!(
                "Falha ao extrair JDK: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            ));
        }
    } else {
        let out = Command::new("tar")
            .arg("-xzf")
            .arg(archive)
            .arg("-C")
            .arg(dest)
            .output()
            .map_err(|e| format!("Falha ao iniciar extracao do JDK: {e}"))?;

        if !out.status.success() {
            return Err(format!(
                "Falha ao extrair JDK: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            ));
        }
    }

    Ok(())
}

fn find_jdk_dir(extract_root: &Path) -> Option<PathBuf> {
    fs::read_dir(extract_root).ok()?.find_map(|entry| {
        let entry = entry.ok()?;
        if entry.path().is_dir() {
            Some(entry.path())
        } else {
            None
        }
    })
}
