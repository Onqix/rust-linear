use crate::ai::{fetch_anthropic_models, run_claude_triage, ClaudeModelOption};
use crate::db::{self, AiTriageResult, AppSettings, LinearIssue};
use crate::linear::fetch_linear_workspace;
use crate::AppState;
use chrono::Utc;
use tauri::State;

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<AppSettings, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::load_settings(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_settings(
    state: State<'_, AppState>,
    linear_api_key: String,
    anthropic_api_key: String,
    claude_model: String,
) -> Result<AppSettings, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    db::save_settings(&conn, &linear_api_key, &anthropic_api_key, &claude_model)
        .map_err(|e| e.to_string())?;
    db::load_settings(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn sync_linear(state: State<'_, AppState>) -> Result<Vec<LinearIssue>, String> {
    let api_key = {
        let conn = state.db.lock().map_err(|e| e.to_string())?;
        db::load_settings(&conn)
            .map_err(|e| e.to_string())?
            .linear_api_key
    };

    let (viewer, issues) = fetch_linear_workspace(&api_key).await?;

    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    db::save_viewer(&conn, &viewer.id, &viewer.name).map_err(|e| e.to_string())?;
    db::upsert_issues(&mut conn, &issues, &viewer.id, &viewer.name).map_err(|e| e.to_string())?;
    db::load_issues(&conn, Some(&viewer.id), Some(&viewer.name)).map_err(|e| e.to_string())
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
pub fn mark_issue_seen(
    state: State<'_, AppState>,
    issue_id: String,
) -> Result<Vec<LinearIssue>, String> {
    let conn = state.db.lock().map_err(|e| e.to_string())?;
    let now = Utc::now().to_rfc3339();
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
    let now = Utc::now().to_rfc3339();
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
pub fn install_desktop_entry() -> Result<String, String> {
    crate::install_linux_desktop_files()
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
