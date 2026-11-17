mod ai;
mod bridge;
mod commands;
mod db;
mod devsession;
mod linear;
mod mcp;
mod rerank;

use std::sync::{Arc, Mutex};
use tauri::Manager;

pub struct AppState {
    pub db: Arc<Mutex<rusqlite::Connection>>,
    pub bridge: bridge::BridgeController,
}

pub fn make_bridge_notify(app: tauri::AppHandle) -> mcp::Notify {
    Arc::new(move |event| {
        use tauri::Emitter;
        let _ = app.emit(event, ());
    })
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

pub fn open_url_system(url: &str) -> Result<(), String> {
    let trimmed = url.trim();
    if !(trimmed.starts_with("https://")
        || trimmed.starts_with("http://")
        || trimmed.starts_with("mailto:"))
    {
        return Err("Unsupported URL scheme".to_string());
    }

    #[cfg(target_os = "linux")]
    {
        let mut cmd = std::process::Command::new("xdg-open");
        cmd.arg(trimmed)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .env(
                "PATH",
                "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin",
            );
        for var in [
            "LD_LIBRARY_PATH",
            "LD_PRELOAD",
            "GIO_MODULE_DIR",
            "GSETTINGS_SCHEMA_DIR",
            "GTK_PATH",
            "GTK_EXE_PREFIX",
            "GDK_PIXBUF_MODULE_FILE",
            "GDK_PIXBUF_MODULEDIR",
        ] {
            cmd.env_remove(var);
        }
        cmd.spawn()
            .map_err(|e| format!("Failed to open URL via xdg-open: {e}"))?;
        return Ok(());
    }

    #[cfg(not(target_os = "linux"))]
    {
        Err("open_url_system is only used on Linux".to_string())
    }
}

pub fn send_desktop_notification(summary: &str, body: &str) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        if notify_rust::Notification::new()
            .appname("Linear Pulse")
            .icon("com.rustlinear.app")
            .summary(summary)
            .body(body)
            .show()
            .is_ok()
        {
            return Ok(());
        }

        let mut cmd = std::process::Command::new("notify-send");
        cmd.arg("-a")
            .arg("Linear Pulse")
            .arg("-i")
            .arg("com.rustlinear.app")
            .arg(summary)
            .arg(body)
            .env(
                "PATH",
                "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
            );
        cmd.env_remove("LD_LIBRARY_PATH");
        cmd.env_remove("LD_PRELOAD");
        cmd.spawn()
            .map_err(|e| format!("Failed to send desktop notification: {e}"))?;
        return Ok(());
    }

    #[cfg(not(target_os = "linux"))]
    {
        let _ = (summary, body);
        Ok(())
    }
}

#[cfg(target_os = "linux")]
fn strip_appdir_entries(val: &str, appdir: Option<&str>) -> String {
    val.split(':')
        .filter(|seg| {
            let trimmed = seg.trim();
            if trimmed.is_empty() || trimmed.starts_with("/tmp/.mount_") {
                return false;
            }
            if let Some(dir) = appdir {
                if trimmed.starts_with(dir) {
                    return false;
                }
            }
            true
        })
        .collect::<Vec<_>>()
        .join(":")
}

