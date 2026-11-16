mod ai;
mod commands;
mod db;
mod linear;

use std::sync::Mutex;
use tauri::Manager;

pub struct AppState {
    pub db: Mutex<rusqlite::Connection>,
}

#[cfg(target_os = "linux")]
pub fn install_linux_desktop_files() -> Result<String, String> {
    let exe_path = std::env::var("APPIMAGE")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .or_else(|| {
            std::env::current_exe()
                .ok()
                .map(|p| p.to_string_lossy().into_owned())
        })
        .ok_or_else(|| "Could not resolve executable path".to_string())?;

    let data_home = std::env::var("XDG_DATA_HOME")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .map(std::path::PathBuf::from)
        .or_else(|| {
            std::env::var("HOME")
                .ok()
                .map(|h| std::path::PathBuf::from(h).join(".local/share"))
        })
        .ok_or_else(|| "Could not resolve HOME or XDG_DATA_HOME".to_string())?;

    let icon_512_dir = data_home.join("icons/hicolor/512x512/apps");
    let icon_128_dir = data_home.join("icons/hicolor/128x128/apps");
    let pixmaps_dir = data_home.join("pixmaps");
    let apps_dir = data_home.join("applications");

    std::fs::create_dir_all(&icon_512_dir).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&icon_128_dir).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&pixmaps_dir).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&apps_dir).map_err(|e| e.to_string())?;

    let icon_512_bytes = include_bytes!("../icons/icon.png");
    let icon_128_bytes = include_bytes!("../icons/128x128.png");

    std::fs::write(icon_512_dir.join("com.rustlinear.app.png"), icon_512_bytes)
        .map_err(|e| e.to_string())?;
    std::fs::write(pixmaps_dir.join("com.rustlinear.app.png"), icon_512_bytes)
        .map_err(|e| e.to_string())?;
    std::fs::write(icon_128_dir.join("com.rustlinear.app.png"), icon_128_bytes)
        .map_err(|e| e.to_string())?;

    let desktop_contents = format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Name=Linear Pulse\n\
         Comment=Custom Linear command center with unread response tracking and AI triage\n\
         Exec=\"{exe_path}\" %U\n\
         Icon=com.rustlinear.app\n\
         Terminal=false\n\
         Categories=Development;Utility;\n\
         StartupWMClass=rust-linear\n\
         StartupNotify=true\n"
    );

    let desktop_path = apps_dir.join("com.rustlinear.app.desktop");
    std::fs::write(&desktop_path, desktop_contents).map_err(|e| e.to_string())?;

    let _ = std::process::Command::new("update-desktop-database")
        .arg(&apps_dir)
        .status();
    let _ = std::process::Command::new("gtk-update-icon-cache")
        .arg("-f")
        .arg("-t")
        .arg(data_home.join("icons/hicolor"))
        .status();

    Ok(format!(
        "Installed desktop launcher & icon at {}",
        desktop_path.display()
    ))
}

#[cfg(not(target_os = "linux"))]
pub fn install_linux_desktop_files() -> Result<String, String> {
    Ok("Desktop file installation is only needed on Linux.".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = dotenvy::dotenv();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let app_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(&app_dir)?;
            let db_path = app_dir.join("rust-linear.db");
            let conn = db::init_db(&db_path)?;
            app.manage(AppState {
                db: Mutex::new(conn),
            });

            if let Some(window) = app.get_webview_window("main") {
                if let Ok(icon) = tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png")) {
                    let _ = window.set_icon(icon);
                }
            }

            #[cfg(target_os = "linux")]
            if std::env::var("APPIMAGE").is_ok() {
                let _ = install_linux_desktop_files();
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::save_settings,
            commands::sync_linear,
            commands::get_workspace_meta,
            commands::get_issues,
            commands::search_linear_remote,
            commands::refresh_issue_detail,
            commands::create_issue,
            commands::update_issue,
            commands::add_comment,
            commands::mark_issue_seen,
            commands::mark_all_seen,
            commands::mark_issue_unread,
            commands::get_saved_views,
            commands::save_custom_view,
            commands::delete_saved_view,
            commands::install_desktop_entry,
            commands::run_ai_triage,
            commands::get_cached_triage,
            commands::list_claude_models,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
