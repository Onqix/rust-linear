use crate::ai::{fetch_anthropic_models, run_claude_triage, ClaudeModelOption};
use crate::bridge::BridgeStatus;
use crate::db::{
    self, AiTriageResult, AppSettings, BacklogEntry, BacklogGroup, BacklogTheme, BridgeSettings,
    DevSession, DevSessionView, IssueDependency, LinearIssue, RerankRun, SavedView,
    WorkspaceMetadata,
};
use std::sync::Arc;
use crate::linear::{
    create_block_relation, create_linear_comment, create_linear_issue, create_linear_project,
    fetch_block_relations, fetch_issues_sync, fetch_projects_overview, fetch_single_issue,
    fetch_workspace_catalog, search_issues_remote, update_linear_issue, update_linear_project,
    CreateIssueInput, CreateProjectInput, LinearProjectDetail, ProjectsOverview, UpdateIssuePatch,
    UpdateProjectPatch,
};
use crate::AppState;
use chrono::{Duration, SecondsFormat, Utc};
use serde::Serialize;
use tauri::State;
use tauri_plugin_updater::UpdaterExt;

#[derive(Debug, Clone, Serialize)]
pub struct AppUpdateInfo {
    pub version: String,
    pub body: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CreateIssueResponse {
    pub created_id: String,
    pub issues: Vec<LinearIssue>,
}

fn load_linear_context(state: &State<'_, AppState>) -> Result<AppSettings, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::load_settings(&conn).map_err(|e| e.to_string())
}

fn upsert_and_reload_single(
    state: &State<'_, AppState>,
    issue: LinearIssue,
    mark_seen_now: bool,
) -> Result<Vec<LinearIssue>, String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let settings = db::load_settings(&conn).map_err(|e| e.to_string())?;
    let viewer_id = settings.viewer_id.clone().unwrap_or_default();
    let viewer_name = settings.viewer_name.clone().unwrap_or_default();
    let issue_id = issue.id.clone();

    db::upsert_issues_batch(&mut conn, &[issue], &viewer_id, &viewer_name, false)
        .map_err(|e| e.to_string())?;

    if mark_seen_now {
        let now = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
        db::mark_issue_seen(&conn, &issue_id, &now).map_err(|e| e.to_string())?;
    }