#[cfg(target_os = "linux")]
pub fn relaunch_app(app: &tauri::AppHandle) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    use std::os::unix::process::CommandExt;

    let appimage_env = std::env::var("APPIMAGE")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let target_bin: std::path::PathBuf = if let Some(ref path) = appimage_env {
        std::path::PathBuf::from(path)
    } else {
        std::env::current_exe().map_err(|e| format!("Failed to locate current binary: {e}"))?
    };

    if !target_bin.exists() {
        return Err(format!(
            "Updated executable was not found at {}",
            target_bin.display()
        ));
    }

    if appimage_env.is_some() {
        if let Ok(meta) = std::fs::metadata(&target_bin) {
            let mut perms = meta.permissions();
            perms.set_mode(perms.mode() | 0o755);
            let _ = std::fs::set_permissions(&target_bin, perms);
        }
        let _ = install_linux_desktop_files();
    }

    let appdir = std::env::var("APPDIR")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let clean_path = std::env::var("PATH")
        .ok()
        .map(|p| strip_appdir_entries(&p, appdir.as_deref()))
        .filter(|p| !p.is_empty())
        .unwrap_or_else(|| {
            "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin".to_string()
        });

    let clean_xdg_data_dirs = std::env::var("XDG_DATA_DIRS")
        .ok()
        .map(|d| strip_appdir_entries(&d, appdir.as_deref()))
        .filter(|d| !d.is_empty());

    let work_dir = std::env::var("HOME")
        .ok()
        .map(std::path::PathBuf::from)
        .filter(|p| p.is_dir())
        .unwrap_or_else(|| std::path::PathBuf::from("/tmp"));

    let old_pid = std::process::id().to_string();
    let target_bin_str = target_bin.to_string_lossy().into_owned();
    let script = "i=0; while kill -0 \"$1\" 2>/dev/null && [ \"$i\" -lt 60 ]; do sleep 0.1 || sleep 1; i=$((i + 1)); done; sleep 0.7 || sleep 1; for attempt in 1 2 3; do \"$2\" >/dev/null 2>&1 & new_pid=$!; sleep 1; if kill -0 \"$new_pid\" 2>/dev/null; then exit 0; fi; done; exec \"$2\"";

    let configure_cmd = |cmd: &mut std::process::Command| {
        cmd.current_dir(&work_dir)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .env("PATH", &clean_path)
            .process_group(0);

        if let Some(ref xdg_dirs) = clean_xdg_data_dirs {
            cmd.env("XDG_DATA_DIRS", xdg_dirs);
        }

        for var in [
            "APPIMAGE",
            "APPDIR",
            "OWD",
            "ARGV0",
            "APPIMAGE_EXTRACT_AND_RUN",
            "LD_LIBRARY_PATH",
            "LD_PRELOAD",
            "GIO_MODULE_DIR",
            "GIO_EXTRA_MODULES",
            "GSETTINGS_SCHEMA_DIR",
            "GTK_PATH",
            "GTK_EXE_PREFIX",
            "GTK_DATA_PREFIX",
            "GTK_IM_MODULE_FILE",
            "GDK_PIXBUF_MODULE_FILE",
            "GDK_PIXBUF_MODULEDIR",
            "QT_PLUGIN_PATH",
            "PERLLIB",
            "GCONV_PATH",
        ] {
            cmd.env_remove(var);
        }
    };

    let mut systemd_cmd = std::process::Command::new("systemd-run");
    systemd_cmd
        .args([
            "--user",
            "--scope",
            "--quiet",
            "--collect",
            "/bin/sh",
            "-c",
            script,
            "rust-linear-relaunch",
            &old_pid,
            &target_bin_str,
        ]);
    configure_cmd(&mut systemd_cmd);

    if systemd_cmd.spawn().is_err() {
        let mut sh_cmd = std::process::Command::new("/bin/sh");
        sh_cmd.args(["-c", script, "rust-linear-relaunch", &old_pid, &target_bin_str]);
        configure_cmd(&mut sh_cmd);
        sh_cmd
            .spawn()
            .map_err(|e| format!("Failed to spawn relaunch helper: {e}"))?;
    }

    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(250));
        handle.exit(0);
        std::thread::sleep(std::time::Duration::from_millis(1200));
        std::process::exit(0);
    });
    Ok(())
}

#[cfg(not(target_os = "linux"))]
pub fn relaunch_app(app: &tauri::AppHandle) -> Result<(), String> {
    app.restart();
}

