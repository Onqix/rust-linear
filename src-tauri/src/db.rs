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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinearComment {
    pub id: String,
    pub body: String,
    pub created_at: String,
    pub author_id: Option<String>,
    pub author_name: String,
    pub is_unread: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LinearIssue {
    pub id: String,
    pub identifier: String,
    pub title: String,
    pub description: Option<String>,
    pub url: String,
    pub priority: i64,
    pub priority_label: String,
    pub state_name: String,
    pub state_type: String,
    pub state_color: String,
    pub team_key: String,
    pub team_name: String,
    pub project_name: Option<String>,
    pub assignee_name: Option<String>,
    pub labels: Vec<String>,
    pub updated_at: String,
    pub created_at: String,
    pub last_seen_at: Option<String>,
    pub unread_responses: usize,
    pub comments: Vec<LinearComment>,
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
            state_name TEXT NOT NULL,
            state_type TEXT NOT NULL,
            state_color TEXT NOT NULL,
            team_key TEXT NOT NULL,
            team_name TEXT NOT NULL,
            project_name TEXT,
            assignee_name TEXT,
            labels_json TEXT NOT NULL,
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
        ",
    )?;
    let _ = conn.execute("ALTER TABLE issues ADD COLUMN project_name TEXT", []);
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

    Ok(AppSettings {
        linear_api_key,
        anthropic_api_key,
        claude_model,
        viewer_id,
        viewer_name,
    })
}

pub fn save_settings(
    conn: &Connection,
    linear_api_key: &str,
    anthropic_api_key: &str,
    claude_model: &str,
) -> rusqlite::Result<()> {
    set_setting(conn, "linear_api_key", linear_api_key.trim())?;
    set_setting(conn, "anthropic_api_key", anthropic_api_key.trim())?;
    let model = if claude_model.trim().is_empty() {
        "claude-haiku-4-5"
    } else {
        claude_model.trim()
    };
    set_setting(conn, "claude_model", model)?;
    Ok(())
}

pub fn save_viewer(conn: &Connection, viewer_id: &str, viewer_name: &str) -> rusqlite::Result<()> {
    set_setting(conn, "viewer_id", viewer_id)?;
    set_setting(conn, "viewer_name", viewer_name)?;
    Ok(())
}

pub fn upsert_issues(conn: &mut Connection, issues: &[LinearIssue]) -> rusqlite::Result<()> {
    let tx = conn.transaction()?;
    tx.execute("DELETE FROM comments", [])?;
    tx.execute("DELETE FROM issues", [])?;

    for issue in issues {
        let labels_json = serde_json::to_string(&issue.labels).unwrap_or_else(|_| "[]".into());
        tx.execute(
            "INSERT INTO issues (
                id, identifier, title, description, url, priority, priority_label,
                state_name, state_type, state_color, team_key, team_name, project_name,
                assignee_name, labels_json, updated_at, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
            params![
                issue.id,
                issue.identifier,
                issue.title,
                issue.description,
                issue.url,
                issue.priority,
                issue.priority_label,
                issue.state_name,
                issue.state_type,
                issue.state_color,
                issue.team_key,
                issue.team_name,
                issue.project_name,
                issue.assignee_name,
                labels_json,
                issue.updated_at,
                issue.created_at,
            ],
        )?;

        for c in &issue.comments {
            tx.execute(
                "INSERT INTO comments (id, issue_id, body, created_at, author_id, author_name)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
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
    }

    tx.commit()?;
    Ok(())
}

pub fn load_issues(conn: &Connection, viewer_id: Option<&str>) -> rusqlite::Result<Vec<LinearIssue>> {
    let mut stmt = conn.prepare(
        "SELECT i.id, i.identifier, i.title, i.description, i.url, i.priority, i.priority_label,
                i.state_name, i.state_type, i.state_color, i.team_key, i.team_name, i.project_name,
                i.assignee_name, i.labels_json, i.updated_at, i.created_at, r.last_seen_at
         FROM issues i
         LEFT JOIN issue_reads r ON r.issue_id = i.id
         ORDER BY i.updated_at DESC",
    )?;

    let rows = stmt.query_map([], |row| {
        let labels_json: String = row.get(14)?;
        let labels: Vec<String> = serde_json::from_str(&labels_json).unwrap_or_default();
        Ok(LinearIssue {
            id: row.get(0)?,
            identifier: row.get(1)?,
            title: row.get(2)?,
            description: row.get(3)?,
            url: row.get(4)?,
            priority: row.get(5)?,
            priority_label: row.get(6)?,
            state_name: row.get(7)?,
            state_type: row.get(8)?,
            state_color: row.get(9)?,
            team_key: row.get(10)?,
            team_name: row.get(11)?,
            project_name: row.get(12)?,
            assignee_name: row.get(13)?,
            labels,
            updated_at: row.get(15)?,
            created_at: row.get(16)?,
            last_seen_at: row.get(17)?,
            unread_responses: 0,
            comments: Vec::new(),
        })
    })?;

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
            let created_at: String = c_row.get(2)?;
            let author_id: Option<String> = c_row.get(3)?;
            let is_from_other = match (viewer_id, author_id.as_deref()) {
                (Some(me), Some(author)) => me != author,
                _ => true,
            };
            let is_after_seen = match issue.last_seen_at.as_deref() {
                Some(seen) => created_at.as_str() > seen,
                None => true,
            };
            let is_unread = is_from_other && is_after_seen;

            Ok(LinearComment {
                id: c_row.get(0)?,
                body: c_row.get(1)?,
                created_at,
                author_id,
                author_name: c_row.get(4)?,
                is_unread,
            })
        })?;

        let mut unread_count = 0usize;
        for c in c_rows {
            let comment = c?;
            if comment.is_unread {
                unread_count += 1;
            }
            issue.comments.push(comment);
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
        "INSERT INTO issue_reads (issue_id, last_seen_at)
         SELECT id, ?1 FROM issues
         ON CONFLICT(issue_id) DO UPDATE SET last_seen_at = excluded.last_seen_at",
        params![seen_at],
    )?;
    Ok(())
}

pub fn mark_issue_unread(conn: &Connection, issue_id: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM issue_reads WHERE issue_id = ?1", params![issue_id])?;
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
