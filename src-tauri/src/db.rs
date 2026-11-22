use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppSettings {
    pub linear_api_key: String,
    pub anthropic_api_key: String,
    pub claude_model: String,
    pub viewer_id: Option<String>,
    pub viewer_name: Option<String>,
    pub auto_sync_seconds: i64,
    pub notifications_enabled: bool,
    pub ai_provider: String,
    pub gemini_api_key: String,
    pub gemini_model: String,
    pub google_oauth_client_id: String,
    pub google_oauth_client_secret: String,
    pub google_oauth_email: Option<String>,
    pub google_oauth_connected: bool,
    pub antigravity_triage_model: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            linear_api_key: String::new(),
            anthropic_api_key: String::new(),
            claude_model: "claude-haiku-4-5".to_string(),
            viewer_id: None,
            viewer_name: None,
            auto_sync_seconds: 60,
            notifications_enabled: true,
            ai_provider: "anthropic".to_string(),
            gemini_api_key: String::new(),
            gemini_model: "gemini-2.5-flash".to_string(),
            google_oauth_client_id: String::new(),
            google_oauth_client_secret: String::new(),
            google_oauth_email: None,
            google_oauth_connected: false,
            antigravity_triage_model: "gemini-4-hydrogen-high".to_string(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct LinearComment {
    pub id: String,
    pub body: String,
    pub created_at: String,
    pub author_id: Option<String>,
    pub author_name: String,
    pub is_unread: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct LinearLinkedItem {
    pub kind: String,
    pub relation_label: String,
    pub id: String,
    pub identifier: Option<String>,
    pub title: String,
    pub subtitle: Option<String>,
    pub url: String,
    pub state_name: Option<String>,
    pub state_type: Option<String>,
    pub state_color: Option<String>,
    pub source_type: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct LinearIssue {
    pub id: String,
    pub identifier: String,
    pub title: String,
    pub description: Option<String>,
    pub url: String,
    pub priority: i64,
    pub priority_label: String,
    pub state_id: String,
    pub state_name: String,
    pub state_type: String,
    pub state_color: String,
    pub team_id: String,
    pub team_key: String,
    pub team_name: String,
    pub project_id: Option<String>,
    pub project_name: Option<String>,
    pub assignee_id: Option<String>,
    pub assignee_name: Option<String>,
    pub labels: Vec<String>,
    pub label_ids: Vec<String>,
    pub updated_at: String,
    pub created_at: String,
    pub completed_at: Option<String>,
    pub last_seen_at: Option<String>,
    pub unread_responses: usize,
    pub comments: Vec<LinearComment>,
    pub links: Vec<LinearLinkedItem>,
    pub links_loaded: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct LinearWorkflowState {
    pub id: String,
    pub name: String,
    pub state_type: String,
    pub color: String,
    pub position: f64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct LinearTeam {
    pub id: String,
    pub key: String,
    pub name: String,
    pub states: Vec<LinearWorkflowState>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct LinearUser {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct LinearProject {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct LinearLabel {
    pub id: String,
    pub name: String,
    pub color: String,
    pub team_id: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct WorkspaceMetadata {
    pub teams: Vec<LinearTeam>,
    pub users: Vec<LinearUser>,
    pub projects: Vec<LinearProject>,
    pub labels: Vec<LinearLabel>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct SavedView {
    pub id: String,
    pub name: String,
    pub icon: String,
    pub match_mode: String,
    pub filters_json: String,
    pub board_columns_json: String,
    pub team_filter: String,
    pub scope_filter: String,
    pub assignee_filter: String,
    pub project_filter: String,
    pub label_filter: String,
    pub search_query: String,
    pub layout_mode: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct AiSuggestion {
    pub identifier: String,
    pub title: String,
    pub reason: String,
    pub urgency: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct AiWorkBucket {
    pub name: String,
    pub description: String,
    pub tickets: Vec<AiSuggestion>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiTriageResult {
    pub generated_at: String,
    pub model: String,
    pub summary: String,
    pub next_to_grab: Vec<AiSuggestion>,
    pub work_buckets: Vec<AiWorkBucket>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BacklogEntry {
    pub issue_id: String,
    pub position: i64,
    pub note: String,
    pub group_name: Option<String>,
    pub theme_name: Option<String>,
    pub added_by: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BacklogGroup {
    pub name: String,
    pub reason: String,
    pub position: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BacklogTheme {
    pub name: String,
    pub reason: String,
    pub position: i64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct RankedItem {
    pub issue_id: String,
    pub note: Option<String>,
    pub group: Option<String>,
    pub theme: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IssueDependency {
    pub issue_id: String,
    pub issue_identifier: String,
    pub blocker_id: String,
    pub blocker_identifier: String,
    pub blocker_title: String,
    pub blocker_state_name: String,
    pub blocker_state_type: String,
    pub source: String,
    pub reason: String,
    pub updated_at: String,
    pub blocker_open: bool,
}

pub const DEFAULT_RERANK_COMMAND: &str =
    "cd /srv/repos/dealwire && ~/.local/bin/claude -p --model opus --effort high --allowedTools mcp__linear-pulse --output-format json";

/// The default rerank command before v0.3.16; a saved copy of it is upgraded to the new default.
const OLD_DEFAULT_RERANK_COMMAND: &str =
    "cd /srv/repos/dealwire && ~/.local/bin/claude -p --allowedTools mcp__linear-pulse --output-format json";

pub const DEFAULT_DEV_COMMAND: &str =
    "cd /srv/repos/dealwire && ~/.local/bin/claude --bg --remote-control {name} -n {name} -w {slug} --permission-mode auto {prompt}";

pub const DEFAULT_DEV_LAUNCH_MODE: &str = "launcher";
pub const DEFAULT_DEV_ENVIRONMENT_ID: &str = "env_01D4f9186hqvLzMnvpSk5Xz5";
pub const DEFAULT_DEV_PROVIDER: &str = "claude";
pub const DEFAULT_AGY_DEV_MODEL: &str = "gemini-4-neon";
pub const DEFAULT_AGY_DEV_EFFORT: &str = "high";
pub const DEFAULT_AGY_REPO_PATH: &str = "/srv/repos/dealwire";
pub const DEFAULT_RERANK_PROVIDER: &str = "claude";
pub const DEFAULT_AGY_RERANK_COMMAND: &str =
    "cd /srv/repos/dealwire && ~/.local/bin/agy --model gemini-4-neon --effort high --dangerously-skip-permissions --output-format json -p \"$(cat)\"";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RerankRun {
    pub id: String,
    pub comment: String,
    pub status: String,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub summary: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DevSession {
    pub id: String,
    pub name: String,
    pub slug: String,
    pub note: String,
    pub delivery: String,
    pub model: Option<String>,
    pub effort: Option<String>,
    pub provider: String,
    pub launch_mode: Option<String>,
    pub remote_session_id: Option<String>,
    pub remote_url: Option<String>,
    pub status: String,
    pub agent_status: Option<String>,
    pub bg_id: Option<String>,
    pub error: Option<String>,
    pub started_at: String,
    pub updated_at: String,
    pub all_done_at: Option<String>,
    pub keep_open: bool,
    pub cleanup_status: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DevSessionItem {
    pub session_id: String,
    pub issue_id: String,
    pub position: i64,
    pub status: String,
    pub note: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DevSessionItemView {
    pub session_id: String,
    pub issue_id: String,
    pub position: i64,
    pub status: String,
    pub note: Option<String>,
    pub updated_at: String,
    pub identifier: Option<String>,
    pub title: Option<String>,
    pub state: Option<String>,
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DevSessionView {
    pub session: DevSession,
    pub items: Vec<DevSessionItemView>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct BridgeSettings {
    pub server_enabled: bool,
    pub port: u16,
    pub token: String,
    pub tunnel_enabled: bool,
    pub ssh_target: String,
    pub remote_port: u16,
    pub rerank_ssh_target: String,
    pub rerank_command: String,
    pub dev_command: String,
    pub dev_model: String,
    pub dev_effort: String,
    pub dev_launch_mode: String,
    pub dev_environment_id: String,
    pub dev_provider: String,
    pub agy_dev_model: String,
    pub agy_dev_effort: String,
    pub agy_repo_path: String,
    pub rerank_provider: String,
    pub agy_rerank_command: String,
}

impl Default for BridgeSettings {
    fn default() -> Self {
        Self {
            server_enabled: false,
            port: 47100,
            token: String::new(),
            tunnel_enabled: false,
            ssh_target: String::new(),
            remote_port: 47100,
            rerank_ssh_target: String::new(),
            rerank_command: DEFAULT_RERANK_COMMAND.to_string(),
            dev_command: DEFAULT_DEV_COMMAND.to_string(),
            dev_model: "opus".to_string(),
            dev_effort: "high".to_string(),
            dev_launch_mode: DEFAULT_DEV_LAUNCH_MODE.to_string(),
            dev_environment_id: DEFAULT_DEV_ENVIRONMENT_ID.to_string(),
            dev_provider: DEFAULT_DEV_PROVIDER.to_string(),
            agy_dev_model: DEFAULT_AGY_DEV_MODEL.to_string(),
            agy_dev_effort: DEFAULT_AGY_DEV_EFFORT.to_string(),
            agy_repo_path: DEFAULT_AGY_REPO_PATH.to_string(),
            rerank_provider: DEFAULT_RERANK_PROVIDER.to_string(),
            agy_rerank_command: DEFAULT_AGY_RERANK_COMMAND.to_string(),
        }
    }
}

pub fn init_db(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "
        PRAGMA journal_mode = WAL;

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS issues (
            id TEXT PRIMARY KEY,
            identifier TEXT NOT NULL,
            title TEXT NOT NULL,
            description TEXT,
            url TEXT NOT NULL,
            priority INTEGER NOT NULL,
            priority_label TEXT NOT NULL,
            state_id TEXT NOT NULL DEFAULT '',
            state_name TEXT NOT NULL,
            state_type TEXT NOT NULL,
            state_color TEXT NOT NULL,
            team_id TEXT NOT NULL DEFAULT '',
            team_key TEXT NOT NULL,
            team_name TEXT NOT NULL,
            project_id TEXT,
            project_name TEXT,
            assignee_id TEXT,
            assignee_name TEXT,
            labels_json TEXT NOT NULL,
            label_ids_json TEXT NOT NULL DEFAULT '[]',
            updated_at TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS comments (
            id TEXT PRIMARY KEY,
            issue_id TEXT NOT NULL,
            body TEXT NOT NULL,
            created_at TEXT NOT NULL,
            author_id TEXT,
            author_name TEXT NOT NULL,
            FOREIGN KEY(issue_id) REFERENCES issues(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS issue_reads (
            issue_id TEXT PRIMARY KEY,
            last_seen_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS ai_triage_cache (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            payload_json TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS workspace_meta (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            payload_json TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS saved_views (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            team_filter TEXT NOT NULL,
            scope_filter TEXT NOT NULL,
            assignee_filter TEXT NOT NULL,
            project_filter TEXT NOT NULL,
            label_filter TEXT NOT NULL,
            search_query TEXT NOT NULL,
            layout_mode TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS backlog (
            issue_id TEXT PRIMARY KEY,
            position INTEGER NOT NULL,
            note TEXT NOT NULL DEFAULT '',
            group_name TEXT,
            theme_name TEXT,
            added_by TEXT NOT NULL DEFAULT 'me',
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS backlog_groups (
            name TEXT PRIMARY KEY,
            reason TEXT NOT NULL DEFAULT '',
            position INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS backlog_themes (
            name TEXT PRIMARY KEY,
            reason TEXT NOT NULL DEFAULT '',
            position INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS rerank_runs (
            id TEXT PRIMARY KEY,
            comment TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL,
            started_at TEXT NOT NULL,
            finished_at TEXT,
            summary TEXT,
            error TEXT
        );

        CREATE TABLE IF NOT EXISTS dev_sessions (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            slug TEXT NOT NULL,
            note TEXT NOT NULL DEFAULT '',
            delivery TEXT NOT NULL,
            model TEXT,
            effort TEXT,
            provider TEXT NOT NULL DEFAULT 'claude',
            launch_mode TEXT,
            remote_session_id TEXT,
            remote_url TEXT,
            status TEXT NOT NULL,
            agent_status TEXT,
            bg_id TEXT,
            error TEXT,
            started_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            all_done_at TEXT,
            keep_open INTEGER NOT NULL DEFAULT 0,
            cleanup_status TEXT
        );

        CREATE TABLE IF NOT EXISTS dev_session_items (
            session_id TEXT NOT NULL,
            issue_id TEXT NOT NULL,
            position INTEGER NOT NULL,
            status TEXT NOT NULL,
            note TEXT,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (session_id, issue_id)
        );

        CREATE TABLE IF NOT EXISTS issue_dependencies (
            issue_id TEXT NOT NULL,
            issue_identifier TEXT NOT NULL DEFAULT '',
            blocker_id TEXT NOT NULL,
            blocker_identifier TEXT NOT NULL DEFAULT '',
            blocker_title TEXT NOT NULL DEFAULT '',
            blocker_state_name TEXT NOT NULL DEFAULT '',
            blocker_state_type TEXT NOT NULL DEFAULT '',
            source TEXT NOT NULL,
            reason TEXT NOT NULL DEFAULT '',
            updated_at TEXT NOT NULL,
            PRIMARY KEY (issue_id, blocker_id)
        );
        ",
    )?;
    let _ = conn.execute("ALTER TABLE issues ADD COLUMN project_name TEXT", []);
    let _ = conn.execute("ALTER TABLE issues ADD COLUMN team_id TEXT NOT NULL DEFAULT ''", []);
    let _ = conn.execute("ALTER TABLE issues ADD COLUMN state_id TEXT NOT NULL DEFAULT ''", []);
    let _ = conn.execute("ALTER TABLE issues ADD COLUMN project_id TEXT", []);
    let _ = conn.execute("ALTER TABLE issues ADD COLUMN assignee_id TEXT", []);
    let _ = conn.execute("ALTER TABLE issues ADD COLUMN label_ids_json TEXT NOT NULL DEFAULT '[]'", []);
    let _ = conn.execute("ALTER TABLE issues ADD COLUMN links_json TEXT NOT NULL DEFAULT '[]'", []);
    let _ = conn.execute("ALTER TABLE issues ADD COLUMN links_loaded INTEGER NOT NULL DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE issues ADD COLUMN completed_at TEXT", []);
    let _ = conn.execute("ALTER TABLE saved_views ADD COLUMN icon TEXT NOT NULL DEFAULT 'indigo'", []);
    let _ = conn.execute("ALTER TABLE saved_views ADD COLUMN match_mode TEXT NOT NULL DEFAULT 'all'", []);
    let _ = conn.execute("ALTER TABLE saved_views ADD COLUMN filters_json TEXT NOT NULL DEFAULT '[]'", []);
    let _ = conn.execute("ALTER TABLE saved_views ADD COLUMN board_columns_json TEXT NOT NULL DEFAULT '{}'", []);
    let _ = conn.execute("ALTER TABLE backlog ADD COLUMN group_name TEXT", []);
    let _ = conn.execute("ALTER TABLE backlog ADD COLUMN theme_name TEXT", []);
    let _ = conn.execute("ALTER TABLE dev_sessions ADD COLUMN model TEXT", []);
    let _ = conn.execute("ALTER TABLE dev_sessions ADD COLUMN effort TEXT", []);
    let _ = conn.execute(
        "ALTER TABLE dev_sessions ADD COLUMN provider TEXT NOT NULL DEFAULT 'claude'",
        [],
    );
    let _ = conn.execute("ALTER TABLE dev_sessions ADD COLUMN launch_mode TEXT", []);
    let _ = conn.execute("ALTER TABLE dev_sessions ADD COLUMN remote_session_id TEXT", []);
    let _ = conn.execute("ALTER TABLE dev_sessions ADD COLUMN remote_url TEXT", []);
    let _ = conn.execute("ALTER TABLE dev_sessions ADD COLUMN all_done_at TEXT", []);
    let _ = conn.execute("ALTER TABLE dev_sessions ADD COLUMN keep_open INTEGER NOT NULL DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE dev_sessions ADD COLUMN cleanup_status TEXT", []);

    let interrupted_at = now_rfc3339();
    conn.execute(
        "UPDATE rerank_runs
         SET status = 'failed',
             error = 'Interrupted (app closed)',
             finished_at = COALESCE(finished_at, ?1)
         WHERE status = 'running'",
        params![interrupted_at],
    )?;

    conn.execute(
        "UPDATE dev_sessions
         SET status = 'failed',
             error = 'Interrupted (app closed)',
             updated_at = ?1
         WHERE status = 'starting'",
        params![interrupted_at],
    )?;

    Ok(conn)
}

fn get_setting(conn: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        params![key],
        |row| row.get(0),
    )
    .optional()
}

fn set_setting(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

pub fn get_setting_value(conn: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    get_setting(conn, key)
}

pub fn set_setting_value(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    set_setting(conn, key, value)
}

#[derive(Debug, Clone)]
pub struct StoredGoogleOAuthTokens {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: i64,
    pub email: Option<String>,
}

pub fn load_google_oauth_tokens(
    conn: &Connection,
) -> rusqlite::Result<Option<StoredGoogleOAuthTokens>> {
    let access_token = get_setting(conn, "google_oauth_access_token")?
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    let refresh_token = get_setting(conn, "google_oauth_refresh_token")?
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    if access_token.is_empty() && refresh_token.is_empty() {
        return Ok(None);
    }
    let expires_at = get_setting(conn, "google_oauth_expires_at")?
        .and_then(|s| s.trim().parse::<i64>().ok())
        .unwrap_or(0);
    let email = get_setting(conn, "google_oauth_email")?
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    Ok(Some(StoredGoogleOAuthTokens {
        access_token,
        refresh_token,
        expires_at,
        email,
    }))
}

pub fn save_google_oauth_tokens(
    conn: &Connection,
    access_token: &str,
    refresh_token: &str,
    expires_at: i64,
    email: Option<&str>,
) -> rusqlite::Result<()> {
    set_setting(conn, "google_oauth_access_token", access_token.trim())?;
    if !refresh_token.trim().is_empty() {
        set_setting(conn, "google_oauth_refresh_token", refresh_token.trim())?;
    }
    set_setting(conn, "google_oauth_expires_at", &expires_at.to_string())?;
    if let Some(em) = email.map(str::trim).filter(|s| !s.is_empty()) {
        set_setting(conn, "google_oauth_email", em)?;
    }
    Ok(())
}

pub fn update_google_access_token(
    conn: &Connection,
    access_token: &str,
    expires_at: i64,
) -> rusqlite::Result<()> {
    set_setting(conn, "google_oauth_access_token", access_token.trim())?;
    set_setting(conn, "google_oauth_expires_at", &expires_at.to_string())?;
    Ok(())
}

pub fn clear_google_oauth_tokens(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM settings WHERE key IN (
            'google_oauth_access_token',
            'google_oauth_refresh_token',
            'google_oauth_expires_at',
            'google_oauth_email'
        )",
        [],
    )?;
    Ok(())
}

pub fn load_settings(conn: &Connection) -> rusqlite::Result<AppSettings> {
    let defaults = AppSettings::default();

    let linear_api_key = get_setting(conn, "linear_api_key")?
        .filter(|s| !s.is_empty())
        .or_else(|| std::env::var("LINEAR_API_KEY").ok())
        .unwrap_or_default();

    let anthropic_api_key = get_setting(conn, "anthropic_api_key")?
        .filter(|s| !s.is_empty())
        .or_else(|| std::env::var("ANTHROPIC_API_KEY").ok())
        .unwrap_or_default();

    let claude_model = get_setting(conn, "claude_model")?
        .filter(|s| !s.is_empty())
        .unwrap_or(defaults.claude_model);

    let viewer_id = get_setting(conn, "viewer_id")?;
    let viewer_name = get_setting(conn, "viewer_name")?;

    let auto_sync_seconds = get_setting(conn, "auto_sync_seconds")?
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(defaults.auto_sync_seconds);

    let notifications_enabled = get_setting(conn, "notifications_enabled")?
        .map(|s| s != "false")
        .unwrap_or(defaults.notifications_enabled);

    let ai_provider = match get_setting(conn, "ai_provider")?.as_deref().map(str::trim) {
        Some("gemini") => "gemini".to_string(),
        Some("antigravity") => "antigravity".to_string(),
        _ => defaults.ai_provider,
    };

    let gemini_api_key = get_setting(conn, "gemini_api_key")?
        .filter(|s| !s.is_empty())
        .or_else(|| std::env::var("GEMINI_API_KEY").ok())
        .unwrap_or_default();

    let gemini_model = get_setting(conn, "gemini_model")?
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or(defaults.gemini_model);

    let google_oauth_client_id = get_setting(conn, "google_oauth_client_id")?
        .map(|s| s.trim().to_string())
        .unwrap_or_default();

    let google_oauth_client_secret = get_setting(conn, "google_oauth_client_secret")?
        .map(|s| s.trim().to_string())
        .unwrap_or_default();

    let oauth_tokens = load_google_oauth_tokens(conn)?;
    let google_oauth_connected = oauth_tokens
        .as_ref()
        .is_some_and(|t| !t.refresh_token.is_empty() || !t.access_token.is_empty());
    let google_oauth_email = oauth_tokens.and_then(|t| t.email);

    let antigravity_triage_model = get_setting(conn, "antigravity_triage_model")?
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or(defaults.antigravity_triage_model);

    Ok(AppSettings {
        linear_api_key,
        anthropic_api_key,
        claude_model,
        viewer_id,
        viewer_name,
        auto_sync_seconds,
        notifications_enabled,
        ai_provider,
        gemini_api_key,
        gemini_model,
        google_oauth_client_id,
        google_oauth_client_secret,
        google_oauth_email,
        google_oauth_connected,
        antigravity_triage_model,
    })
}

pub fn save_settings(
    conn: &Connection,
    linear_api_key: &str,
    anthropic_api_key: &str,
    claude_model: &str,
    auto_sync_seconds: i64,
    notifications_enabled: bool,
) -> rusqlite::Result<()> {
    set_setting(conn, "linear_api_key", linear_api_key.trim())?;
    set_setting(conn, "anthropic_api_key", anthropic_api_key.trim())?;
    let model = if claude_model.trim().is_empty() {
        "claude-haiku-4-5"
    } else {
        claude_model.trim()
    };
    set_setting(conn, "claude_model", model)?;
    let clamped_sync = if auto_sync_seconds <= 0 {
        0
    } else {
        auto_sync_seconds.max(15)
    };
    set_setting(conn, "auto_sync_seconds", &clamped_sync.to_string())?;
    set_setting(
        conn,
        "notifications_enabled",
        if notifications_enabled { "true" } else { "false" },
    )?;
    Ok(())
}

pub fn save_ai_settings(
    conn: &Connection,
    ai_provider: &str,
    gemini_api_key: &str,
    gemini_model: &str,
    google_oauth_client_id: &str,
    google_oauth_client_secret: &str,
    antigravity_triage_model: &str,
) -> rusqlite::Result<()> {
    let provider = match ai_provider.trim() {
        "gemini" => "gemini",
        "antigravity" => "antigravity",
        _ => "anthropic",
    };
    set_setting(conn, "ai_provider", provider)?;
    set_setting(conn, "gemini_api_key", gemini_api_key.trim())?;
    let g_model = if gemini_model.trim().is_empty() {
        "gemini-2.5-flash"
    } else {
        gemini_model.trim()
    };
    set_setting(conn, "gemini_model", g_model)?;
    set_setting(conn, "google_oauth_client_id", google_oauth_client_id.trim())?;
    set_setting(
        conn,
        "google_oauth_client_secret",
        google_oauth_client_secret.trim(),
    )?;
    let agy_model = if antigravity_triage_model.trim().is_empty() {
        "gemini-4-hydrogen-high"
    } else {
        antigravity_triage_model.trim()
    };
    set_setting(conn, "antigravity_triage_model", agy_model)?;
    Ok(())
}

pub fn list_comment_ids(conn: &Connection) -> rusqlite::Result<std::collections::HashSet<String>> {
    let mut stmt = conn.prepare("SELECT id FROM comments")?;
    let rows = stmt.query_map([], |row| row.get::<_, String>(0))?;
    let mut ids = std::collections::HashSet::new();
    for r in rows {
        ids.insert(r?);
    }
    Ok(ids)
}

const UNREAD_OVERRIDE_PREFIX: &str = "unread_override:";

fn is_comment_by_viewer(
    author_id: Option<&str>,
    author_name: &str,
    viewer_id: Option<&str>,
    viewer_name: Option<&str>,
) -> bool {
    if let (Some(me), Some(author)) = (
        viewer_id.filter(|s| !s.is_empty()),
        author_id.filter(|s| !s.is_empty()),
    ) {
        return me == author;
    }
    if let Some(vname) = viewer_name.map(str::trim).filter(|s| !s.is_empty()) {
        return author_name.trim().eq_ignore_ascii_case(vname);
    }
    false
}

pub fn save_viewer(conn: &Connection, viewer_id: &str, viewer_name: &str) -> rusqlite::Result<()> {
    set_setting(conn, "viewer_id", viewer_id)?;
    set_setting(conn, "viewer_name", viewer_name)?;
    Ok(())
}

pub fn get_sync_cursor(conn: &Connection) -> rusqlite::Result<Option<String>> {
    let synced = get_setting(conn, "catalog_synced_v4")?;
    if synced.as_deref() != Some("true") {
        return Ok(None);
    }
    Ok(get_setting(conn, "last_sync_at")?.filter(|s| !s.is_empty()))
}

pub fn set_sync_cursor(conn: &Connection, ts: &str) -> rusqlite::Result<()> {
    set_setting(conn, "catalog_synced_v4", "true")?;
    set_setting(conn, "last_sync_at", ts)?;
    Ok(())
}

pub fn upsert_issues_batch(
    conn: &mut Connection,
    issues: &[LinearIssue],
    viewer_id: &str,
    viewer_name: &str,
    replace_all: bool,
) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    if replace_all {
        tx.execute("DELETE FROM comments", [])?;
        tx.execute("DELETE FROM issues", [])?;
    }

    for issue in issues {
        let labels_json = serde_json::to_string(&issue.labels).unwrap_or_else(|_| "[]".into());
        let label_ids_json =
            serde_json::to_string(&issue.label_ids).unwrap_or_else(|_| "[]".into());
        let links_json = serde_json::to_string(&issue.links).unwrap_or_else(|_| "[]".into());
        let links_loaded_int: i64 = if issue.links_loaded { 1 } else { 0 };
        tx.execute(
            "INSERT INTO issues (
                id, identifier, title, description, url, priority, priority_label,
                state_id, state_name, state_type, state_color,
                team_id, team_key, team_name, project_id, project_name,
                assignee_id, assignee_name, labels_json, label_ids_json,
                links_json, links_loaded, updated_at, created_at, completed_at
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7,
                ?8, ?9, ?10, ?11,
                ?12, ?13, ?14, ?15, ?16,
                ?17, ?18, ?19, ?20,
                ?21, ?22, ?23, ?24, ?25
            )
            ON CONFLICT(id) DO UPDATE SET
                identifier = excluded.identifier,
                title = excluded.title,
                description = excluded.description,
                url = excluded.url,
                priority = excluded.priority,
                priority_label = excluded.priority_label,
                state_id = excluded.state_id,
                state_name = excluded.state_name,
                state_type = excluded.state_type,
                state_color = excluded.state_color,
                team_id = excluded.team_id,
                team_key = excluded.team_key,
                team_name = excluded.team_name,
                project_id = excluded.project_id,
                project_name = excluded.project_name,
                assignee_id = excluded.assignee_id,
                assignee_name = excluded.assignee_name,
                labels_json = excluded.labels_json,
                label_ids_json = excluded.label_ids_json,
                links_json = CASE
                    WHEN excluded.links_loaded = 1 OR (excluded.links_json != '[]' AND issues.links_loaded = 0)
                        THEN excluded.links_json
                    ELSE issues.links_json
                END,
                links_loaded = MAX(issues.links_loaded, excluded.links_loaded),
                updated_at = excluded.updated_at,
                created_at = excluded.created_at,
                completed_at = excluded.completed_at",
            params![
                issue.id,
                issue.identifier,
                issue.title,
                issue.description,
                issue.url,
                issue.priority,
                issue.priority_label,
                issue.state_id,
                issue.state_name,
                issue.state_type,
                issue.state_color,
                issue.team_id,
                issue.team_key,
                issue.team_name,
                issue.project_id,
                issue.project_name,
                issue.assignee_id,
                issue.assignee_name,
                labels_json,
                label_ids_json,
                links_json,
                links_loaded_int,
                issue.updated_at,
                issue.created_at,
                issue.completed_at,
            ],
        )?;

        for c in &issue.comments {
            tx.execute(
                "INSERT INTO comments (id, issue_id, body, created_at, author_id, author_name)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)
                 ON CONFLICT(id) DO UPDATE SET
                    body = excluded.body,
                    created_at = excluded.created_at,
                    author_id = excluded.author_id,
                    author_name = excluded.author_name",
                params![
                    c.id,
                    issue.id,
                    c.body,
                    c.created_at,
                    c.author_id,
                    c.author_name
                ],
            )?;
        }

        let latest_viewer_ts: Option<&str> = issue
            .comments
            .iter()
            .filter(|c| {
                is_comment_by_viewer(
                    c.author_id.as_deref(),
                    &c.author_name,
                    Some(viewer_id),
                    Some(viewer_name),
                )
            })
            .map(|c| c.created_at.as_str())
            .max();

        if let Some(vr_ts) = latest_viewer_ts {
            let existing: Option<String> = tx
                .query_row(
                    "SELECT last_seen_at FROM issue_reads WHERE issue_id = ?1",
                    params![issue.id],
                    |row| row.get(0),
                )
                .optional()?;

            let should_advance = match existing.as_deref() {
                None => true,
                Some(s) if s.starts_with(UNREAD_OVERRIDE_PREFIX) => {
                    vr_ts > &s[UNREAD_OVERRIDE_PREFIX.len()..]
                }
                Some(s) => vr_ts > s,
            };

            if should_advance {
                tx.execute(
                    "INSERT INTO issue_reads (issue_id, last_seen_at) VALUES (?1, ?2)
                     ON CONFLICT(issue_id) DO UPDATE SET last_seen_at = excluded.last_seen_at",
                    params![issue.id, vr_ts],
                )?;
            }
        }
    }

    tx.commit()?;
    Ok(())
}

pub fn load_issues(
    conn: &Connection,
    viewer_id: Option<&str>,
    viewer_name: Option<&str>,
) -> rusqlite::Result<Vec<LinearIssue>> {
    let mut stmt = conn.prepare(
        "SELECT i.id, i.identifier, i.title, i.description, i.url, i.priority, i.priority_label,
                i.state_id, i.state_name, i.state_type, i.state_color,
                i.team_id, i.team_key, i.team_name,
                i.project_id, i.project_name, i.assignee_id, i.assignee_name,
                i.labels_json, i.label_ids_json, i.links_json, i.links_loaded,
                i.updated_at, i.created_at, r.last_seen_at, i.completed_at
         FROM issues i
         LEFT JOIN issue_reads r ON r.issue_id = i.id
         ORDER BY i.updated_at DESC",
    )?;

    let rows = stmt.query_map([], |row| {
        let labels_json: String = row.get(18)?;
        let label_ids_json: String = row.get(19)?;
        let links_json: String = row.get(20)?;
        let links_loaded_int: i64 = row.get(21)?;
        let labels: Vec<String> = serde_json::from_str(&labels_json).unwrap_or_default();
        let label_ids: Vec<String> = serde_json::from_str(&label_ids_json).unwrap_or_default();
        let links: Vec<LinearLinkedItem> = serde_json::from_str(&links_json).unwrap_or_default();
        Ok(LinearIssue {
            id: row.get(0)?,
            identifier: row.get(1)?,
            title: row.get(2)?,
            description: row.get(3)?,
            url: row.get(4)?,
            priority: row.get(5)?,
            priority_label: row.get(6)?,
            state_id: row.get(7)?,
            state_name: row.get(8)?,
            state_type: row.get(9)?,
            state_color: row.get(10)?,
            team_id: row.get(11)?,
            team_key: row.get(12)?,
            team_name: row.get(13)?,
            project_id: row.get(14)?,
            project_name: row.get(15)?,
            assignee_id: row.get(16)?,
            assignee_name: row.get(17)?,
            labels,
            label_ids,
            updated_at: row.get(22)?,
            created_at: row.get(23)?,
            completed_at: row.get(25)?,
            last_seen_at: row.get(24)?,
            unread_responses: 0,
            comments: Vec::new(),
            links,
            links_loaded: links_loaded_int != 0,
        })
    })?;

    struct RawComment {
        id: String,
        body: String,
        created_at: String,
        author_id: Option<String>,
        author_name: String,
    }

    let mut issues = Vec::new();
    for row in rows {
        let mut issue = row?;
        let mut c_stmt = conn.prepare(
            "SELECT id, body, created_at, author_id, author_name
             FROM comments
             WHERE issue_id = ?1
             ORDER BY created_at ASC",
        )?;
        let c_rows = c_stmt.query_map(params![issue.id], |c_row| {
            Ok(RawComment {
                id: c_row.get(0)?,
                body: c_row.get(1)?,
                created_at: c_row.get(2)?,
                author_id: c_row.get(3)?,
                author_name: c_row.get(4)?,
            })
        })?;

        let mut raw_comments = Vec::new();
        for c in c_rows {
            raw_comments.push(c?);
        }

        let latest_viewer_ts: Option<String> = raw_comments
            .iter()
            .filter(|c| {
                is_comment_by_viewer(
                    c.author_id.as_deref(),
                    &c.author_name,
                    viewer_id,
                    viewer_name,
                )
            })
            .map(|c| c.created_at.clone())
            .max();

        let last_other_ts: Option<String> = raw_comments
            .iter()
            .filter(|c| {
                !is_comment_by_viewer(
                    c.author_id.as_deref(),
                    &c.author_name,
                    viewer_id,
                    viewer_name,
                )
            })
            .map(|c| c.created_at.clone())
            .max();

        let mut unread_count = 0usize;
        for c in raw_comments {
            let by_viewer = is_comment_by_viewer(
                c.author_id.as_deref(),
                &c.author_name,
                viewer_id,
                viewer_name,
            );
            let is_unread = if by_viewer {
                false
            } else {
                match issue.last_seen_at.as_deref() {
                    Some(s) if s.starts_with(UNREAD_OVERRIDE_PREFIX) => {
                        let override_ts = &s[UNREAD_OVERRIDE_PREFIX.len()..];
                        if let Some(vr) =
                            latest_viewer_ts.as_deref().filter(|vr| *vr > override_ts)
                        {
                            c.created_at.as_str() > vr
                        } else {
                            last_other_ts
                                .as_deref()
                                .is_some_and(|lt| c.created_at.as_str() >= lt)
                        }
                    }
                    other_seen => {
                        let effective_seen = match (other_seen, latest_viewer_ts.as_deref()) {
                            (Some(a), Some(b)) => Some(if a >= b { a } else { b }),
                            (Some(a), None) => Some(a),
                            (None, Some(b)) => Some(b),
                            (None, None) => None,
                        };
                        match effective_seen {
                            Some(seen) => c.created_at.as_str() > seen,
                            None => true,
                        }
                    }
                }
            };

            if is_unread {
                unread_count += 1;
            }
            issue.comments.push(LinearComment {
                id: c.id,
                body: c.body,
                created_at: c.created_at,
                author_id: c.author_id,
                author_name: c.author_name,
                is_unread,
            });
        }
        issue.unread_responses = unread_count;
        issues.push(issue);
    }

    Ok(issues)
}

pub fn mark_issue_seen(conn: &Connection, issue_id: &str, seen_at: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO issue_reads (issue_id, last_seen_at) VALUES (?1, ?2)
         ON CONFLICT(issue_id) DO UPDATE SET last_seen_at = excluded.last_seen_at",
        params![issue_id, seen_at],
    )?;
    Ok(())
}

pub fn mark_all_issues_seen(conn: &Connection, seen_at: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO issue_reads (issue_id, last_seen_at)
         SELECT id, ?1 FROM issues",
        params![seen_at],
    )?;
    Ok(())
}

pub fn mark_issue_unread(conn: &Connection, issue_id: &str) -> rusqlite::Result<()> {
    let latest_ts: String = conn
        .query_row(
            "SELECT MAX(created_at) FROM comments WHERE issue_id = ?1",
            params![issue_id],
            |row| row.get::<_, Option<String>>(0),
        )?
        .unwrap_or_default();
    let val = format!("{UNREAD_OVERRIDE_PREFIX}{latest_ts}");
    conn.execute(
        "INSERT INTO issue_reads (issue_id, last_seen_at) VALUES (?1, ?2)
         ON CONFLICT(issue_id) DO UPDATE SET last_seen_at = excluded.last_seen_at",
        params![issue_id, val],
    )?;
    Ok(())
}

pub fn save_triage_cache(conn: &Connection, result: &AiTriageResult) -> rusqlite::Result<()> {
    let payload_json = serde_json::to_string(result).unwrap_or_default();
    conn.execute(
        "INSERT INTO ai_triage_cache (id, payload_json) VALUES (1, ?1)
         ON CONFLICT(id) DO UPDATE SET payload_json = excluded.payload_json",
        params![payload_json],
    )?;
    Ok(())
}

pub fn load_triage_cache(conn: &Connection) -> rusqlite::Result<Option<AiTriageResult>> {
    let json: Option<String> = conn
        .query_row(
            "SELECT payload_json FROM ai_triage_cache WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .optional()?;

    Ok(json.and_then(|s| serde_json::from_str(&s).ok()))
}

pub fn save_workspace_meta(conn: &Connection, meta: &WorkspaceMetadata) -> rusqlite::Result<()> {
    let payload_json = serde_json::to_string(meta).unwrap_or_default();
    conn.execute(
        "INSERT INTO workspace_meta (id, payload_json) VALUES (1, ?1)
         ON CONFLICT(id) DO UPDATE SET payload_json = excluded.payload_json",
        params![payload_json],
    )?;
    Ok(())
}

pub fn load_workspace_meta(conn: &Connection) -> rusqlite::Result<WorkspaceMetadata> {
    let json: Option<String> = conn
        .query_row(
            "SELECT payload_json FROM workspace_meta WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .optional()?;

    Ok(json
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default())
}

pub fn list_saved_views(conn: &Connection) -> rusqlite::Result<Vec<SavedView>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, icon, match_mode, filters_json, board_columns_json, team_filter, scope_filter,
                assignee_filter, project_filter, label_filter, search_query, layout_mode, created_at
         FROM saved_views
         ORDER BY created_at ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(SavedView {
            id: row.get(0)?,
            name: row.get(1)?,
            icon: row.get(2)?,
            match_mode: row.get(3)?,
            filters_json: row.get(4)?,
            board_columns_json: row.get(5)?,
            team_filter: row.get(6)?,
            scope_filter: row.get(7)?,
            assignee_filter: row.get(8)?,
            project_filter: row.get(9)?,
            label_filter: row.get(10)?,
            search_query: row.get(11)?,
            layout_mode: row.get(12)?,
            created_at: row.get(13)?,
        })
    })?;
    let mut views = Vec::new();
    for r in rows {
        views.push(r?);
    }
    Ok(views)
}

pub fn upsert_saved_view(conn: &Connection, view: &SavedView) -> rusqlite::Result<()> {
    let created_at = if view.created_at.trim().is_empty() {
        chrono::Utc::now().to_rfc3339()
    } else {
        view.created_at.clone()
    };
    let icon = if view.icon.trim().is_empty() {
        "indigo"
    } else {
        view.icon.trim()
    };
    let match_mode = if view.match_mode == "any" {
        "any"
    } else {
        "all"
    };
    let filters_json = if view.filters_json.trim().is_empty() {
        "[]"
    } else {
        view.filters_json.trim()
    };
    let board_columns_json = if view.board_columns_json.trim().is_empty() {
        "{}"
    } else {
        view.board_columns_json.trim()
    };
    conn.execute(
        "INSERT INTO saved_views (
            id, name, icon, match_mode, filters_json, board_columns_json, team_filter, scope_filter, assignee_filter,
            project_filter, label_filter, search_query, layout_mode, created_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
         ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            icon = excluded.icon,
            match_mode = excluded.match_mode,
            filters_json = excluded.filters_json,
            board_columns_json = excluded.board_columns_json,
            team_filter = excluded.team_filter,
            scope_filter = excluded.scope_filter,
            assignee_filter = excluded.assignee_filter,
            project_filter = excluded.project_filter,
            label_filter = excluded.label_filter,
            search_query = excluded.search_query,
            layout_mode = excluded.layout_mode",
        params![
            view.id,
            view.name,
            icon,
            match_mode,
            filters_json,
            board_columns_json,
            view.team_filter,
            view.scope_filter,
            view.assignee_filter,
            view.project_filter,
            view.label_filter,
            view.search_query,
            view.layout_mode,
            created_at,
        ],
    )?;
    Ok(())
}

pub fn delete_saved_view(conn: &Connection, view_id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM saved_views WHERE id = ?1", params![view_id])?;
    Ok(())
}

fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn normalize_group_name(raw: Option<&str>) -> Option<String> {
    raw.map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

pub fn load_backlog(conn: &Connection) -> rusqlite::Result<Vec<BacklogEntry>> {
    let mut stmt = conn.prepare(
        "SELECT issue_id, position, note, group_name, theme_name, added_by, updated_at
         FROM backlog
         ORDER BY position ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        let raw_group: Option<String> = row.get(3)?;
        let raw_theme: Option<String> = row.get(4)?;
        Ok(BacklogEntry {
            issue_id: row.get(0)?,
            position: row.get(1)?,
            note: row.get(2)?,
            group_name: normalize_group_name(raw_group.as_deref()),
            theme_name: normalize_group_name(raw_theme.as_deref()),
            added_by: row.get(5)?,
            updated_at: row.get(6)?,
        })
    })?;
    let mut entries = Vec::new();
    for r in rows {
        entries.push(r?);
    }
    Ok(entries)
}

pub fn load_backlog_groups(conn: &Connection) -> rusqlite::Result<Vec<BacklogGroup>> {
    let mut stmt = conn.prepare(
        "SELECT name, reason, position
         FROM backlog_groups
         ORDER BY position ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(BacklogGroup {
            name: row.get(0)?,
            reason: row.get(1)?,
            position: row.get(2)?,
        })
    })?;
    let mut groups = Vec::new();
    for r in rows {
        groups.push(r?);
    }
    Ok(groups)
}

pub fn load_backlog_themes(conn: &Connection) -> rusqlite::Result<Vec<BacklogTheme>> {
    let mut stmt = conn.prepare(
        "SELECT name, reason, position
         FROM backlog_themes
         ORDER BY position ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(BacklogTheme {
            name: row.get(0)?,
            reason: row.get(1)?,
            position: row.get(2)?,
        })
    })?;
    let mut themes = Vec::new();
    for r in rows {
        themes.push(r?);
    }
    Ok(themes)
}

fn rewrite_backlog_tx(
    tx: &rusqlite::Transaction<'_>,
    entries: &[BacklogEntry],
) -> rusqlite::Result<()> {
    tx.execute("DELETE FROM backlog", [])?;
    let mut stmt = tx.prepare(
        "INSERT INTO backlog (issue_id, position, note, group_name, theme_name, added_by, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
    )?;
    for (idx, entry) in entries.iter().enumerate() {
        let pos = (idx as i64) + 1;
        stmt.execute(params![
            entry.issue_id,
            pos,
            entry.note,
            entry.group_name,
            entry.theme_name,
            entry.added_by,
            entry.updated_at,
        ])?;
    }
    Ok(())
}

fn rewrite_backlog_meta_table<'a>(
    tx: &rusqlite::Transaction<'_>,
    table: &str,
    declared: &[(String, String)],
    referenced: impl Iterator<Item = Option<&'a str>> + Clone,
) -> rusqlite::Result<()> {
    let referenced_set: std::collections::HashSet<&str> = referenced.clone().flatten().collect();
    let mut seen = std::collections::HashSet::new();
    let mut final_rows: Vec<(String, String)> = Vec::new();
    for (raw_name, raw_reason) in declared {
        let name = raw_name.trim();
        if name.is_empty() || !referenced_set.contains(name) || !seen.insert(name.to_string()) {
            continue;
        }
        final_rows.push((name.to_string(), raw_reason.trim().to_string()));
    }
    for name in referenced.flatten() {
        if seen.insert(name.to_string()) {
            final_rows.push((name.to_string(), String::new()));
        }
    }

    tx.execute(&format!("DELETE FROM {table}"), [])?;
    let mut stmt = tx.prepare(&format!(
        "INSERT INTO {table} (name, reason, position)
         VALUES (?1, ?2, ?3)"
    ))?;
    for (idx, (name, reason)) in final_rows.iter().enumerate() {
        stmt.execute(params![name, reason, (idx as i64) + 1])?;
    }
    Ok(())
}

pub fn replace_backlog(
    conn: &mut Connection,
    items: &[(String, Option<String>)],
    added_by: &str,
) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    let existing_list = load_backlog(&tx)?;
    let existing_map: std::collections::HashMap<String, BacklogEntry> = existing_list
        .into_iter()
        .map(|e| (e.issue_id.clone(), e))
        .collect();

    let now = now_rfc3339();
    let mut seen = std::collections::HashSet::new();
    let mut next_entries = Vec::with_capacity(items.len());

    for (issue_id, new_note) in items {
        if !seen.insert(issue_id.clone()) {
            continue;
        }
        if let Some(prev) = existing_map.get(issue_id) {
            next_entries.push(BacklogEntry {
                issue_id: issue_id.clone(),
                position: 0,
                note: new_note.clone().unwrap_or_else(|| prev.note.clone()),
                group_name: prev.group_name.clone(),
                theme_name: prev.theme_name.clone(),
                added_by: prev.added_by.clone(),
                updated_at: now.clone(),
            });
        } else {
            next_entries.push(BacklogEntry {
                issue_id: issue_id.clone(),
                position: 0,
                note: new_note.clone().unwrap_or_default(),
                group_name: None,
                theme_name: None,
                added_by: added_by.to_string(),
                updated_at: now.clone(),
            });
        }
    }

    rewrite_backlog_tx(&tx, &next_entries)?;
    tx.commit()?;
    Ok(())
}

pub fn replace_backlog_ranked(
    conn: &mut Connection,
    items: &[RankedItem],
    groups: &[(String, String)],
    themes: &[(String, String)],
    added_by: &str,
) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    let existing_list = load_backlog(&tx)?;
    let existing_map: std::collections::HashMap<String, BacklogEntry> = existing_list
        .into_iter()
        .map(|e| (e.issue_id.clone(), e))
        .collect();

    let now = now_rfc3339();
    let mut seen = std::collections::HashSet::new();
    let mut next_entries = Vec::with_capacity(items.len());

    for item in items {
        if !seen.insert(item.issue_id.clone()) {
            continue;
        }
        let group_name = normalize_group_name(item.group.as_deref());
        let theme_name = normalize_group_name(item.theme.as_deref());
        if let Some(prev) = existing_map.get(&item.issue_id) {
            next_entries.push(BacklogEntry {
                issue_id: item.issue_id.clone(),
                position: 0,
                note: item.note.clone().unwrap_or_else(|| prev.note.clone()),
                group_name,
                theme_name,
                added_by: prev.added_by.clone(),
                updated_at: now.clone(),
            });
        } else {
            next_entries.push(BacklogEntry {
                issue_id: item.issue_id.clone(),
                position: 0,
                note: item.note.clone().unwrap_or_default(),
                group_name,
                theme_name,
                added_by: added_by.to_string(),
                updated_at: now.clone(),
            });
        }
    }

    rewrite_backlog_tx(&tx, &next_entries)?;
    rewrite_backlog_meta_table(
        &tx,
        "backlog_groups",
        groups,
        next_entries.iter().map(|e| e.group_name.as_deref()),
    )?;
    rewrite_backlog_meta_table(
        &tx,
        "backlog_themes",
        themes,
        next_entries.iter().map(|e| e.theme_name.as_deref()),
    )?;

    tx.commit()?;
    Ok(())
}

pub fn add_to_backlog(
    conn: &mut Connection,
    issue_id: &str,
    position: Option<i64>,
    note: Option<String>,
    added_by: &str,
) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    let mut entries = load_backlog(&tx)?;
    let now = now_rfc3339();

    let entry = if let Some(idx) = entries.iter().position(|e| e.issue_id == issue_id) {
        let mut existing = entries.remove(idx);
        if let Some(n) = note {
            existing.note = n;
        }
        existing.updated_at = now;
        existing
    } else {
        BacklogEntry {
            issue_id: issue_id.to_string(),
            position: 0,
            note: note.unwrap_or_default(),
            group_name: None,
            theme_name: None,
            added_by: added_by.to_string(),
            updated_at: now,
        }
    };

    let target_idx = match position {
        Some(pos) => {
            let clamped = pos.max(1) as usize;
            (clamped - 1).min(entries.len())
        }
        None => entries.len(),
    };
    entries.insert(target_idx, entry);

    rewrite_backlog_tx(&tx, &entries)?;
    tx.commit()?;
    Ok(())
}

pub fn move_backlog_item(
    conn: &mut Connection,
    issue_id: &str,
    position: i64,
) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    let mut entries = load_backlog(&tx)?;
    let Some(curr_idx) = entries.iter().position(|e| e.issue_id == issue_id) else {
        return Ok(());
    };
    let mut item = entries.remove(curr_idx);
    item.updated_at = now_rfc3339();
    let target_idx = (position.max(1) as usize - 1).min(entries.len());
    entries.insert(target_idx, item);
    rewrite_backlog_tx(&tx, &entries)?;
    tx.commit()?;
    Ok(())
}

pub fn remove_from_backlog(conn: &mut Connection, issue_id: &str) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    let mut entries = load_backlog(&tx)?;
    let prev_len = entries.len();
    entries.retain(|e| e.issue_id != issue_id);
    if entries.len() != prev_len {
        rewrite_backlog_tx(&tx, &entries)?;
    }
    tx.commit()?;
    Ok(())
}

pub fn set_backlog_note(conn: &Connection, issue_id: &str, note: &str) -> rusqlite::Result<()> {
    let now = now_rfc3339();
    conn.execute(
        "UPDATE backlog SET note = ?1, updated_at = ?2 WHERE issue_id = ?3",
        params![note, now, issue_id],
    )?;
    Ok(())
}

pub fn remove_backlog_where_done(
    conn: &mut Connection,
    done_issue_ids: &[String],
) -> rusqlite::Result<()> {
    if done_issue_ids.is_empty() {
        return Ok(());
    }
    let tx = conn.transaction()?;
    let done_set: std::collections::HashSet<&str> =
        done_issue_ids.iter().map(String::as_str).collect();
    let mut entries = load_backlog(&tx)?;
    let prev_len = entries.len();
    entries.retain(|e| !done_set.contains(e.issue_id.as_str()));
    if entries.len() != prev_len {
        rewrite_backlog_tx(&tx, &entries)?;
    }
    tx.commit()?;
    Ok(())
}

pub fn find_issue_id_by_identifier(
    conn: &Connection,
    identifier: &str,
) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT id FROM issues WHERE LOWER(identifier) = LOWER(?1) LIMIT 1",
        params![identifier.trim()],
        |row| row.get(0),
    )
    .optional()
}

pub fn generate_token() -> String {
    let mut buf = [0u8; 24];
    if let Ok(mut f) = std::fs::File::open("/dev/urandom") {
        if std::io::Read::read_exact(&mut f, &mut buf).is_ok() {
            let mut hex = String::with_capacity(buf.len() * 2);
            for b in buf {
                hex.push_str(&format!("{b:02x}"));
            }
            return hex;
        }
    }

    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let pid = std::process::id();
    let mut out = String::with_capacity(48);
    let mut seed = now ^ ((pid as u128) << 64);
    for round in 0..3u64 {
        let mut hasher = DefaultHasher::new();
        seed.hash(&mut hasher);
        round.hash(&mut hasher);
        pid.hash(&mut hasher);
        let val = hasher.finish();
        out.push_str(&format!("{val:016x}"));
        seed = seed.rotate_left(13) ^ (val as u128);
    }
    out
}

pub fn load_bridge_settings(conn: &Connection) -> rusqlite::Result<BridgeSettings> {
    let defaults = BridgeSettings::default();

    let server_enabled = get_setting_value(conn, "bridge_server_enabled")?
        .map(|s| s == "true")
        .unwrap_or(defaults.server_enabled);

    let port = get_setting_value(conn, "bridge_port")?
        .and_then(|s| s.parse::<u16>().ok())
        .filter(|&p| p > 0)
        .unwrap_or(defaults.port);

    let token = match get_setting_value(conn, "bridge_token")? {
        Some(t) if !t.trim().is_empty() => t.trim().to_string(),
        _ => {
            let generated = generate_token();
            set_setting_value(conn, "bridge_token", &generated)?;
            generated
        }
    };

    let tunnel_enabled = get_setting_value(conn, "bridge_tunnel_enabled")?
        .map(|s| s == "true")
        .unwrap_or(defaults.tunnel_enabled);

    let ssh_target = get_setting_value(conn, "bridge_ssh_target")?
        .unwrap_or(defaults.ssh_target);

    let remote_port = get_setting_value(conn, "bridge_remote_port")?
        .and_then(|s| s.parse::<u16>().ok())
        .filter(|&p| p > 0)
        .unwrap_or(defaults.remote_port);

    let rerank_ssh_target = get_setting_value(conn, "bridge_rerank_ssh_target")?
        .unwrap_or(defaults.rerank_ssh_target);

    let rerank_command = get_setting_value(conn, "bridge_rerank_command")?
        .filter(|s| !s.trim().is_empty() && s.trim() != OLD_DEFAULT_RERANK_COMMAND)
        .unwrap_or(defaults.rerank_command);

    let dev_command = get_setting_value(conn, "bridge_dev_command")?
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(defaults.dev_command);

    let dev_model = get_setting_value(conn, "bridge_dev_model")?
        .map(|s| s.trim().to_string())
        .unwrap_or(defaults.dev_model);

    let dev_effort = get_setting_value(conn, "bridge_dev_effort")?
        .map(|s| s.trim().to_string())
        .unwrap_or(defaults.dev_effort);

    let dev_launch_mode = match get_setting_value(conn, "bridge_dev_launch_mode")?
        .as_deref()
        .map(str::trim)
    {
        Some("ssh") => "ssh".to_string(),
        Some("launcher") => "launcher".to_string(),
        _ => defaults.dev_launch_mode,
    };

    let dev_environment_id = get_setting_value(conn, "bridge_dev_environment_id")?
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or(defaults.dev_environment_id);

    let dev_provider = match get_setting_value(conn, "bridge_dev_provider")?
        .as_deref()
        .map(str::trim)
    {
        Some("antigravity") => "antigravity".to_string(),
        _ => defaults.dev_provider,
    };

    let agy_dev_model = get_setting_value(conn, "bridge_agy_dev_model")?
        .map(|s| s.trim().to_string())
        .unwrap_or(defaults.agy_dev_model);

    let agy_dev_effort = get_setting_value(conn, "bridge_agy_dev_effort")?
        .map(|s| s.trim().to_string())
        .unwrap_or(defaults.agy_dev_effort);

    let agy_repo_path = get_setting_value(conn, "bridge_agy_repo_path")?
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or(defaults.agy_repo_path);

    let rerank_provider = match get_setting_value(conn, "bridge_rerank_provider")?
        .as_deref()
        .map(str::trim)
    {
        Some("antigravity") => "antigravity".to_string(),
        _ => defaults.rerank_provider,
    };

    let agy_rerank_command = get_setting_value(conn, "bridge_agy_rerank_command")?
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(defaults.agy_rerank_command);

    Ok(BridgeSettings {
        server_enabled,
        port,
        token,
        tunnel_enabled,
        ssh_target,
        remote_port,
        rerank_ssh_target,
        rerank_command,
        dev_command,
        dev_model,
        dev_effort,
        dev_launch_mode,
        dev_environment_id,
        dev_provider,
        agy_dev_model,
        agy_dev_effort,
        agy_repo_path,
        rerank_provider,
        agy_rerank_command,
    })
}

pub fn set_dev_defaults(conn: &Connection, model: &str, effort: &str) -> rusqlite::Result<()> {
    set_setting_value(conn, "bridge_dev_model", model.trim())?;
    set_setting_value(conn, "bridge_dev_effort", effort.trim())?;
    Ok(())
}

pub fn set_agy_dev_defaults(conn: &Connection, model: &str, effort: &str) -> rusqlite::Result<()> {
    set_setting_value(conn, "bridge_agy_dev_model", model.trim())?;
    set_setting_value(conn, "bridge_agy_dev_effort", effort.trim())?;
    Ok(())
}

pub fn set_dev_provider(conn: &Connection, provider: &str) -> rusqlite::Result<()> {
    let val = if provider.trim() == "antigravity" {
        "antigravity"
    } else {
        DEFAULT_DEV_PROVIDER
    };
    set_setting_value(conn, "bridge_dev_provider", val)?;
    Ok(())
}

pub fn save_bridge_settings(
    conn: &Connection,
    settings: &BridgeSettings,
) -> rusqlite::Result<()> {
    set_setting_value(
        conn,
        "bridge_server_enabled",
        if settings.server_enabled { "true" } else { "false" },
    )?;
    let port = if settings.port == 0 { 47100 } else { settings.port };
    set_setting_value(conn, "bridge_port", &port.to_string())?;

    let token = if settings.token.trim().is_empty() {
        generate_token()
    } else {
        settings.token.trim().to_string()
    };
    set_setting_value(conn, "bridge_token", &token)?;

    set_setting_value(
        conn,
        "bridge_tunnel_enabled",
        if settings.tunnel_enabled { "true" } else { "false" },
    )?;
    set_setting_value(conn, "bridge_ssh_target", settings.ssh_target.trim())?;

    let remote_port = if settings.remote_port == 0 {
        47100
    } else {
        settings.remote_port
    };
    set_setting_value(conn, "bridge_remote_port", &remote_port.to_string())?;

    set_setting_value(
        conn,
        "bridge_rerank_ssh_target",
        settings.rerank_ssh_target.trim(),
    )?;
    let rerank_command = if settings.rerank_command.trim().is_empty() {
        DEFAULT_RERANK_COMMAND
    } else {
        settings.rerank_command.trim()
    };
    set_setting_value(conn, "bridge_rerank_command", rerank_command)?;

    let dev_command = if settings.dev_command.trim().is_empty() {
        DEFAULT_DEV_COMMAND
    } else {
        settings.dev_command.trim()
    };
    set_setting_value(conn, "bridge_dev_command", dev_command)?;
    set_dev_defaults(conn, &settings.dev_model, &settings.dev_effort)?;

    let dev_launch_mode = if settings.dev_launch_mode.trim() == "ssh" {
        "ssh"
    } else {
        DEFAULT_DEV_LAUNCH_MODE
    };
    set_setting_value(conn, "bridge_dev_launch_mode", dev_launch_mode)?;

    let dev_environment_id = if settings.dev_environment_id.trim().is_empty() {
        DEFAULT_DEV_ENVIRONMENT_ID
    } else {
        settings.dev_environment_id.trim()
    };
    set_setting_value(conn, "bridge_dev_environment_id", dev_environment_id)?;

    set_dev_provider(conn, &settings.dev_provider)?;
    set_agy_dev_defaults(conn, &settings.agy_dev_model, &settings.agy_dev_effort)?;

    let agy_repo_path = if settings.agy_repo_path.trim().is_empty() {
        DEFAULT_AGY_REPO_PATH
    } else {
        settings.agy_repo_path.trim()
    };
    set_setting_value(conn, "bridge_agy_repo_path", agy_repo_path)?;

    let rerank_provider = if settings.rerank_provider.trim() == "antigravity" {
        "antigravity"
    } else {
        DEFAULT_RERANK_PROVIDER
    };
    set_setting_value(conn, "bridge_rerank_provider", rerank_provider)?;

    let agy_rerank_command = if settings.agy_rerank_command.trim().is_empty() {
        DEFAULT_AGY_RERANK_COMMAND
    } else {
        settings.agy_rerank_command.trim()
    };
    set_setting_value(conn, "bridge_agy_rerank_command", agy_rerank_command)?;
    Ok(())
}

pub fn insert_rerank_run(conn: &Connection, run: &RerankRun) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO rerank_runs (id, comment, status, started_at, finished_at, summary, error)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            run.id,
            run.comment,
            run.status,
            run.started_at,
            run.finished_at,
            run.summary,
            run.error,
        ],
    )?;
    Ok(())
}

pub fn finish_rerank_run(
    conn: &Connection,
    id: &str,
    status: &str,
    summary: Option<&str>,
    error: Option<&str>,
    finished_at: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE rerank_runs
         SET status = ?2,
             summary = ?3,
             error = ?4,
             finished_at = ?5
         WHERE id = ?1",
        params![id, status, summary, error, finished_at],
    )?;
    Ok(())
}

pub fn list_rerank_runs(conn: &Connection, limit: usize) -> rusqlite::Result<Vec<RerankRun>> {
    let mut stmt = conn.prepare(
        "SELECT id, comment, status, started_at, finished_at, summary, error
         FROM rerank_runs
         ORDER BY started_at DESC, rowid DESC
         LIMIT ?1",
    )?;
    let rows = stmt.query_map(params![limit as i64], |row| {
        Ok(RerankRun {
            id: row.get(0)?,
            comment: row.get(1)?,
            status: row.get(2)?,
            started_at: row.get(3)?,
            finished_at: row.get(4)?,
            summary: row.get(5)?,
            error: row.get(6)?,
        })
    })?;
    let mut runs = Vec::new();
    for r in rows {
        runs.push(r?);
    }
    Ok(runs)
}

pub fn latest_rerank_finished_at(conn: &Connection) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT MAX(finished_at) FROM rerank_runs WHERE status = 'succeeded' AND finished_at IS NOT NULL",
        [],
        |row| row.get(0),
    )
}

pub fn latest_running_rerank_run(conn: &Connection) -> rusqlite::Result<Option<RerankRun>> {
    conn.query_row(
        "SELECT id, comment, status, started_at, finished_at, summary, error
         FROM rerank_runs
         WHERE status = 'running'
         ORDER BY started_at DESC, rowid DESC
         LIMIT 1",
        [],
        |row| {
            Ok(RerankRun {
                id: row.get(0)?,
                comment: row.get(1)?,
                status: row.get(2)?,
                started_at: row.get(3)?,
                finished_at: row.get(4)?,
                summary: row.get(5)?,
                error: row.get(6)?,
            })
        },
    )
    .optional()
}

pub fn latest_backlog_updated_at(conn: &Connection) -> rusqlite::Result<Option<String>> {
    conn.query_row("SELECT MAX(updated_at) FROM backlog", [], |row| row.get(0))
}

fn row_to_dev_session(row: &rusqlite::Row<'_>) -> rusqlite::Result<DevSession> {
    Ok(DevSession {
        id: row.get(0)?,
        name: row.get(1)?,
        slug: row.get(2)?,
        note: row.get(3)?,
        delivery: row.get(4)?,
        model: row.get(5)?,
        effort: row.get(6)?,
        provider: row.get(7)?,
        launch_mode: row.get(8)?,
        remote_session_id: row.get(9)?,
        remote_url: row.get(10)?,
        status: row.get(11)?,
        agent_status: row.get(12)?,
        bg_id: row.get(13)?,
        error: row.get(14)?,
        started_at: row.get(15)?,
        updated_at: row.get(16)?,
        all_done_at: row.get(17)?,
        keep_open: row.get::<_, i64>(18)? != 0,
        cleanup_status: row.get(19)?,
    })
}

fn load_dev_session_items(
    conn: &Connection,
    session_id: &str,
) -> rusqlite::Result<Vec<DevSessionItemView>> {
    let mut stmt = conn.prepare(
        "SELECT dsi.session_id, dsi.issue_id, dsi.position, dsi.status, dsi.note, dsi.updated_at,
                i.identifier, i.title, i.state_name, i.url
         FROM dev_session_items dsi
         LEFT JOIN issues i ON i.id = dsi.issue_id
         WHERE dsi.session_id = ?1
         ORDER BY dsi.position ASC",
    )?;
    let rows = stmt.query_map(params![session_id], |row| {
        Ok(DevSessionItemView {
            session_id: row.get(0)?,
            issue_id: row.get(1)?,
            position: row.get(2)?,
            status: row.get(3)?,
            note: row.get(4)?,
            updated_at: row.get(5)?,
            identifier: row.get(6)?,
            title: row.get(7)?,
            state: row.get(8)?,
            url: row.get(9)?,
        })
    })?;
    let mut items = Vec::new();
    for r in rows {
        items.push(r?);
    }
    Ok(items)
}

pub fn insert_dev_session(
    conn: &Connection,
    session: &DevSession,
    issue_ids: &[String],
) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;
    let provider = if session.provider.trim() == "antigravity" {
        "antigravity"
    } else {
        "claude"
    };
    tx.execute(
        "INSERT INTO dev_sessions (
            id, name, slug, note, delivery, model, effort, provider, launch_mode, remote_session_id, remote_url, status, agent_status, bg_id, error, started_at, updated_at, all_done_at, keep_open, cleanup_status
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)",
        params![
            session.id,
            session.name,
            session.slug,
            session.note,
            session.delivery,
            session.model,
            session.effort,
            provider,
            session.launch_mode,
            session.remote_session_id,
            session.remote_url,
            session.status,
            session.agent_status,
            session.bg_id,
            session.error,
            session.started_at,
            session.updated_at,
            session.all_done_at,
            session.keep_open as i64,
            session.cleanup_status,
        ],
    )?;

    let mut seen = std::collections::HashSet::new();
    let mut pos = 0i64;
    for issue_id in issue_ids {
        if !seen.insert(issue_id.clone()) {
            continue;
        }
        tx.execute(
            "INSERT INTO dev_session_items (
                session_id, issue_id, position, status, note, updated_at
             ) VALUES (?1, ?2, ?3, 'queued', NULL, ?4)",
            params![session.id, issue_id, pos, session.started_at],
        )?;
        pos += 1;
    }

    tx.commit()?;
    Ok(())
}

pub fn add_dev_session_items(
    conn: &Connection,
    session_id: &str,
    issue_ids: &[String],
) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;
    let now = now_rfc3339();
    let max_pos: i64 = tx.query_row(
        "SELECT COALESCE(MAX(position), -1) FROM dev_session_items WHERE session_id = ?1",
        params![session_id],
        |row| row.get(0),
    )?;
    let mut next_pos = max_pos + 1;
    let mut seen = std::collections::HashSet::new();

    for issue_id in issue_ids {
        if !seen.insert(issue_id.clone()) {
            continue;
        }
        let existing: Option<String> = tx
            .query_row(
                "SELECT status FROM dev_session_items WHERE session_id = ?1 AND issue_id = ?2",
                params![session_id, issue_id],
                |row| row.get(0),
            )
            .optional()?;

        match existing.as_deref() {
            None => {
                tx.execute(
                    "INSERT INTO dev_session_items (
                        session_id, issue_id, position, status, note, updated_at
                     ) VALUES (?1, ?2, ?3, 'queued', NULL, ?4)",
                    params![session_id, issue_id, next_pos, now],
                )?;
                next_pos += 1;
            }
            Some("removed") => {
                tx.execute(
                    "UPDATE dev_session_items
                     SET position = ?1,
                         status = 'queued',
                         note = NULL,
                         updated_at = ?2
                     WHERE session_id = ?3 AND issue_id = ?4",
                    params![next_pos, now, session_id, issue_id],
                )?;
                next_pos += 1;
            }
            Some(_) => {}
        }
    }

    tx.execute(
        "UPDATE dev_sessions SET updated_at = ?2 WHERE id = ?1",
        params![session_id, now],
    )?;

    tx.commit()?;
    Ok(())
}

pub fn set_dev_session_item_status(
    conn: &Connection,
    session_id: &str,
    issue_id: &str,
    status: &str,
    note: Option<&str>,
) -> rusqlite::Result<()> {
    let now = now_rfc3339();
    conn.execute(
        "UPDATE dev_session_items
         SET status = ?3,
             note = COALESCE(?4, note),
             updated_at = ?5
         WHERE session_id = ?1 AND issue_id = ?2",
        params![session_id, issue_id, status, note, now],
    )?;
    conn.execute(
        "UPDATE dev_sessions SET updated_at = ?2 WHERE id = ?1",
        params![session_id, now],
    )?;
    Ok(())
}

/// Keep each group's items next to each other: every member is pulled up to sit right
/// after the group's highest-ranked member, keeping the members' relative order.
/// Ungrouped items keep their order. Returns the new order and whether anything moved.
pub fn cluster_groups(items: &[RankedItem]) -> (Vec<RankedItem>, bool) {
    let mut out = Vec::with_capacity(items.len());
    let mut done: std::collections::HashSet<&str> = std::collections::HashSet::new();
    for (i, item) in items.iter().enumerate() {
        match item.group.as_deref() {
            None => out.push(item.clone()),
            Some(g) => {
                if done.insert(g) {
                    out.extend(
                        items[i..]
                            .iter()
                            .filter(|other| other.group.as_deref() == Some(g))
                            .cloned(),
                    );
                }
            }
        }
    }
    let moved = out
        .iter()
        .map(|x| &x.issue_id)
        .ne(items.iter().map(|x| &x.issue_id));
    (out, moved)
}

/// Every member of a group must share one theme: pick the first non-None theme
/// among the group's members (in list order) and assign it to all members.
pub fn unify_group_themes(items: &mut [RankedItem]) -> bool {
    let mut group_theme: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    for item in items.iter() {
        if let (Some(g), Some(t)) = (&item.group, &item.theme) {
            group_theme.entry(g.clone()).or_insert_with(|| t.clone());
        }
    }
    let mut changed = false;
    for item in items.iter_mut() {
        if let Some(ref g) = item.group {
            if let Some(target) = group_theme.get(g) {
                if item.theme.as_deref() != Some(target.as_str()) {
                    item.theme = Some(target.clone());
                    changed = true;
                }
            }
        }
    }
    changed
}

/// Ensure tickets worked on by the same active dev session (2+ items) share a group.
pub fn group_dev_sessions(
    items: &mut [RankedItem],
    session_of: &std::collections::HashMap<String, (String, String)>,
) -> bool {
    let mut by_session: std::collections::HashMap<String, (String, Vec<usize>)> =
        std::collections::HashMap::new();
    for (idx, item) in items.iter().enumerate() {
        if let Some((sid, sname)) = session_of.get(&item.issue_id) {
            by_session
                .entry(sid.clone())
                .or_insert_with(|| (sname.clone(), Vec::new()))
                .1
                .push(idx);
        }
    }
    let mut changed = false;
    for (_sid, (sname, indices)) in by_session {
        if indices.len() < 2 {
            continue;
        }
        let first_group = indices.iter().find_map(|&idx| items[idx].group.clone());
        let target = match first_group {
            Some(g) => Some(g),
            None => {
                let truncated: String = sname.chars().take(60).collect();
                if truncated.trim().is_empty() {
                    None
                } else {
                    Some(truncated)
                }
            }
        };
        if let Some(target_group) = target {
            for idx in indices {
                if items[idx].group.is_none() {
                    items[idx].group = Some(target_group.clone());
                    changed = true;
                }
            }
        }
    }
    changed
}

pub fn set_dev_session_launch(
    conn: &Connection,
    id: &str,
    launch_mode: &str,
    remote_session_id: Option<&str>,
) -> rusqlite::Result<()> {
    let now = now_rfc3339();
    conn.execute(
        "UPDATE dev_sessions
         SET launch_mode = ?2,
             remote_session_id = ?3,
             updated_at = ?4
         WHERE id = ?1",
        params![id, launch_mode, remote_session_id, now],
    )?;
    Ok(())
}

pub fn set_dev_session_remote(
    conn: &Connection,
    id: &str,
    remote_session_id: Option<&str>,
    remote_url: Option<&str>,
) -> rusqlite::Result<()> {
    let now = now_rfc3339();
    conn.execute(
        "UPDATE dev_sessions
         SET remote_session_id = COALESCE(?2, remote_session_id),
             remote_url = COALESCE(?3, remote_url),
             updated_at = ?4
         WHERE id = ?1",
        params![id, remote_session_id, remote_url, now],
    )?;
    Ok(())
}

pub fn update_dev_session_status(
    conn: &Connection,
    id: &str,
    status: &str,
    bg_id: Option<&str>,
    agent_status: Option<&str>,
    error: Option<&str>,
) -> rusqlite::Result<()> {
    let now = now_rfc3339();
    conn.execute(
        "UPDATE dev_sessions
         SET status = ?2,
             bg_id = COALESCE(?3, bg_id),
             agent_status = ?4,
             error = ?5,
             updated_at = ?6
         WHERE id = ?1",
        params![id, status, bg_id, agent_status, error, now],
    )?;
    Ok(())
}

pub fn set_dev_session_all_done_at(
    conn: &Connection,
    id: &str,
    all_done_at: Option<&str>,
) -> rusqlite::Result<()> {
    let now = now_rfc3339();
    conn.execute(
        "UPDATE dev_sessions
         SET all_done_at = ?2,
             updated_at = ?3
         WHERE id = ?1",
        params![id, all_done_at, now],
    )?;
    Ok(())
}

pub fn set_dev_session_keep_open(
    conn: &Connection,
    id: &str,
    keep_open: bool,
) -> rusqlite::Result<()> {
    let now = now_rfc3339();
    conn.execute(
        "UPDATE dev_sessions
         SET keep_open = ?2,
             updated_at = ?3
         WHERE id = ?1",
        params![id, keep_open as i64, now],
    )?;
    Ok(())
}

pub fn set_dev_session_cleanup_status(
    conn: &Connection,
    id: &str,
    cleanup_status: Option<&str>,
) -> rusqlite::Result<()> {
    let now = now_rfc3339();
    conn.execute(
        "UPDATE dev_sessions
         SET cleanup_status = ?2,
             updated_at = ?3
         WHERE id = ?1",
        params![id, cleanup_status, now],
    )?;
    Ok(())
}

fn statuses_all_done<'a>(statuses: impl IntoIterator<Item = &'a str>) -> bool {
    let mut has_done = false;
    for status in statuses {
        match status {
            "done" => has_done = true,
            "removed" => {}
            _ => return false,
        }
    }
    has_done
}

/// Return true when at least one item has status `"done"` and every item is `"done"` or `"removed"`.
pub fn session_all_done(items: &[DevSessionItem]) -> bool {
    statuses_all_done(items.iter().map(|i| i.status.as_str()))
}

/// Return true when at least one item view has status `"done"` and every item is `"done"` or `"removed"`.
pub fn session_view_all_done(items: &[DevSessionItemView]) -> bool {
    statuses_all_done(items.iter().map(|i| i.status.as_str()))
}

pub fn load_dev_session(conn: &Connection, id: &str) -> rusqlite::Result<Option<DevSessionView>> {
    let session = conn
        .query_row(
            "SELECT id, name, slug, note, delivery, model, effort, provider, launch_mode, remote_session_id, remote_url, status, agent_status, bg_id, error, started_at, updated_at, all_done_at, keep_open, cleanup_status
             FROM dev_sessions
             WHERE id = ?1",
            params![id],
            row_to_dev_session,
        )
        .optional()?;

    let Some(session) = session else {
        return Ok(None);
    };

    let items = load_dev_session_items(conn, &session.id)?;
    Ok(Some(DevSessionView { session, items }))
}

pub fn list_dev_sessions(conn: &Connection, limit: usize) -> rusqlite::Result<Vec<DevSessionView>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, slug, note, delivery, model, effort, provider, launch_mode, remote_session_id, remote_url, status, agent_status, bg_id, error, started_at, updated_at, all_done_at, keep_open, cleanup_status
         FROM dev_sessions
         ORDER BY started_at DESC, rowid DESC
         LIMIT ?1",
    )?;
    let rows = stmt.query_map(params![limit as i64], row_to_dev_session)?;
    let mut sessions = Vec::new();
    for r in rows {
        let session = r?;
        let items = load_dev_session_items(conn, &session.id)?;
        sessions.push(DevSessionView { session, items });
    }
    Ok(sessions)
}

pub fn active_dev_session_for_issues(
    conn: &Connection,
) -> rusqlite::Result<Vec<(String, String, String, String)>> {
    let mut stmt = conn.prepare(
        "SELECT dsi.issue_id, ds.id, ds.name, dsi.status
         FROM dev_session_items dsi
         JOIN dev_sessions ds ON ds.id = dsi.session_id
         WHERE ds.status IN ('starting', 'running')
           AND dsi.status NOT IN ('removed', 'done')
         ORDER BY ds.started_at DESC, dsi.position ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn is_state_open(state_type: &str) -> bool {
    !matches!(
        state_type.trim().to_lowercase().as_str(),
        "completed" | "canceled" | "cancelled"
    )
}

pub fn load_dependencies(conn: &Connection) -> rusqlite::Result<Vec<IssueDependency>> {
    let mut stmt = conn.prepare(
        "SELECT d.issue_id,
                d.issue_identifier,
                d.blocker_id,
                d.blocker_identifier,
                d.blocker_title,
                COALESCE(b.state_name, d.blocker_state_name),
                COALESCE(b.state_type, d.blocker_state_type),
                d.source,
                d.reason,
                d.updated_at
         FROM issue_dependencies d
         LEFT JOIN issues b ON b.id = d.blocker_id
         WHERE d.source != 'dismissed'
         ORDER BY d.issue_id ASC, d.blocker_identifier ASC, d.blocker_id ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        let blocker_state_name: String = row.get(5)?;
        let blocker_state_type: String = row.get(6)?;
        let blocker_open = is_state_open(&blocker_state_type);
        Ok(IssueDependency {
            issue_id: row.get(0)?,
            issue_identifier: row.get(1)?,
            blocker_id: row.get(2)?,
            blocker_identifier: row.get(3)?,
            blocker_title: row.get(4)?,
            blocker_state_name,
            blocker_state_type,
            source: row.get(7)?,
            reason: row.get(8)?,
            updated_at: row.get(9)?,
            blocker_open,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn replace_linear_dependencies(
    conn: &Connection,
    scope_ids: &[String],
    rels: &[crate::linear::BlockRelation],
) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;
    if !scope_ids.is_empty() {
        let scope_set: std::collections::HashSet<&str> =
            scope_ids.iter().map(String::as_str).collect();
        let mut to_delete: Vec<(String, String)> = Vec::new();
        {
            let mut stmt = tx.prepare(
                "SELECT issue_id, blocker_id FROM issue_dependencies WHERE source = 'linear'",
            )?;
            let rows = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?;
            for r in rows {
                let (iid, bid): (String, String) = r?;
                if scope_set.contains(iid.as_str()) || scope_set.contains(bid.as_str()) {
                    to_delete.push((iid, bid));
                }
            }
        }
        let mut del_stmt = tx.prepare(
            "DELETE FROM issue_dependencies
             WHERE issue_id = ?1 AND blocker_id = ?2 AND source = 'linear'",
        )?;
        for (iid, bid) in to_delete {
            del_stmt.execute(params![iid, bid])?;
        }
    }

    let now = now_rfc3339();
    let mut upsert_stmt = tx.prepare(
        "INSERT INTO issue_dependencies (
            issue_id, issue_identifier, blocker_id, blocker_identifier,
            blocker_title, blocker_state_name, blocker_state_type,
            source, reason, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'linear', '', ?8)
         ON CONFLICT(issue_id, blocker_id) DO UPDATE SET
            issue_identifier = excluded.issue_identifier,
            blocker_identifier = excluded.blocker_identifier,
            blocker_title = excluded.blocker_title,
            blocker_state_name = excluded.blocker_state_name,
            blocker_state_type = excluded.blocker_state_type,
            source = 'linear',
            reason = CASE
                WHEN excluded.reason != '' THEN excluded.reason
                ELSE issue_dependencies.reason
            END,
            updated_at = excluded.updated_at",
    )?;
    for rel in rels {
        if rel.blocked_id == rel.blocker_id {
            continue;
        }
        upsert_stmt.execute(params![
            rel.blocked_id,
            rel.blocked_identifier,
            rel.blocker_id,
            rel.blocker_identifier,
            rel.blocker_title,
            rel.blocker_state_name,
            rel.blocker_state_type,
            now,
        ])?;
    }
    drop(upsert_stmt);
    tx.commit()?;
    Ok(())
}

pub fn set_suggested_dependencies(
    conn: &Connection,
    issue_id: &str,
    issue_identifier: &str,
    blockers: &[(String, String, String, String, String, String)],
) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "DELETE FROM issue_dependencies WHERE issue_id = ?1 AND source = 'suggested'",
        params![issue_id],
    )?;

    let now = now_rfc3339();
    let mut stmt = tx.prepare(
        "INSERT INTO issue_dependencies (
            issue_id, issue_identifier, blocker_id, blocker_identifier,
            blocker_title, blocker_state_name, blocker_state_type,
            source, reason, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'suggested', ?8, ?9)
         ON CONFLICT(issue_id, blocker_id) DO NOTHING",
    )?;
    for (blocker_id, identifier, title, state_name, state_type, reason) in blockers {
        if blocker_id == issue_id {
            continue;
        }
        stmt.execute(params![
            issue_id,
            issue_identifier,
            blocker_id,
            identifier,
            title,
            state_name,
            state_type,
            reason,
            now,
        ])?;
    }
    drop(stmt);
    tx.commit()?;
    Ok(())
}

pub fn set_dependency_source(
    conn: &Connection,
    issue_id: &str,
    blocker_id: &str,
    source: &str,
) -> rusqlite::Result<()> {
    let now = now_rfc3339();
    conn.execute(
        "UPDATE issue_dependencies
         SET source = ?3, updated_at = ?4
         WHERE issue_id = ?1 AND blocker_id = ?2",
        params![issue_id, blocker_id, source, now],
    )?;
    Ok(())
}

pub fn delete_dependency(
    conn: &Connection,
    issue_id: &str,
    blocker_id: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM issue_dependencies WHERE issue_id = ?1 AND blocker_id = ?2",
        params![issue_id, blocker_id],
    )?;
    Ok(())
}

fn find_cycle_nodes(n: usize, adj: &[Vec<usize>]) -> Vec<bool> {
    let mut in_cycle = vec![false; n];
    for start in 0..n {
        let mut visited = vec![false; n];
        let mut stack: Vec<usize> = adj[start].clone();
        while let Some(cur) = stack.pop() {
            if cur == start {
                in_cycle[start] = true;
                break;
            }
            if !visited[cur] {
                visited[cur] = true;
                for &next in &adj[cur] {
                    if !visited[next] || next == start {
                        stack.push(next);
                    }
                }
            }
        }
    }
    in_cycle
}

fn sort_unit_members(
    unit: Vec<RankedItem>,
    open_blockers: &std::collections::HashMap<String, Vec<String>>,
) -> (Vec<RankedItem>, Vec<String>) {
    let m = unit.len();
    if m <= 1 {
        return (unit, Vec::new());
    }

    let mut idx_by_id: std::collections::HashMap<&str, usize> =
        std::collections::HashMap::with_capacity(m);
    for (idx, item) in unit.iter().enumerate() {
        idx_by_id.insert(item.issue_id.as_str(), idx);
    }

    let mut dependents: Vec<Vec<usize>> = vec![Vec::new(); m];
    let mut in_degree: Vec<usize> = vec![0; m];
    for (i, item) in unit.iter().enumerate() {
        if let Some(blockers) = open_blockers.get(&item.issue_id) {
            let mut seen_j = std::collections::HashSet::new();
            for b_id in blockers {
                if let Some(&j) = idx_by_id.get(b_id.as_str()) {
                    if j != i && seen_j.insert(j) {
                        dependents[j].push(i);
                        in_degree[i] += 1;
                    }
                }
            }
        }
    }

    let mut placed = vec![false; m];
    let mut order = Vec::with_capacity(m);
    while order.len() < m {
        let next = (0..m).find(|&i| !placed[i] && in_degree[i] == 0);
        match next {
            Some(i) => {
                placed[i] = true;
                order.push(i);
                for &dep in &dependents[i] {
                    in_degree[dep] = in_degree[dep].saturating_sub(1);
                }
            }
            None => break,
        }
    }

    let mut cycle_ids = Vec::new();
    if order.len() < m {
        // Compute nodes in intra-unit cycles (blocker edges j -> i or dependency edges i -> j).
        let mut adj: Vec<Vec<usize>> = vec![Vec::new(); m];
        for (j, deps) in dependents.iter().enumerate() {
            for &i in deps {
                adj[i].push(j);
            }
        }
        let in_cycle = find_cycle_nodes(m, &adj);
        for i in 0..m {
            if !placed[i] {
                if in_cycle[i] {
                    cycle_ids.push(unit[i].issue_id.clone());
                }
                order.push(i);
            }
        }
    }

    let mut slots: Vec<Option<RankedItem>> = unit.into_iter().map(Some).collect();
    let sorted = order
        .into_iter()
        .filter_map(|i| slots[i].take())
        .collect();
    (sorted, cycle_ids)
}

/// Enforce open blocking dependencies on a ranked list while keeping grouped items contiguous.
/// Returns `(reordered_items, moved, cycle_issue_ids)`.
pub fn enforce_dependencies(
    items: &[RankedItem],
    open_blockers: &std::collections::HashMap<String, Vec<String>>,
) -> (Vec<RankedItem>, bool, Vec<String>) {
    if items.is_empty() {
        return (Vec::new(), false, Vec::new());
    }

    // Partition into units: maximal consecutive runs with the same Some(group),
    // or single items when group is None.
    let mut units: Vec<Vec<RankedItem>> = Vec::new();
    for item in items {
        let same_group = match (units.last().and_then(|u| u.first()), &item.group) {
            (Some(prev), Some(g)) => prev.group.as_deref() == Some(g.as_str()),
            _ => false,
        };
        if same_group {
            units.last_mut().unwrap().push(item.clone());
        } else {
            units.push(vec![item.clone()]);
        }
    }

    let mut intra_cycle_ids: Vec<String> = Vec::new();
    units = units
        .into_iter()
        .map(|u| {
            let (sorted, c_ids) = sort_unit_members(u, open_blockers);
            intra_cycle_ids.extend(c_ids);
            sorted
        })
        .collect();

    let build_unit_adj = |cur_units: &[Vec<RankedItem>]| -> Vec<Vec<usize>> {
        let mut u_of: std::collections::HashMap<&str, usize> = std::collections::HashMap::new();
        for (idx, u) in cur_units.iter().enumerate() {
            for m in u {
                u_of.insert(m.issue_id.as_str(), idx);
            }
        }
        let mut adj = vec![Vec::new(); cur_units.len()];
        for (u_idx, u) in cur_units.iter().enumerate() {
            let mut seen = std::collections::HashSet::new();
            for m in u {
                if let Some(blockers) = open_blockers.get(&m.issue_id) {
                    for b_id in blockers {
                        if let Some(&b_u) = u_of.get(b_id.as_str()) {
                            if b_u != u_idx && seen.insert(b_u) {
                                adj[u_idx].push(b_u);
                            }
                        }
                    }
                }
            }
        }
        adj
    };

    let pass_limit = items.len() + 1;
    let safety_limit = (units.len() * units.len() * 2).max(pass_limit);
    let mut passes = 0usize;
    let mut hit_cycle = false;

    loop {
        let mut unit_of: std::collections::HashMap<&str, usize> =
            std::collections::HashMap::with_capacity(items.len());
        for (u_idx, u) in units.iter().enumerate() {
            for m in u {
                unit_of.insert(m.issue_id.as_str(), u_idx);
            }
        }

        let mut moved_in_pass = false;
        for u_idx in 0..units.len() {
            let mut max_blocker_unit: Option<usize> = None;
            for member in &units[u_idx] {
                if let Some(blockers) = open_blockers.get(&member.issue_id) {
                    for b_id in blockers {
                        if let Some(&b_unit) = unit_of.get(b_id.as_str()) {
                            if b_unit != u_idx {
                                max_blocker_unit = Some(match max_blocker_unit {
                                    Some(prev) => prev.max(b_unit),
                                    None => b_unit,
                                });
                            }
                        }
                    }
                }
            }
            if let Some(l_idx) = max_blocker_unit {
                if l_idx > u_idx {
                    let unit = units.remove(u_idx);
                    units.insert(l_idx, unit);
                    moved_in_pass = true;
                    break;
                }
            }
        }

        if !moved_in_pass {
            break;
        }

        passes += 1;
        if passes > pass_limit {
            let adj = build_unit_adj(&units);
            let unit_in_cycle = find_cycle_nodes(units.len(), &adj);
            if unit_in_cycle.into_iter().any(|b| b) || passes > safety_limit {
                hit_cycle = true;
                break;
            }
        }
    }

    let mut cycle_ids: Vec<String> = Vec::new();
    let mut seen_cycle = std::collections::HashSet::new();

    if hit_cycle {
        let adj = build_unit_adj(&units);
        let unit_in_cycle = find_cycle_nodes(units.len(), &adj);

        // First try identifying exact items in an item-level cycle.
        let n = items.len();
        let mut item_idx: std::collections::HashMap<&str, usize> =
            std::collections::HashMap::with_capacity(n);
        for (i, item) in items.iter().enumerate() {
            item_idx.insert(item.issue_id.as_str(), i);
        }
        let mut item_adj: Vec<Vec<usize>> = vec![Vec::new(); n];
        for (i, item) in items.iter().enumerate() {
            if let Some(blockers) = open_blockers.get(&item.issue_id) {
                for b_id in blockers {
                    if let Some(&j) = item_idx.get(b_id.as_str()) {
                        if j != i {
                            item_adj[i].push(j);
                        }
                    }
                }
            }
        }
        let item_in_cycle = find_cycle_nodes(n, &item_adj);
        for (i, item) in items.iter().enumerate() {
            if item_in_cycle[i] && seen_cycle.insert(item.issue_id.clone()) {
                cycle_ids.push(item.issue_id.clone());
            }
        }

        // Fallback for cycles induced by grouping (no item-level cycle on its own).
        if cycle_ids.is_empty() {
            for (u_idx, u) in units.iter().enumerate() {
                if unit_in_cycle[u_idx] {
                    for m in u {
                        if seen_cycle.insert(m.issue_id.clone()) {
                            cycle_ids.push(m.issue_id.clone());
                        }
                    }
                }
            }
        }
    }

    for id in intra_cycle_ids {
        if seen_cycle.insert(id.clone()) {
            cycle_ids.push(id);
        }
    }

    let out: Vec<RankedItem> = units.into_iter().flatten().collect();
    let moved = out
        .iter()
        .map(|x| &x.issue_id)
        .ne(items.iter().map(|x| &x.issue_id));
    (out, moved, cycle_ids)
}

#[cfg(test)]
mod tests {
    use super::{
        active_dev_session_for_issues, add_to_backlog, cluster_groups, enforce_dependencies,
        group_dev_sessions, init_db, insert_dev_session, load_backlog, load_backlog_groups,
        load_backlog_themes, load_dependencies, load_dev_session, replace_backlog,
        replace_backlog_ranked, replace_linear_dependencies, session_all_done,
        set_dependency_source, set_dev_session_all_done_at, set_dev_session_cleanup_status,
        set_dev_session_item_status, set_dev_session_keep_open, set_suggested_dependencies,
        unify_group_themes, update_dev_session_status, DevSession, DevSessionItem, RankedItem,
    };
    use crate::linear::BlockRelation;
    use std::collections::HashMap;
    use std::path::Path;

    fn it(id: &str, g: Option<&str>) -> RankedItem {
        RankedItem {
            issue_id: id.to_string(),
            note: None,
            group: g.map(str::to_string),
            theme: None,
        }
    }

    fn it_gt(id: &str, g: Option<&str>, t: Option<&str>) -> RankedItem {
        RankedItem {
            issue_id: id.to_string(),
            note: None,
            group: g.map(str::to_string),
            theme: t.map(str::to_string),
        }
    }

    fn ids(v: &[RankedItem]) -> Vec<&str> {
        v.iter().map(|x| x.issue_id.as_str()).collect()
    }

    #[test]
    fn cluster_pulls_members_up_to_first_member() {
        let items = vec![
            it("a", None),
            it("b", Some("g1")),
            it("c", None),
            it("d", Some("g2")),
            it("e", Some("g1")),
            it("f", Some("g2")),
            it("g", Some("g1")),
        ];
        let (out, moved) = cluster_groups(&items);
        assert!(moved);
        assert_eq!(ids(&out), vec!["a", "b", "e", "g", "c", "d", "f"]);
    }

    #[test]
    fn cluster_leaves_contiguous_order_alone() {
        let items = vec![it("a", Some("g")), it("b", Some("g")), it("c", None)];
        let (out, moved) = cluster_groups(&items);
        assert!(!moved);
        assert_eq!(ids(&out), vec!["a", "b", "c"]);
    }

    #[test]
    fn unify_group_themes_picks_first_non_none_and_sets_all_members() {
        let mut items = vec![
            it_gt("a", Some("g1"), None),
            it_gt("b", Some("g1"), Some("t1")),
            it_gt("c", Some("g1"), Some("t2")),
            it_gt("d", None, Some("other")),
            it_gt("e", Some("g2"), None),
        ];
        assert!(unify_group_themes(&mut items));
        assert_eq!(items[0].theme.as_deref(), Some("t1"));
        assert_eq!(items[1].theme.as_deref(), Some("t1"));
        assert_eq!(items[2].theme.as_deref(), Some("t1"));
        assert_eq!(items[3].theme.as_deref(), Some("other"));
        assert_eq!(items[4].theme, None);

        // Calling again should report no change.
        assert!(!unify_group_themes(&mut items));
    }

    #[test]
    fn group_dev_sessions_groups_un_grouped_and_partially_grouped() {
        let long_name = "s".repeat(75);
        let expected_trunc: String = long_name.chars().take(60).collect();

        let mut session_of = HashMap::new();
        session_of.insert("a".to_string(), ("s1".to_string(), long_name));
        session_of.insert("b".to_string(), ("s1".to_string(), "ignored".to_string()));
        session_of.insert("c".to_string(), ("s2".to_string(), "sess2".to_string()));
        session_of.insert("d".to_string(), ("s2".to_string(), "sess2".to_string()));
        session_of.insert("e".to_string(), ("s3".to_string(), "solo".to_string()));

        let mut items = vec![
            it("a", None),
            it("b", None),
            it("c", None),
            it("d", Some("existing-batch")),
            it("e", None),
        ];
        assert!(group_dev_sessions(&mut items, &session_of));
        assert_eq!(items[0].group.as_deref(), Some(expected_trunc.as_str()));
        assert_eq!(items[1].group.as_deref(), Some(expected_trunc.as_str()));
        assert_eq!(items[2].group.as_deref(), Some("existing-batch"));
        assert_eq!(items[3].group.as_deref(), Some("existing-batch"));
        assert_eq!(items[4].group, None);

        // Calling again should report no change.
        assert!(!group_dev_sessions(&mut items, &session_of));
    }

    #[test]
    fn replace_backlog_ranked_rewrites_themes_drops_orphans_and_preserves_on_reorder() {
        let mut conn = init_db(Path::new(":memory:")).expect("in-memory db");
        let items = vec![
            it_gt("i1", Some("g1"), Some("t1")),
            it_gt("i2", None, Some("t_undeclared")),
        ];
        let groups = vec![
            ("g_orphan".to_string(), "unused".to_string()),
            ("g1".to_string(), "ship together".to_string()),
        ];
        let themes = vec![
            ("t_orphan".to_string(), "unused".to_string()),
            ("t1".to_string(), "initiative 1".to_string()),
            ("t1".to_string(), "duplicate".to_string()),
            ("   ".to_string(), "blank".to_string()),
        ];

        replace_backlog_ranked(&mut conn, &items, &groups, &themes, "claude").unwrap();

        let entries = load_backlog(&conn).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].group_name.as_deref(), Some("g1"));
        assert_eq!(entries[0].theme_name.as_deref(), Some("t1"));
        assert_eq!(entries[1].group_name, None);
        assert_eq!(entries[1].theme_name.as_deref(), Some("t_undeclared"));

        let loaded_groups = load_backlog_groups(&conn).unwrap();
        assert_eq!(loaded_groups.len(), 1);
        assert_eq!(loaded_groups[0].name, "g1");
        assert_eq!(loaded_groups[0].reason, "ship together");

        let loaded_themes = load_backlog_themes(&conn).unwrap();
        assert_eq!(loaded_themes.len(), 2);
        assert_eq!(loaded_themes[0].name, "t1");
        assert_eq!(loaded_themes[0].reason, "initiative 1");
        assert_eq!(loaded_themes[0].position, 1);
        assert_eq!(loaded_themes[1].name, "t_undeclared");
        assert_eq!(loaded_themes[1].reason, "");
        assert_eq!(loaded_themes[1].position, 2);

        // User reorder and add preserve existing theme_name and give None to new items.
        replace_backlog(
            &mut conn,
            &[("i2".to_string(), None), ("i1".to_string(), None), ("i3".to_string(), None)],
            "me",
        )
        .unwrap();
        add_to_backlog(&mut conn, "i4", None, None, "me").unwrap();

        let reordered = load_backlog(&conn).unwrap();
        assert_eq!(reordered[0].issue_id, "i2");
        assert_eq!(reordered[0].theme_name.as_deref(), Some("t_undeclared"));
        assert_eq!(reordered[1].issue_id, "i1");
        assert_eq!(reordered[1].theme_name.as_deref(), Some("t1"));
        assert_eq!(reordered[2].issue_id, "i3");
        assert_eq!(reordered[2].theme_name, None);
        assert_eq!(reordered[3].issue_id, "i4");
        assert_eq!(reordered[3].theme_name, None);
    }

    #[test]
    fn enforce_dependencies_moves_blocked_single_below_blocker() {
        let items = vec![it("a", None), it("x", None), it("b", None)];
        let mut blockers = HashMap::new();
        blockers.insert("a".to_string(), vec!["b".to_string()]);
        let (out, moved, cycle) = enforce_dependencies(&items, &blockers);
        assert!(moved);
        assert!(cycle.is_empty());
        assert_eq!(ids(&out), vec!["x", "b", "a"]);
    }

    #[test]
    fn enforce_dependencies_moves_whole_group_below_blocker() {
        let items = vec![
            it("g1_a", Some("g1")),
            it("g1_b", Some("g1")),
            it("mid", None),
            it("blk", None),
        ];
        let mut blockers = HashMap::new();
        blockers.insert("g1_a".to_string(), vec!["blk".to_string()]);
        let (out, moved, cycle) = enforce_dependencies(&items, &blockers);
        assert!(moved);
        assert!(cycle.is_empty());
        assert_eq!(ids(&out), vec!["mid", "blk", "g1_a", "g1_b"]);
    }

    #[test]
    fn enforce_dependencies_orders_members_inside_group() {
        let items = vec![
            it("a", Some("g1")),
            it("b", Some("g1")),
            it("c", Some("g1")),
        ];
        let mut blockers = HashMap::new();
        blockers.insert("a".to_string(), vec!["c".to_string()]);
        let (out, moved, cycle) = enforce_dependencies(&items, &blockers);
        assert!(moved);
        assert!(cycle.is_empty());
        assert_eq!(ids(&out), vec!["b", "c", "a"]);
    }

    #[test]
    fn enforce_dependencies_leaves_valid_order_untouched() {
        let items = vec![
            it("blk", None),
            it("a", Some("g1")),
            it("b", Some("g1")),
            it("c", None),
        ];
        let mut blockers = HashMap::new();
        blockers.insert("b".to_string(), vec!["a".to_string()]);
        blockers.insert("c".to_string(), vec!["blk".to_string()]);
        let (out, moved, cycle) = enforce_dependencies(&items, &blockers);
        assert!(!moved);
        assert!(cycle.is_empty());
        assert_eq!(ids(&out), vec!["blk", "a", "b", "c"]);
    }

    #[test]
    fn enforce_dependencies_terminates_on_2_cycle_and_reports_it() {
        let items = vec![it("a", None), it("b", None), it("c", None)];
        let mut blockers = HashMap::new();
        blockers.insert("a".to_string(), vec!["b".to_string()]);
        blockers.insert("b".to_string(), vec!["a".to_string()]);
        let (out, _moved, cycle) = enforce_dependencies(&items, &blockers);
        assert_eq!(out.len(), 3);
        assert_eq!(cycle, vec!["a".to_string(), "b".to_string()]);
    }

    #[test]
    fn enforce_dependencies_ignores_blockers_not_in_items() {
        let items = vec![it("a", None), it("b", None)];
        let mut blockers = HashMap::new();
        blockers.insert("a".to_string(), vec!["outside".to_string()]);
        let (out, moved, cycle) = enforce_dependencies(&items, &blockers);
        assert!(!moved);
        assert!(cycle.is_empty());
        assert_eq!(ids(&out), vec!["a", "b"]);
    }

    #[test]
    fn dependencies_respect_linear_and_dismissed_and_upgrade_suggested() {
        let conn = init_db(Path::new(":memory:")).expect("in-memory db");

        // Insert initial suggested dependencies for i1: b_lin (will become linear), b_dis (will be dismissed), b_sug (will stay suggested).
        set_suggested_dependencies(
            &conn,
            "i1",
            "KAR-1",
            &[
                (
                    "b_lin".into(),
                    "KAR-2".into(),
                    "Blocker linear".into(),
                    "Todo".into(),
                    "unstarted".into(),
                    "needs schema first".into(),
                ),
                (
                    "b_dis".into(),
                    "KAR-3".into(),
                    "Blocker dismissed".into(),
                    "Todo".into(),
                    "unstarted".into(),
                    "false positive".into(),
                ),
                (
                    "b_sug".into(),
                    "KAR-4".into(),
                    "Blocker suggested".into(),
                    "Done".into(),
                    "completed".into(),
                    "already done".into(),
                ),
                (
                    "i1".into(),
                    "KAR-1".into(),
                    "Self".into(),
                    "Todo".into(),
                    "unstarted".into(),
                    "skip self".into(),
                ),
            ],
        )
        .unwrap();

        let deps = load_dependencies(&conn).unwrap();
        assert_eq!(deps.len(), 3);
        assert!(deps.iter().find(|d| d.blocker_id == "b_sug").unwrap().blocker_open == false);
        assert!(deps.iter().find(|d| d.blocker_id == "b_lin").unwrap().blocker_open);

        // Dismiss b_dis.
        set_dependency_source(&conn, "i1", "b_dis", "dismissed").unwrap();
        // Upgrade b_lin to linear via replace_linear_dependencies; should preserve its reason.
        replace_linear_dependencies(
            &conn,
            &["i1".to_string()],
            &[BlockRelation {
                blocked_id: "i1".into(),
                blocked_identifier: "KAR-1".into(),
                blocked_title: "Issue 1".into(),
                blocked_state_name: "Todo".into(),
                blocked_state_type: "unstarted".into(),
                blocker_id: "b_lin".into(),
                blocker_identifier: "KAR-2".into(),
                blocker_title: "Blocker linear".into(),
                blocker_state_name: "In Progress".into(),
                blocker_state_type: "started".into(),
            }],
        )
        .unwrap();

        // Now call set_suggested_dependencies again trying to re-suggest b_lin and b_dis, and dropping b_sug.
        set_suggested_dependencies(
            &conn,
            "i1",
            "KAR-1",
            &[
                (
                    "b_lin".into(),
                    "KAR-2".into(),
                    "Blocker linear".into(),
                    "Todo".into(),
                    "unstarted".into(),
                    "new suggested reason".into(),
                ),
                (
                    "b_dis".into(),
                    "KAR-3".into(),
                    "Blocker dismissed".into(),
                    "Todo".into(),
                    "unstarted".into(),
                    "re-suggested".into(),
                ),
            ],
        )
        .unwrap();

        let after = load_dependencies(&conn).unwrap();
        assert_eq!(after.len(), 1);
        assert_eq!(after[0].blocker_id, "b_lin");
        assert_eq!(after[0].source, "linear");
        assert_eq!(after[0].reason, "needs schema first");
        assert_eq!(after[0].blocker_state_name, "In Progress");
        assert!(after[0].blocker_open);
    }

    fn dev_item(issue_id: &str, status: &str) -> DevSessionItem {
        DevSessionItem {
            session_id: "s1".to_string(),
            issue_id: issue_id.to_string(),
            position: 0,
            status: status.to_string(),
            note: None,
            updated_at: "2026-11-18T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn session_all_done_cases() {
        assert!(!session_all_done(&[]));
        assert!(session_all_done(&[dev_item("i1", "done"), dev_item("i2", "done")]));
        assert!(session_all_done(&[dev_item("i1", "done"), dev_item("i2", "removed")]));
        assert!(!session_all_done(&[dev_item("i1", "done"), dev_item("i2", "queued")]));
        assert!(!session_all_done(&[dev_item("i1", "removed")]));
        assert!(!session_all_done(&[dev_item("i1", "done"), dev_item("i2", "in_progress")]));
    }

    #[test]
    fn dev_session_cleanup_columns_and_finished_status() {
        let conn = init_db(Path::new(":memory:")).expect("in-memory db");
        let session = DevSession {
            id: "0123456789abcdef".to_string(),
            name: "KAR-1".to_string(),
            slug: "lp-kar-1-abcd".to_string(),
            note: String::new(),
            delivery: "per_issue".to_string(),
            model: None,
            effort: None,
            provider: "claude".to_string(),
            launch_mode: Some("launcher".to_string()),
            remote_session_id: Some("session_AbCdEf123456".to_string()),
            remote_url: None,
            status: "running".to_string(),
            agent_status: None,
            bg_id: None,
            error: None,
            started_at: "2026-11-18T10:00:00Z".to_string(),
            updated_at: "2026-11-18T10:00:00Z".to_string(),
            all_done_at: None,
            keep_open: false,
            cleanup_status: None,
        };
        insert_dev_session(&conn, &session, &["i1".to_string()]).unwrap();
        set_dev_session_item_status(&conn, &session.id, "i1", "in_progress", None).unwrap();
        assert_eq!(active_dev_session_for_issues(&conn).unwrap().len(), 1);

        set_dev_session_all_done_at(&conn, &session.id, Some("2026-11-18T10:30:00Z")).unwrap();
        set_dev_session_keep_open(&conn, &session.id, true).unwrap();
        set_dev_session_cleanup_status(&conn, &session.id, Some("BUSY")).unwrap();

        let loaded = load_dev_session(&conn, &session.id).unwrap().unwrap();
        assert_eq!(
            loaded.session.all_done_at.as_deref(),
            Some("2026-11-18T10:30:00Z")
        );
        assert!(loaded.session.keep_open);
        assert_eq!(loaded.session.cleanup_status.as_deref(), Some("BUSY"));

        set_dev_session_all_done_at(&conn, &session.id, None).unwrap();
        set_dev_session_keep_open(&conn, &session.id, false).unwrap();
        update_dev_session_status(&conn, &session.id, "finished", None, None, None).unwrap();

        let finished = load_dev_session(&conn, &session.id).unwrap().unwrap();
        assert_eq!(finished.session.status, "finished");
        assert_eq!(finished.session.all_done_at, None);
        assert!(!finished.session.keep_open);
        assert!(active_dev_session_for_issues(&conn).unwrap().is_empty());
    }
}