#[cfg(target_os = "linux")]
fn ensure_linux_gtk_settings_ini() {
    let config_dir = std::env::var("XDG_CONFIG_HOME")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .map(std::path::PathBuf::from)
        .or_else(|| {
            std::env::var("HOME")
                .ok()
                .map(|h| std::path::PathBuf::from(h).join(".config"))
        });

    let Some(config_dir) = config_dir else {
        return;
    };

    for subdir in ["gtk-3.0", "gtk-4.0"] {
        let dir = config_dir.join(subdir);
        if std::fs::create_dir_all(&dir).is_err() {
            continue;
        }
        let ini_path = dir.join("settings.ini");
        if ini_path.exists() {
            if let Ok(existing) = std::fs::read_to_string(&ini_path) {
                if !existing.contains("gtk-decoration-layout") {
                    let updated = if existing.contains("[Settings]") {
                        existing.replacen(
                            "[Settings]",
                            "[Settings]\ngtk-decoration-layout=menu:minimize,maximize,close",
                            1,
                        )
                    } else {
                        let sep = if existing.is_empty() || existing.ends_with('\n') {
                            ""
                        } else {
                            "\n"
                        };
                        format!(
                            "{existing}{sep}[Settings]\ngtk-decoration-layout=menu:minimize,maximize,close\n"
                        )
                    };
                    let _ = std::fs::write(&ini_path, updated);
                }
            }
        } else {
            let contents = "[Settings]\ngtk-decoration-layout=menu:minimize,maximize,close\ngtk-application-prefer-dark-theme=1\n";
            let _ = std::fs::write(&ini_path, contents);
        }
    }
}

#[cfg(target_os = "linux")]
fn apply_linux_gtk_decorations() {
    use std::os::raw::{c_char, c_int, c_void};

    #[link(name = "gtk-3")]
    #[link(name = "gobject-2.0")]
    extern "C" {
        fn gtk_settings_get_default() -> *mut c_void;
        fn g_object_set(object: *mut c_void, first_property_name: *const c_char, ...);
    }

    unsafe {
        let settings = gtk_settings_get_default();
        if !settings.is_null() {
            g_object_set(
                settings,
                b"gtk-decoration-layout\0".as_ptr() as *const c_char,
                b"menu:minimize,maximize,close\0".as_ptr() as *const c_char,
                b"gtk-application-prefer-dark-theme\0".as_ptr() as *const c_char,
                1 as c_int,
                std::ptr::null::<c_char>(),
            );
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = dotenvy::dotenv();

    #[cfg(target_os = "linux")]
    ensure_linux_gtk_settings_ini();

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
            let initial_bridge = db::load_bridge_settings(&conn)?;
            let db = Arc::new(Mutex::new(conn));
            app.manage(AppState {
                db: Arc::clone(&db),
                bridge: bridge::BridgeController::new(),
            });

            if initial_bridge.server_enabled || initial_bridge.tunnel_enabled {
                let handle = app.handle().clone();
                let notify = make_bridge_notify(handle.clone());
                let app_version = app.package_info().version.to_string();
                let db_for_bridge = Arc::clone(&db);
                tauri::async_runtime::spawn(async move {
                    let state = handle.state::<AppState>();
                    state
                        .bridge
                        .apply(initial_bridge, db_for_bridge, notify, app_version)
                        .await;
                });
            }

            #[cfg(target_os = "linux")]
            apply_linux_gtk_decorations();

            if let Some(window) = app.get_webview_window("main") {
                if let Ok(icon) = tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png")) {
                    let _ = window.set_icon(icon);
                }
                let _ = window.set_resizable(true);
                let _ = window.set_minimizable(true);
                let _ = window.set_maximizable(true);
                let _ = window.set_closable(true);
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
            commands::open_external_url,
            commands::test_notification,
            commands::check_app_update,
            commands::install_app_update,
            commands::relaunch_application,
            commands::run_ai_triage,
            commands::get_cached_triage,
            commands::list_claude_models,
            commands::list_projects,
            commands::create_project,
            commands::update_project,
            commands::get_backlog,
            commands::get_backlog_groups,
            commands::set_backlog_order,
            commands::add_issue_to_backlog,
            commands::remove_issue_from_backlog,
            commands::clear_done_from_backlog,
            commands::get_bridge_settings,
            commands::save_bridge_settings,
            commands::regenerate_bridge_token,
            commands::get_bridge_status,
            commands::start_rerank,
            commands::list_rerank_runs,
            commands::start_dev_session,
            commands::add_to_dev_session,
            commands::remove_from_dev_session,
            commands::list_dev_sessions,
            commands::refresh_dev_sessions,
            commands::stop_dev_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