    db::load_issues(
        &conn,
        settings.viewer_id.as_deref(),
        settings.viewer_name.as_deref(),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    load_linear_context(&state)
}

#[tauri::command]
pub fn save_settings(
    state: State<'_, AppState>,
    linear_api_key: String,
    anthropic_api_key: String,
    claude_model: String,
    auto_sync_seconds: Option<i64>,
    notifications_enabled: Option<bool>,
) -> Result<AppSettings, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let current = db::load_settings(&conn).map_err(|e| e.to_string())?;
    let next_sync = auto_sync_seconds.unwrap_or(current.auto_sync_seconds);
    let next_notify = notifications_enabled.unwrap_or(current.notifications_enabled);
    db::save_settings(
        &conn,
        &linear_api_key,
        &anthropic_api_key,
        &claude_model,
        next_sync,
        next_notify,
    )
    .map_err(|e| e.to_string())?;
    db::load_settings(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sync_linear(
    state: State<'_, AppState>,
    full_resync: Option<bool>,
    background: Option<bool>,
) -> Result<Vec<LinearIssue>, String> {
    let force_full = full_resync.unwrap_or(false);
    let is_background = background.unwrap_or(false);
    let (settings, since, known_comment_ids) = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let settings = db::load_settings(&conn).map_err(|e| e.to_string())?;
        let cursor = if force_full {
            None
        } else {
            db::get_sync_cursor(&conn).map_err(|e| e.to_string())?
        };
        let known_ids = if cursor.is_some() && settings.notifications_enabled {
            db::list_comment_ids(&conn).map_err(|e| e.to_string())?
        } else {
            std::collections::HashSet::new()
        };
        (settings, cursor, known_ids)
    };

    let sync_started =
        (Utc::now() - Duration::minutes(2)).to_rfc3339_opts(SecondsFormat::Millis, true);

    let reloaded = if is_background && since.is_some() && settings.viewer_id.is_some() {
        let issues = fetch_issues_sync(&settings.linear_api_key, since.as_deref()).await?;
        let viewer_id = settings.viewer_id.clone().unwrap_or_default();
        let viewer_name = settings.viewer_name.clone().unwrap_or_default();

        let mut conn = state.db.lock().map_err(|e| e.to_string())?;
        db::upsert_issues_batch(&mut conn, &issues, &viewer_id, &viewer_name, false)
            .map_err(|e| e.to_string())?;
        db::set_sync_cursor(&conn, &sync_started).map_err(|e| e.to_string())?;
        db::load_issues(&conn, Some(&viewer_id), Some(&viewer_name)).map_err(|e| e.to_string())?
    } else {
        let ((viewer, meta), issues) = tokio::try_join!(
            fetch_workspace_catalog(&settings.linear_api_key),
            fetch_issues_sync(&settings.linear_api_key, since.as_deref())
        )?;

        let mut conn = state.db.lock().map_err(|e| e.to_string())?;
        db::save_viewer(&conn, &viewer.id, &viewer.name).map_err(|e| e.to_string())?;
        db::save_workspace_meta(&conn, &meta).map_err(|e| e.to_string())?;
        db::upsert_issues_batch(
            &mut conn,
            &issues,
            &viewer.id,
            &viewer.name,
            force_full && since.is_none(),
        )
        .map_err(|e| e.to_string())?;
        db::set_sync_cursor(&conn, &sync_started).map_err(|e| e.to_string())?;
        db::load_issues(&conn, Some(&viewer.id), Some(&viewer.name)).map_err(|e| e.to_string())?
    };

    if since.is_some() && settings.notifications_enabled {
        let new_unreads: Vec<(&LinearIssue, &crate::db::LinearComment)> = reloaded
            .iter()
            .flat_map(|issue| {
                issue
                    .comments
                    .iter()
                    .filter(|c| c.is_unread && !known_comment_ids.contains(&c.id))
                    .map(move |c| (issue, c))
            })
            .collect();

        if new_unreads.len() == 1 {
            let (issue, comment) = new_unreads[0];
            let snippet: String = comment
                .body
                .replace('\n', " ")
                .trim()
                .chars()
                .take(140)
                .collect();
            let summary = format!("{} replied on {}", comment.author_name, issue.identifier);
            let body = format!("{}\n{}", issue.title, snippet);
            let _ = crate::send_desktop_notification(&summary, &body);
        } else if new_unreads.len() > 1 {
            let mut summary_items: Vec<String> = new_unreads
                .iter()
                .take(3)
                .map(|(issue, c)| format!("{} on {}", c.author_name, issue.identifier))
                .collect();
            if new_unreads.len() > 3 {
                summary_items.push(format!("+{} more", new_unreads.len() - 3));
            }
            let summary = format!("{} new Linear responses", new_unreads.len());
            let body = summary_items.join(", ");
            let _ = crate::send_desktop_notification(&summary, &body);
        }
    }

    Ok(reloaded)
}

#[tauri::command]
pub fn get_workspace_meta(state: State<'_, AppState>) -> Result<WorkspaceMetadata, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::load_workspace_meta(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_issues(state: State<'_, AppState>) -> Result<Vec<LinearIssue>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let settings = db::load_settings(&conn).map_err(|e| e.to_string())?;
    db::load_issues(
        &conn,
        settings.viewer_id.as_deref(),
        settings.viewer_name.as_deref(),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn search_linear_remote(
    state: State<'_, AppState>,
    term: String,
) -> Result<Vec<LinearIssue>, String> {
    let settings = load_linear_context(&state)?;
    let hits = search_issues_remote(&settings.linear_api_key, &term).await?;

    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let viewer_id = settings.viewer_id.clone().unwrap_or_default();
    let viewer_name = settings.viewer_name.clone().unwrap_or_default();
    db::upsert_issues_batch(&mut conn, &hits, &viewer_id, &viewer_name, false)
        .map_err(|e| e.to_string())?;
    db::load_issues(
        &conn,
        settings.viewer_id.as_deref(),
        settings.viewer_name.as_deref(),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn refresh_issue_detail(
    state: State<'_, AppState>,
    issue_id: String,
) -> Result<Vec<LinearIssue>, String> {
    let settings = load_linear_context(&state)?;
    let fresh = fetch_single_issue(&settings.linear_api_key, &issue_id).await?;
    upsert_and_reload_single(&state, fresh, false)
}

#[tauri::command]
pub async fn create_issue(
    state: State<'_, AppState>,
    input: CreateIssueInput,
) -> Result<CreateIssueResponse, String> {
    let settings = load_linear_context(&state)?;
    let created = create_linear_issue(&settings.linear_api_key, input).await?;
    let created_id = created.id.clone();
    let issues = upsert_and_reload_single(&state, created, true)?;
    Ok(CreateIssueResponse { created_id, issues })
}

#[tauri::command]
pub async fn update_issue(
    state: State<'_, AppState>,
    issue_id: String,
    patch: UpdateIssuePatch,
) -> Result<Vec<LinearIssue>, String> {
    let settings = load_linear_context(&state)?;
    let updated = update_linear_issue(&settings.linear_api_key, &issue_id, patch).await?;
    upsert_and_reload_single(&state, updated, false)
}

#[tauri::command]
pub async fn add_comment(
    state: State<'_, AppState>,
    issue_id: String,
    body: String,
) -> Result<Vec<LinearIssue>, String> {
    let settings = load_linear_context(&state)?;
    let updated = create_linear_comment(&settings.linear_api_key, &issue_id, &body).await?;
    upsert_and_reload_single(&state, updated, true)
}

#[tauri::command]
pub fn mark_issue_seen(
    state: State<'_, AppState>,
    issue_id: String,
) -> Result<Vec<LinearIssue>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    db::mark_issue_seen(&conn, &issue_id, &now).map_err(|e| e.to_string())?;
    let settings = db::load_settings(&conn).map_err(|e| e.to_string())?;
    db::load_issues(
        &conn,
        settings.viewer_id.as_deref(),
        settings.viewer_name.as_deref(),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn mark_all_seen(state: State<'_, AppState>) -> Result<Vec<LinearIssue>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    db::mark_all_issues_seen(&conn, &now).map_err(|e| e.to_string())?;
    let settings = db::load_settings(&conn).map_err(|e| e.to_string())?;
    db::load_issues(
        &conn,
        settings.viewer_id.as_deref(),
        settings.viewer_name.as_deref(),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn mark_issue_unread(
    state: State<'_, AppState>,
    issue_id: String,
) -> Result<Vec<LinearIssue>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::mark_issue_unread(&conn, &issue_id).map_err(|e| e.to_string())?;
    let settings = db::load_settings(&conn).map_err(|e| e.to_string())?;
    db::load_issues(
        &conn,
        settings.viewer_id.as_deref(),
        settings.viewer_name.as_deref(),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_saved_views(state: State<'_, AppState>) -> Result<Vec<SavedView>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::list_saved_views(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_custom_view(
    state: State<'_, AppState>,
    view: SavedView,
) -> Result<Vec<SavedView>, String> {
    if view.name.trim().is_empty() {
        return Err("View name cannot be empty.".to_string());
    }
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::upsert_saved_view(&conn, &view).map_err(|e| e.to_string())?;
    db::list_saved_views(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_saved_view(
    state: State<'_, AppState>,
    view_id: String,
) -> Result<Vec<SavedView>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::delete_saved_view(&conn, &view_id).map_err(|e| e.to_string())?;
    db::list_saved_views(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn install_desktop_entry() -> Result<String, String> {
    crate::install_linux_desktop_files()
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    crate::open_url_system(&url)
}

#[tauri::command]
pub fn test_notification() -> Result<(), String> {
    crate::send_desktop_notification(
        "Linear Pulse",
        "Desktop notifications are active on Ubuntu.",
    )
}

#[tauri::command]
pub fn relaunch_application(app: tauri::AppHandle) -> Result<(), String> {
    crate::relaunch_app(&app)
}

async fn resolve_latest_manifest_urls() -> Vec<tauri::Url> {
    let ts = Utc::now().timestamp_millis();
    let mut urls = Vec::new();

    if let Ok(client) = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
    {
        if let Ok(resp) = client
            .get("https://api.github.com/repos/Onqix/rust-linear/releases/latest")
            .header("User-Agent", "rust-linear-updater")
            .header("Accept", "application/vnd.github+json")
            .header("Cache-Control", "no-cache, no-store, must-revalidate")
            .header("Pragma", "no-cache")
            .send()
            .await
        {
            if resp.status().is_success() {
                if let Ok(json) = resp.json::<serde_json::Value>().await {
                    if let Some(tag) = json
                        .get("tag_name")
                        .and_then(|v| v.as_str())
                        .map(str::trim)
                        .filter(|s| !s.is_empty())
                    {
                        let direct = format!(
                            "https://github.com/Onqix/rust-linear/releases/download/{tag}/latest.json?t={ts}"
                        );
                        if let Ok(parsed) = tauri::Url::parse(&direct) {
                            urls.push(parsed);
                        }
                    }
                }
            }
        }
    }

    let fallback = format!(
        "https://github.com/Onqix/rust-linear/releases/latest/download/latest.json?t={ts}"
    );
    if let Ok(parsed) = tauri::Url::parse(&fallback) {
        urls.push(parsed);
    }

    urls
}

async fn build_fresh_updater(app: &tauri::AppHandle) -> Result<tauri_plugin_updater::Updater, String> {
    let endpoints = resolve_latest_manifest_urls().await;
    let mut builder = app.updater_builder();
    if !endpoints.is_empty() {
        builder = builder.endpoints(endpoints).map_err(|e| e.to_string())?;
    }
    builder = builder
        .header("Cache-Control", "no-cache, no-store, must-revalidate")
        .map_err(|e| e.to_string())?;
    builder = builder
        .header("Pragma", "no-cache")
        .map_err(|e| e.to_string())?;
    builder.build().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn check_app_update(app: tauri::AppHandle) -> Result<Option<AppUpdateInfo>, String> {
    let updater = build_fresh_updater(&app).await?;
    let maybe_update = updater.check().await.map_err(|e| e.to_string())?;
    Ok(maybe_update.map(|u| AppUpdateInfo {
        version: u.version,
        body: u.body,
    }))
}

#[tauri::command]
pub async fn install_app_update(app: tauri::AppHandle) -> Result<String, String> {
    let updater = build_fresh_updater(&app).await?;
    let update = updater
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "No update is currently available.".to_string())?;
    let target_version = update.version.clone();
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| e.to_string())?;
    Ok(target_version)
}

#[tauri::command]
pub async fn run_ai_triage(state: State<'_, AppState>) -> Result<AiTriageResult, String> {
    let (settings, issues) = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let settings = db::load_settings(&conn).map_err(|e| e.to_string())?;
        let issues = db::load_issues(
            &conn,
            settings.viewer_id.as_deref(),
            settings.viewer_name.as_deref(),
        )
        .map_err(|e| e.to_string())?;
        (settings, issues)
    };

    let result = run_claude_triage(
        &settings.anthropic_api_key,
        &settings.claude_model,
        settings.viewer_name.as_deref(),
        &issues,
    )
    .await?;

    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::save_triage_cache(&conn, &result).map_err(|e| e.to_string())?;
    Ok(result)
}

#[tauri::command]
pub fn get_cached_triage(state: State<'_, AppState>) -> Result<Option<AiTriageResult>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::load_triage_cache(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_claude_models(
    state: State<'_, AppState>,
    api_key: Option<String>,
) -> Result<Vec<ClaudeModelOption>, String> {
    let effective_key = match api_key
        .map(|k| k.trim().to_string())
        .filter(|k| !k.is_empty())
    {
        Some(k) => k,
        None => {
            let conn = state.db.lock().map_err(|e| e.to_string())?;
            db::load_settings(&conn)
                .map_err(|e| e.to_string())?
                .anthropic_api_key
        }
    };
    fetch_anthropic_models(&effective_key).await
}

#[tauri::command]
pub async fn list_projects(state: State<'_, AppState>) -> Result<ProjectsOverview, String> {
    let settings = load_linear_context(&state)?;
    fetch_projects_overview(&settings.linear_api_key).await
}

#[tauri::command]
pub async fn create_project(
    state: State<'_, AppState>,
    input: CreateProjectInput,
) -> Result<LinearProjectDetail, String> {
    let settings = load_linear_context(&state)?;
    create_linear_project(&settings.linear_api_key, input).await
}

#[tauri::command]
pub async fn update_project(
    state: State<'_, AppState>,
    project_id: String,
    patch: UpdateProjectPatch,
) -> Result<LinearProjectDetail, String> {
    let settings = load_linear_context(&state)?;
    update_linear_project(&settings.linear_api_key, &project_id, patch).await
}

#[tauri::command]
pub fn get_backlog(state: State<'_, AppState>) -> Result<Vec<BacklogEntry>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::load_backlog(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_backlog_groups(state: State<'_, AppState>) -> Result<Vec<BacklogGroup>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::load_backlog_groups(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_backlog_themes(state: State<'_, AppState>) -> Result<Vec<BacklogTheme>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::load_backlog_themes(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_backlog_dependencies(
    state: State<'_, AppState>,
) -> Result<Vec<IssueDependency>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::load_dependencies(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn refresh_backlog_dependencies(
    state: State<'_, AppState>,
) -> Result<Vec<IssueDependency>, String> {
    let (api_key, backlog_ids) = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let settings = db::load_settings(&conn).map_err(|e| e.to_string())?;
        let entries = db::load_backlog(&conn).map_err(|e| e.to_string())?;
        let ids: Vec<String> = entries.into_iter().map(|e| e.issue_id).collect();
        (settings.linear_api_key, ids)
    };

    if !backlog_ids.is_empty() {
        let rels = fetch_block_relations(&api_key, &backlog_ids).await?;
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::replace_linear_dependencies(&conn, &backlog_ids, &rels).map_err(|e| e.to_string())?;
        return db::load_dependencies(&conn).map_err(|e| e.to_string());
    }

    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::load_dependencies(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn confirm_dependency(
    state: State<'_, AppState>,
    issue_id: String,
    blocker_id: String,
) -> Result<Vec<IssueDependency>, String> {
    let api_key = load_linear_context(&state)?.linear_api_key;
    create_block_relation(&api_key, &blocker_id, &issue_id).await?;
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::set_dependency_source(&conn, &issue_id, &blocker_id, "linear")
        .map_err(|e| e.to_string())?;
    db::load_dependencies(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn dismiss_dependency(
    state: State<'_, AppState>,
    issue_id: String,
    blocker_id: String,
) -> Result<Vec<IssueDependency>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::set_dependency_source(&conn, &issue_id, &blocker_id, "dismissed")
        .map_err(|e| e.to_string())?;
    db::load_dependencies(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_backlog_order(
    state: State<'_, AppState>,
    issue_ids: Vec<String>,
) -> Result<Vec<BacklogEntry>, String> {
    let items: Vec<(String, Option<String>)> =
        issue_ids.into_iter().map(|id| (id, None)).collect();
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    db::replace_backlog(&mut conn, &items, "me").map_err(|e| e.to_string())?;
    db::load_backlog(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_issue_to_backlog(
    state: State<'_, AppState>,
    issue_id: String,
) -> Result<Vec<BacklogEntry>, String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    db::add_to_backlog(&mut conn, &issue_id, None, None, "me").map_err(|e| e.to_string())?;
    db::load_backlog(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_issue_from_backlog(
    state: State<'_, AppState>,
    issue_id: String,
) -> Result<Vec<BacklogEntry>, String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    db::remove_from_backlog(&mut conn, &issue_id).map_err(|e| e.to_string())?;
    db::load_backlog(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_done_from_backlog(state: State<'_, AppState>) -> Result<Vec<BacklogEntry>, String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    let settings = db::load_settings(&conn).map_err(|e| e.to_string())?;
    let issues = db::load_issues(
        &conn,
        settings.viewer_id.as_deref(),
        settings.viewer_name.as_deref(),
    )
    .map_err(|e| e.to_string())?;

    let done_ids: Vec<String> = issues
        .into_iter()
        .filter(|i| {
            matches!(
                i.state_type.trim().to_lowercase().as_str(),
                "completed" | "canceled" | "cancelled"
            )
        })
        .map(|i| i.id)
        .collect();

    db::remove_backlog_where_done(&mut conn, &done_ids).map_err(|e| e.to_string())?;
    db::load_backlog(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_bridge_settings(state: State<'_, AppState>) -> Result<BridgeSettings, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::load_bridge_settings(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_bridge_settings(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    settings: BridgeSettings,
) -> Result<BridgeStatus, String> {
    if settings.port == 0 {
        return Err("MCP server port must be between 1 and 65535.".to_string());
    }
    if settings.remote_port == 0 {
        return Err("Remote tunnel port must be between 1 and 65535.".to_string());
    }

    let persisted = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let mut to_save = settings;
        to_save.dev_model = crate::devsession::validate_model(&to_save.dev_model)?;
        to_save.dev_effort = crate::devsession::validate_effort(&to_save.dev_effort)?;
        to_save.dev_launch_mode = if to_save.dev_launch_mode.trim() == "ssh" {
            "ssh".to_string()
        } else {
            "launcher".to_string()
        };
        to_save.dev_environment_id =
            crate::devsession::validate_environment_id(&to_save.dev_environment_id)?;
        if to_save.token.trim().is_empty() {
            let current = db::load_bridge_settings(&conn).map_err(|e| e.to_string())?;
            to_save.token = current.token;
        }
        db::save_bridge_settings(&conn, &to_save).map_err(|e| e.to_string())?;
        db::load_bridge_settings(&conn).map_err(|e| e.to_string())?
    };

    let notify = crate::make_bridge_notify(app.clone());
    let app_version = app.package_info().version.to_string();
    state
        .bridge
        .apply(persisted, Arc::clone(&state.db), notify, app_version)
        .await;

    Ok(state.bridge.status().await)
}

#[tauri::command]
pub async fn regenerate_bridge_token(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<BridgeSettings, String> {
    let new_token = db::generate_token();
    let updated = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let mut settings = db::load_bridge_settings(&conn).map_err(|e| e.to_string())?;
        settings.token = new_token;
        db::save_bridge_settings(&conn, &settings).map_err(|e| e.to_string())?;
        db::load_bridge_settings(&conn).map_err(|e| e.to_string())?
    };

    if updated.server_enabled {
        let notify = crate::make_bridge_notify(app.clone());
        let app_version = app.package_info().version.to_string();
        state
            .bridge
            .apply(updated.clone(), Arc::clone(&state.db), notify, app_version)
            .await;
    }

    Ok(updated)
}

#[tauri::command]
pub async fn get_bridge_status(state: State<'_, AppState>) -> Result<BridgeStatus, String> {
    Ok(state.bridge.status().await)
}

#[tauri::command]
pub fn start_rerank(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    comment: String,
) -> Result<RerankRun, String> {
    let trimmed_comment = comment.trim().to_string();
    let (run, settings) = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        if db::latest_running_rerank_run(&conn)
            .map_err(|e| e.to_string())?
            .is_some()
        {
            return Err("A rerank is already running.".to_string());
        }

        let mut id = db::generate_token();
        id.truncate(16);

        let run = RerankRun {
            id,
            comment: trimmed_comment,
            status: "running".to_string(),
            started_at: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
            finished_at: None,
            summary: None,
            error: None,
        };

        db::insert_rerank_run(&conn, &run).map_err(|e| e.to_string())?;
        let settings = db::load_bridge_settings(&conn).map_err(|e| e.to_string())?;
        (run, settings)
    };

    let notify = crate::make_bridge_notify(app);
    let db_arc = Arc::clone(&state.db);
    let notify_for_task = Arc::clone(&notify);
    let run_id = run.id.clone();
    let run_comment = run.comment.clone();

    tauri::async_runtime::spawn(async move {
        crate::rerank::run_rerank(db_arc, notify_for_task, settings, run_id, run_comment).await;
    });

    (notify)("rerank-changed");
    Ok(run)
}

#[tauri::command]
pub fn list_rerank_runs(state: State<'_, AppState>) -> Result<Vec<RerankRun>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::list_rerank_runs(&conn, 10).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn start_dev_session(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    issue_ids: Vec<String>,
    name: String,
    note: String,
    delivery: String,
    model: String,
    effort: String,
) -> Result<DevSessionView, String> {
    let clean_ids: Vec<String> = {
        let mut seen = std::collections::HashSet::new();
        issue_ids
            .into_iter()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty() && seen.insert(s.clone()))
            .collect()
    };
    if clean_ids.is_empty() {
        return Err("Select at least one issue to start a dev session.".to_string());
    }
    if delivery != "per_issue" && delivery != "combined" {
        return Err("Delivery must be 'per_issue' or 'combined'.".to_string());
    }
    let clean_model = crate::devsession::validate_model(&model)?;
    let clean_effort = crate::devsession::validate_effort(&effort)?;

    let (view, settings) = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let mut identifiers = Vec::with_capacity(clean_ids.len());
        for issue_id in &clean_ids {
            if let Ok(Some(ident)) = rusqlite::OptionalExtension::optional(conn.query_row(
                "SELECT identifier FROM issues WHERE id = ?1",
                rusqlite::params![issue_id],
                |row| row.get::<_, String>(0),
            )) {
                identifiers.push(ident);
            }
        }

        let clean_name = crate::devsession::sanitize_name(&name);
        let slug = crate::devsession::make_slug(&identifiers);
        let mut id = db::generate_token();
        id.truncate(16);
        let now = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);

        let session = DevSession {
            id: id.clone(),
            name: clean_name,
            slug,
            note: note.trim().to_string(),
            delivery,
            model: if clean_model.is_empty() {
                None
            } else {
                Some(clean_model.clone())
            },
            effort: if clean_effort.is_empty() {
                None
            } else {
                Some(clean_effort.clone())
            },
            launch_mode: None,
            remote_session_id: None,
            status: "starting".to_string(),
            agent_status: None,
            bg_id: None,
            error: None,
            started_at: now.clone(),
            updated_at: now,
            all_done_at: None,
            keep_open: false,
            cleanup_status: None,
        };

        db::insert_dev_session(&conn, &session, &clean_ids).map_err(|e| e.to_string())?;
        db::set_dev_defaults(&conn, &clean_model, &clean_effort).map_err(|e| e.to_string())?;
        let settings = db::load_bridge_settings(&conn).map_err(|e| e.to_string())?;
        let view = db::load_dev_session(&conn, &id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "Failed to load created dev session.".to_string())?;
        (view, settings)
    };

    let notify = crate::make_bridge_notify(app);
    let db_arc = Arc::clone(&state.db);
    let notify_for_task = Arc::clone(&notify);
    let session_id = view.session.id.clone();

    tauri::async_runtime::spawn(async move {
        crate::devsession::start_dev_session(db_arc, notify_for_task, settings, session_id).await;
    });

    (notify)("dev-sessions-changed");
    Ok(view)
}

#[tauri::command]
pub fn add_to_dev_session(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    issue_ids: Vec<String>,
) -> Result<DevSessionView, String> {
    let clean_ids: Vec<String> = {
        let mut seen = std::collections::HashSet::new();
        issue_ids
            .into_iter()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty() && seen.insert(s.clone()))
            .collect()
    };
    if clean_ids.is_empty() {
        return Err("Select at least one issue to add.".to_string());
    }

    let view = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let existing = db::load_dev_session(&conn, &session_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Dev session '{session_id}' not found."))?;
        if existing.session.status != "starting" && existing.session.status != "running" {
            return Err(format!(
                "Cannot add issues to a {} dev session.",
                existing.session.status
            ));
        }
        db::add_dev_session_items(&conn, &session_id, &clean_ids).map_err(|e| e.to_string())?;
        db::load_dev_session(&conn, &session_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Dev session '{session_id}' not found."))?
    };

    let notify = crate::make_bridge_notify(app);
    (notify)("dev-sessions-changed");
    Ok(view)
}

#[tauri::command]
pub fn remove_from_dev_session(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    issue_id: String,
) -> Result<DevSessionView, String> {
    let view = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        let existing = db::load_dev_session(&conn, &session_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Dev session '{session_id}' not found."))?;
        let item = existing
            .items
            .iter()
            .find(|i| i.issue_id == issue_id)
            .ok_or_else(|| format!("Issue '{issue_id}' is not in dev session '{session_id}'."))?;
        if item.status != "queued" {
            return Err("Only queued items can be removed from a dev session.".to_string());
        }
        db::set_dev_session_item_status(&conn, &session_id, &issue_id, "removed", None)
            .map_err(|e| e.to_string())?;
        db::load_dev_session(&conn, &session_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Dev session '{session_id}' not found."))?
    };

    let notify = crate::make_bridge_notify(app);
    (notify)("dev-sessions-changed");
    Ok(view)
}

#[tauri::command]
pub fn list_dev_sessions(state: State<'_, AppState>) -> Result<Vec<DevSessionView>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::list_dev_sessions(&conn, 20).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn refresh_dev_sessions(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<DevSessionView>, String> {
    let settings = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::load_bridge_settings(&conn).map_err(|e| e.to_string())?
    };

    let backlog_changed =
        crate::devsession::refresh_dev_sessions_checked(Arc::clone(&state.db), settings).await?;

    let notify = crate::make_bridge_notify(app);
    (notify)("dev-sessions-changed");
    if backlog_changed {
        (notify)("backlog-changed");
    }

    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::list_dev_sessions(&conn, 20).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_dev_session_keep_open(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
    keep_open: bool,
) -> Result<Vec<DevSessionView>, String> {
    let list = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::load_dev_session(&conn, &id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Dev session '{id}' not found."))?;
        db::set_dev_session_keep_open(&conn, &id, keep_open).map_err(|e| e.to_string())?;
        db::list_dev_sessions(&conn, 20).map_err(|e| e.to_string())?
    };

    let notify = crate::make_bridge_notify(app);
    (notify)("dev-sessions-changed");
    Ok(list)
}

#[tauri::command]
pub async fn finish_dev_session_now(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<DevSessionView>, String> {
    let settings = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::load_bridge_settings(&conn).map_err(|e| e.to_string())?
    };

    crate::devsession::finish_dev_session_now(Arc::clone(&state.db), settings, id).await?;

    let notify = crate::make_bridge_notify(app);
    (notify)("dev-sessions-changed");
    (notify)("backlog-changed");

    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::list_dev_sessions(&conn, 20).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn stop_dev_session(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<DevSessionView, String> {
    let settings = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::load_bridge_settings(&conn).map_err(|e| e.to_string())?
    };

    crate::devsession::stop_dev_session(Arc::clone(&state.db), settings, id.clone()).await?;

    let notify = crate::make_bridge_notify(app);
    (notify)("dev-sessions-changed");

    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::load_dev_session(&conn, &id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| format!("Dev session '{id}' not found."))
}

#[tauri::command]
pub async fn get_launcher_status(
    state: State<'_, AppState>,
) -> Result<crate::devsession::LauncherStatus, String> {
    let settings = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::load_bridge_settings(&conn).map_err(|e| e.to_string())?
    };
    crate::devsession::launcher_status(&settings).await
}

#[tauri::command]
pub async fn fetch_linear_image(state: State<'_, AppState>, url: String) -> Result<String, String> {
    let api_key = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::load_settings(&conn).map_err(|e| e.to_string())?.linear_api_key
    };
    crate::linear::fetch_upload_as_data_url(&api_key, &url).await
}
