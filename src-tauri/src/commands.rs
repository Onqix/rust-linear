use crate::ai::{fetch_anthropic_models, run_claude_triage, ClaudeModelOption};
use crate::db::{
    self, AiTriageResult, AppSettings, LinearIssue, SavedView, WorkspaceMetadata,
};
use crate::linear::{
    create_linear_comment, create_linear_issue, fetch_issues_sync, fetch_single_issue,
    fetch_workspace_catalog, search_issues_remote, update_linear_issue, CreateIssueInput,
    UpdateIssuePatch,
};
use crate::AppState;
use chrono::{Duration, SecondsFormat, Utc};
use serde::Serialize;
use tauri::State;

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
