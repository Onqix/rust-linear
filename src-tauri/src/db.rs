use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub linear_api_key: String,
    pub anthropic_api_key: String,
    pub claude_model: String,
    pub viewer_id: Option<String>,
    pub viewer_name: Option<String>,
    pub auto_sync_seconds: i64,
    pub notifications_enabled: bool,
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
    pub last_seen_at: Option<String>,
    pub unread_responses: usize,
    pub comments: Vec<LinearComment>,
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
        ",
    )?;
    let _ = conn.execute("ALTER TABLE issues ADD COLUMN project_name TEXT", []);
    let _ = conn.execute("ALTER TABLE issues ADD COLUMN team_id TEXT NOT NULL DEFAULT ''", []);
    let _ = conn.execute("ALTER TABLE issues ADD COLUMN state_id TEXT NOT NULL DEFAULT ''", []);
    let _ = conn.execute("ALTER TABLE issues ADD COLUMN project_id TEXT", []);
    let _ = conn.execute("ALTER TABLE issues ADD COLUMN assignee_id TEXT", []);
    let _ = conn.execute("ALTER TABLE issues ADD COLUMN label_ids_json TEXT NOT NULL DEFAULT '[]'", []);
    let _ = conn.execute("ALTER TABLE saved_views ADD COLUMN icon TEXT NOT NULL DEFAULT 'indigo'", []);
    let _ = conn.execute("ALTER TABLE saved_views ADD COLUMN match_mode TEXT NOT NULL DEFAULT 'all'", []);
    let _ = conn.execute("ALTER TABLE saved_views ADD COLUMN filters_json TEXT NOT NULL DEFAULT '[]'", []);
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

pub fn load_settings(conn: &Connection) -> rusqlite::Result<AppSettings> {
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
        .unwrap_or_else(|| "claude-haiku-4-5".to_string());

    let viewer_id = get_setting(conn, "viewer_id")?;
    let viewer_name = get_setting(conn, "viewer_name")?;

    let auto_sync_seconds = get_setting(conn, "auto_sync_seconds")?
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(60);

    let notifications_enabled = get_setting(conn, "notifications_enabled")?
        .map(|s| s != "false")
        .unwrap_or(true);

    Ok(AppSettings {
        linear_api_key,
        anthropic_api_key,
        claude_model,
        viewer_id,
        viewer_name,
        auto_sync_seconds,
        notifications_enabled,
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
    let synced = get_setting(conn, "catalog_synced_v3")?;
    if synced.as_deref() != Some("true") {
        return Ok(None);
    }
    Ok(get_setting(conn, "last_sync_at")?.filter(|s| !s.is_empty()))
}

pub fn set_sync_cursor(conn: &Connection, ts: &str) -> rusqlite::Result<()> {
    set_setting(conn, "catalog_synced_v3", "true")?;
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
        tx.execute(
            "INSERT INTO issues (
                id, identifier, title, description, url, priority, priority_label,
                state_id, state_name, state_type, state_color,
                team_id, team_key, team_name, project_id, project_name,
                assignee_id, assignee_name, labels_json, label_ids_json,
                updated_at, created_at
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7,
                ?8, ?9, ?10, ?11,
                ?12, ?13, ?14, ?15, ?16,
                ?17, ?18, ?19, ?20,
                ?21, ?22
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
                updated_at = excluded.updated_at,
                created_at = excluded.created_at",
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
                issue.updated_at,
                issue.created_at,
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
                i.labels_json, i.label_ids_json, i.updated_at, i.created_at, r.last_seen_at
         FROM issues i
         LEFT JOIN issue_reads r ON r.issue_id = i.id
         ORDER BY i.updated_at DESC",
    )?;

    let rows = stmt.query_map([], |row| {
        let labels_json: String = row.get(18)?;
        let label_ids_json: String = row.get(19)?;
        let labels: Vec<String> = serde_json::from_str(&labels_json).unwrap_or_default();
        let label_ids: Vec<String> = serde_json::from_str(&label_ids_json).unwrap_or_default();
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
            updated_at: row.get(20)?,
            created_at: row.get(21)?,
            last_seen_at: row.get(22)?,
            unread_responses: 0,
            comments: Vec::new(),
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
        "SELECT id, name, icon, match_mode, filters_json, team_filter, scope_filter,
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
            team_filter: row.get(5)?,
            scope_filter: row.get(6)?,
            assignee_filter: row.get(7)?,
            project_filter: row.get(8)?,
            label_filter: row.get(9)?,
            search_query: row.get(10)?,
            layout_mode: row.get(11)?,
            created_at: row.get(12)?,
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
    conn.execute(
        "INSERT INTO saved_views (
            id, name, icon, match_mode, filters_json, team_filter, scope_filter, assignee_filter,
            project_filter, label_filter, search_query, layout_mode, created_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
         ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            icon = excluded.icon,
            match_mode = excluded.match_mode,
            filters_json = excluded.filters_json,
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
