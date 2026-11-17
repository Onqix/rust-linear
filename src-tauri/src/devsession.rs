use crate::db::{self, BridgeSettings, DEFAULT_DEV_COMMAND};
use crate::mcp::Notify;
use rusqlite::Connection;
use serde_json::Value;
use std::collections::HashMap;
use std::process::{ExitStatus, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::AsyncReadExt;

const START_TIMEOUT_SECS: u64 = 90;
const CONTROL_TIMEOUT_SECS: u64 = 30;
const MAX_ERROR_LINES: usize = 20;

/// Keep `[A-Za-z0-9 +#._-]`, collapse whitespace, trim, and cap at 80 chars.
pub fn sanitize_name(raw: &str) -> String {
    let filtered: String = raw
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, ' ' | '+' | '#' | '.' | '_' | '-'))
        .collect();
    let collapsed = filtered.split_whitespace().collect::<Vec<_>>().join(" ");
    let capped: String = collapsed.chars().take(80).collect();
    let trimmed = capped.trim();
    if trimmed.is_empty() {
        "Linear Pulse session".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Build a branch/worktree slug: `lp-<id1>-<id2>-<id3>-<4hex>`, keeping `[a-z0-9-]`.
pub fn make_slug(identifiers: &[String]) -> String {
    let cleaned: Vec<String> = identifiers
        .iter()
        .take(3)
        .map(|id| {
            id.to_ascii_lowercase()
                .chars()
                .filter(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == '-')
                .collect::<String>()
        })
        .filter(|s| !s.is_empty())
        .collect();

    let mut rand_hex = db::generate_token();
    rand_hex.truncate(4);

    let raw_slug = if cleaned.is_empty() {
        format!("lp-{rand_hex}")
    } else {
        format!("lp-{}-{rand_hex}", cleaned.join("-"))
    };

    raw_slug
        .chars()
        .filter(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == '-')
        .collect()
}

/// Single-quote a string for POSIX shells, escaping `'` as `'\''`.
pub fn shell_single_quote(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('\'');
    for ch in s.chars() {
        if ch == '\'' {
            out.push_str("'\\''");
        } else {
            out.push(ch);
        }
    }
    out.push('\'');
    out
}

/// Standard-alphabet base64 encoder with `=` padding.
pub fn base64_encode(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = chunk.get(1).copied().unwrap_or(0) as u32;
        let b2 = chunk.get(2).copied().unwrap_or(0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;

        out.push(TABLE[((n >> 18) & 0x3f) as usize] as char);
        out.push(TABLE[((n >> 12) & 0x3f) as usize] as char);
        if chunk.len() > 1 {
            out.push(TABLE[((n >> 6) & 0x3f) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(TABLE[(n & 0x3f) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

/// Validate a model alias or full model name; empty means server default.
pub fn validate_model(s: &str) -> Result<String, String> {
    let trimmed = s.trim();
    if trimmed.is_empty() {
        return Ok(String::new());
    }
    if trimmed.len() > 64
        || !trimmed
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'[' | b']' | b'-'))
    {
        return Err(
            "Invalid model: must be 1-64 characters matching [A-Za-z0-9._[]-].".to_string(),
        );
    }
    Ok(trimmed.to_string())
}

/// Validate a reasoning effort level; empty means server default.
pub fn validate_effort(s: &str) -> Result<String, String> {
    let trimmed = s.trim();
    if trimmed.is_empty() || matches!(trimmed, "low" | "medium" | "high" | "xhigh" | "max") {
        Ok(trimmed.to_string())
    } else {
        Err(format!(
            "Invalid effort '{trimmed}': expected low, medium, high, xhigh, or max."
        ))
    }
}

/// Fill `{name}`, `{slug}`, `{model_flags}`, and `{prompt}` placeholders in the remote dev command template.
pub fn build_dev_command(
    template: &str,
    name: &str,
    slug: &str,
    prompt: &str,
    model: &str,
    effort: &str,
) -> String {
    let quoted_name = shell_single_quote(name);
    let clean_slug: String = slug
        .chars()
        .filter(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == '-')
        .collect();
    let b64 = base64_encode(prompt.as_bytes());
    let prompt_arg = format!("\"$(printf %s '{b64}' | base64 -d)\"");

    let mut flag_parts = Vec::new();
    let trimmed_model = model.trim();
    if !trimmed_model.is_empty() {
        flag_parts.push(format!("--model {}", shell_single_quote(trimmed_model)));
    }
    let trimmed_effort = effort.trim();
    if !trimmed_effort.is_empty() {
        flag_parts.push(format!("--effort {trimmed_effort}"));
    }
    let flags = flag_parts.join(" ");
    let has_model_flags = template.contains("{model_flags}");

    let mut out = String::with_capacity(template.len() + prompt_arg.len() + flags.len() + 1);
    let mut rest = template;
    while !rest.is_empty() {
        if let Some(after) = rest.strip_prefix("{name}") {
            out.push_str(&quoted_name);
            rest = after;
        } else if let Some(after) = rest.strip_prefix("{slug}") {
            out.push_str(&clean_slug);
            rest = after;
        } else if let Some(after) = rest.strip_prefix("{model_flags}") {
            out.push_str(&flags);
            rest = after;
        } else if let Some(after) = rest.strip_prefix("{prompt}") {
            if !has_model_flags && !flags.is_empty() {
                out.push_str(&flags);
                out.push(' ');
            }
            out.push_str(&prompt_arg);
            rest = after;
        } else if let Some(ch) = rest.chars().next() {
            out.push(ch);
            rest = &rest[ch.len_utf8()..];
        }
    }
    out
}

/// Build the initial prompt sent to the Remote Control Claude Code dev session.
pub fn build_dev_prompt(
    session_id: &str,
    name: &str,
    note: &str,
    delivery: &str,
    items: &[(String, String)],
) -> String {
    let mut parts = Vec::new();

    parts.push(format!(
        "You are a development session started from James's Linear Pulse app — session {session_id} (\"{name}\"). Your work queue lives in the app: call the linear-pulse tool `get_session_queue` with session_id \"{session_id}\" now, and again after each item you finish; James may add issues while you work."
    ));

    if !items.is_empty() {
        let mut lines = Vec::with_capacity(items.len() + 1);
        lines.push("Initial queue:".to_string());
        for (identifier, title) in items {
            if title.trim().is_empty() {
                lines.push(format!("- {identifier}"));
            } else {
                lines.push(format!("- {identifier} — {title}"));
            }
        }
        parts.push(lines.join("\n"));
    }

    parts.push(
        "Follow this repository's CLAUDE.md workflow for each issue (branches, implementation, checks, Linear updates, PRs)."
            .to_string(),
    );

    parts.push(
        "You may work through issues yourself in this session, or start a sub-session (claude-code-remote `create_session`) for an issue that can proceed independently. Track sub-sessions from here and report on them. Do the work in order unless dependencies say otherwise."
            .to_string(),
    );

    parts.push(
        "Report progress with `update_session_item`: in_progress when you start an issue, split when handed to a sub-session, blocked with a note when you need James, done when finished."
            .to_string(),
    );

    let delivery_line = if delivery == "combined" {
        "Deliver one combined PR for the whole group."
    } else {
        "Deliver one PR per issue."
    };
    parts.push(delivery_line.to_string());

    let trimmed_note = note.trim();
    if !trimmed_note.is_empty() {
        parts.push(format!("James's note (highest weight): {trimmed_note}"));
    }

    parts.push(
        "When get_session_queue shows nothing queued or in progress, post a short summary of what shipped and what is blocked."
            .to_string(),
    );

    parts.join("\n\n")
}

/// Run a command over SSH using non-interactive BatchMode options and a timeout.
pub async fn run_ssh(
    target: &str,
    remote_cmd: &str,
    timeout: Duration,
) -> Result<(String, String), String> {
    let mut cmd = tokio::process::Command::new("ssh");
    cmd.args([
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=accept-new",
        "-o",
        "ConnectTimeout=15",
        target,
        remote_cmd,
    ])
    .stdin(Stdio::null())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .kill_on_drop(true);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to launch ssh: {e}"))?;

    let stdout_pipe = child.stdout.take();
    let stderr_pipe = child.stderr.take();

    let stdout_task = tokio::spawn(async move {
        let mut buf = Vec::new();
        if let Some(mut out) = stdout_pipe {
            let _ = out.read_to_end(&mut buf).await;
        }
        buf
    });

    let stderr_task = tokio::spawn(async move {
        let mut buf = Vec::new();
        if let Some(mut err) = stderr_pipe {
            let _ = err.read_to_end(&mut buf).await;
        }
        buf
    });

    let wait_res = tokio::time::timeout(timeout, child.wait()).await;

    let status = match wait_res {
        Ok(Ok(status)) => status,
        Ok(Err(e)) => {
            stdout_task.abort();
            stderr_task.abort();
            return Err(format!("SSH process wait error: {e}"));
        }
        Err(_) => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            stdout_task.abort();
            stderr_task.abort();
            return Err(format!("SSH timed out after {}s", timeout.as_secs()));
        }
    };

    let stdout_bytes = stdout_task.await.unwrap_or_default();
    let stderr_bytes = stderr_task.await.unwrap_or_default();
    let stdout_str = String::from_utf8_lossy(&stdout_bytes).into_owned();
    let stderr_str = String::from_utf8_lossy(&stderr_bytes).into_owned();

    if status.success() {
        Ok((stdout_str, stderr_str))
    } else {
        Err(format_failure_output(&stderr_str, &stdout_str, status))
    }
}

fn strip_ansi_escapes(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == 0x1b && i + 1 < bytes.len() && bytes[i + 1] == b'[' {
            i += 2;
            while i < bytes.len() {
                let b = bytes[i];
                i += 1;
                if (b'@'..=b'~').contains(&b) {
                    break;
                }
            }
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Extract the 8-hex background session id that follows `"backgrounded"`, ignoring ANSI codes.
pub fn parse_bg_id(stdout: &str) -> Option<String> {
    let stripped = strip_ansi_escapes(stdout);
    let idx = stripped.find("backgrounded")?;
    let after = &stripped[idx + "backgrounded".len()..];
    for token in after.split(|c: char| !c.is_ascii_alphanumeric()) {
        if token.len() == 8 && token.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Some(token.to_ascii_lowercase());
        }
    }
    None
}

fn is_valid_bg_id(bg_id: &str) -> bool {
    bg_id.len() == 8 && bg_id.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

fn resolve_ssh_target(settings: &BridgeSettings) -> Result<String, String> {
    let primary = settings.rerank_ssh_target.trim();
    let target = if !primary.is_empty() {
        primary
    } else {
        settings.ssh_target.trim()
    };
    if target.is_empty() {
        Err("No SSH target configured. Set Rerank SSH Target or Tunnel SSH Target in Settings.".to_string())
    } else {
        Ok(target.to_string())
    }
}

/// Start a Remote Control Claude Code background session over SSH and persist the result.
pub async fn start_dev_session(
    db: Arc<Mutex<Connection>>,
    notify: Notify,
    settings: BridgeSettings,
    session_id: String,
) {
    let loaded = {
        let Ok(conn) = db.lock() else {
            return;
        };
        db::load_dev_session(&conn, &session_id)
    };

    let view = match loaded {
        Ok(Some(v)) => v,
        Ok(None) => {
            (notify)("dev-sessions-changed");
            return;
        }
        Err(e) => {
            if let Ok(conn) = db.lock() {
                let _ = db::update_dev_session_status(
                    &conn,
                    &session_id,
                    "failed",
                    None,
                    None,
                    Some(&e.to_string()),
                );
            }
            (notify)("dev-sessions-changed");
            return;
        }
    };

    let target = match resolve_ssh_target(&settings) {
        Ok(t) => t,
        Err(err) => {
            if let Ok(conn) = db.lock() {
                let _ = db::update_dev_session_status(
                    &conn,
                    &session_id,
                    "failed",
                    None,
                    None,
                    Some(&err),
                );
            }
            (notify)("dev-sessions-changed");
            return;
        }
    };

    let clean_name = sanitize_name(&view.session.name);
    let prompt_items: Vec<(String, String)> = view
        .items
        .iter()
        .filter(|i| i.status != "removed")
        .map(|i| {
            (
                i.identifier.clone().unwrap_or_else(|| i.issue_id.clone()),
                i.title.clone().unwrap_or_default(),
            )
        })
        .collect();

    let prompt = build_dev_prompt(
        &view.session.id,
        &clean_name,
        &view.session.note,
        &view.session.delivery,
        &prompt_items,
    );

    let model = match validate_model(view.session.model.as_deref().unwrap_or("")) {
        Ok(m) => m,
        Err(err) => {
            if let Ok(conn) = db.lock() {
                let _ = db::update_dev_session_status(
                    &conn,
                    &session_id,
                    "failed",
                    None,
                    None,
                    Some(&err),
                );
            }
            (notify)("dev-sessions-changed");
            return;
        }
    };
    let effort = match validate_effort(view.session.effort.as_deref().unwrap_or("")) {
        Ok(e) => e,
        Err(err) => {
            if let Ok(conn) = db.lock() {
                let _ = db::update_dev_session_status(
                    &conn,
                    &session_id,
                    "failed",
                    None,
                    None,
                    Some(&err),
                );
            }
            (notify)("dev-sessions-changed");
            return;
        }
    };

    let template = if settings.dev_command.trim().is_empty() {
        DEFAULT_DEV_COMMAND
    } else {
        settings.dev_command.trim()
    };
    let remote_cmd = build_dev_command(
        template,
        &clean_name,
        &view.session.slug,
        &prompt,
        &model,
        &effort,
    );

    match run_ssh(&target, &remote_cmd, Duration::from_secs(START_TIMEOUT_SECS)).await {
        Ok((stdout, _stderr)) => {
            if let Some(bg_id) = parse_bg_id(&stdout) {
                if let Ok(conn) = db.lock() {
                    let _ = db::update_dev_session_status(
                        &conn,
                        &session_id,
                        "running",
                        Some(&bg_id),
                        None,
                        None,
                    );
                }
            } else {
                let preview: String = stdout.trim().chars().take(300).collect();
                let err = format!("Couldn't find the session id in: {preview}");
                if let Ok(conn) = db.lock() {
                    let _ = db::update_dev_session_status(
                        &conn,
                        &session_id,
                        "failed",
                        None,
                        None,
                        Some(&err),
                    );
                }
            }
        }
        Err(err) => {
            if let Ok(conn) = db.lock() {
                let _ = db::update_dev_session_status(
                    &conn,
                    &session_id,
                    "failed",
                    None,
                    None,
                    Some(&err),
                );
            }
        }
    }

    (notify)("dev-sessions-changed");
}

/// Poll `claude agents --json --all` over SSH and sync active session statuses.
pub async fn refresh_dev_sessions(
    db: Arc<Mutex<Connection>>,
    settings: BridgeSettings,
) -> Result<(), String> {
    let target = resolve_ssh_target(&settings)?;
    let (stdout, _stderr) = run_ssh(
        &target,
        "~/.local/bin/claude agents --json --all",
        Duration::from_secs(CONTROL_TIMEOUT_SECS),
    )
    .await?;

    let trimmed = stdout.trim();
    let parsed: Vec<Value> = if trimmed.is_empty() {
        Vec::new()
    } else {
        serde_json::from_str(trimmed)
            .map_err(|e| format!("Failed to parse claude agents JSON: {e}"))?
    };

    let mut agents_by_id: HashMap<String, String> = HashMap::new();
    for entry in parsed {
        if let Some(id) = entry.get("id").and_then(|v| v.as_str()) {
            let status = entry
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string();
            agents_by_id.insert(id.to_ascii_lowercase(), status);
        }
    }

    let conn = db.lock().map_err(|e| e.to_string())?;
    let sessions = db::list_dev_sessions(&conn, 100).map_err(|e| e.to_string())?;
    for view in sessions {
        if view.session.status == "running" {
            if let Some(ref bg_id) = view.session.bg_id {
                let alive = agents_by_id
                    .get(&bg_id.to_ascii_lowercase())
                    .filter(|st| !is_finished_agent_status(st));
                if let Some(agent_status) = alive {
                    db::update_dev_session_status(
                        &conn,
                        &view.session.id,
                        "running",
                        None,
                        Some(agent_status),
                        None,
                    )
                    .map_err(|e| e.to_string())?;
                } else {
                    db::update_dev_session_status(
                        &conn,
                        &view.session.id,
                        "ended",
                        None,
                        None,
                        None,
                    )
                    .map_err(|e| e.to_string())?;
                }
            }
        }
    }

    Ok(())
}

/// Stop a running dev session on the server (when it has a `bg_id`) and mark it `stopped`.
pub async fn stop_dev_session(
    db: Arc<Mutex<Connection>>,
    settings: BridgeSettings,
    id: String,
) -> Result<(), String> {
    let bg_id = {
        let conn = db.lock().map_err(|e| e.to_string())?;
        let view = db::load_dev_session(&conn, &id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Dev session '{id}' not found."))?;
        view.session.bg_id
    };

    if let Some(ref bg_id) = bg_id {
        if !is_valid_bg_id(bg_id) {
            return Err(format!("Invalid background session id: '{bg_id}'"));
        }
        let target = resolve_ssh_target(&settings)?;
        let cmd = format!("~/.local/bin/claude stop {bg_id}");
        // If the session already exited on the server, `claude stop` fails; the user still
        // wants it marked stopped here, so only an unreachable server is an error.
        if let Err(err) = run_ssh(&target, &cmd, Duration::from_secs(CONTROL_TIMEOUT_SECS)).await {
            let lower = err.to_ascii_lowercase();
            if lower.contains("failed to launch ssh")
                || lower.contains("timed out")
                || lower.contains("permission denied")
                || lower.contains("could not resolve")
                || lower.contains("connection refused")
                || lower.contains("connection timed out")
            {
                return Err(err);
            }
        }
    }

    let conn = db.lock().map_err(|e| e.to_string())?;
    db::update_dev_session_status(&conn, &id, "stopped", None, None, None)
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn is_finished_agent_status(status: &str) -> bool {
    matches!(
        status.to_ascii_lowercase().as_str(),
        "stopped" | "exited" | "completed" | "complete" | "done" | "failed" | "dead" | "error" | "killed"
    )
}

fn format_failure_output(stderr: &str, stdout: &str, status: ExitStatus) -> String {
    let source = if !stderr.trim().is_empty() {
        stderr
    } else if !stdout.trim().is_empty() {
        stdout
    } else {
        return format!("SSH exited with status {status}");
    };

    tail_lines(source, MAX_ERROR_LINES)
}

fn tail_lines(text: &str, max_lines: usize) -> String {
    let lines: Vec<&str> = text.trim().lines().collect();
    let start = lines.len().saturating_sub(max_lines);
    lines[start..].join("\n").trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_base64_vectors() {
        assert_eq!(base64_encode(b""), "");
        assert_eq!(base64_encode(b"f"), "Zg==");
        assert_eq!(base64_encode(b"fo"), "Zm8=");
        assert_eq!(base64_encode(b"foo"), "Zm9v");
        assert_eq!(base64_encode(b"foobar"), "Zm9vYmFy");
        assert_eq!(base64_encode(b"Hello, World!"), "SGVsbG8sIFdvcmxkIQ==");
    }

    #[test]
    fn test_parse_bg_id_plain_and_ansi() {
        assert_eq!(
            parse_bg_id("backgrounded · 5cac8cf1 · KAR-1 + KAR-2\n"),
            Some("5cac8cf1".to_string())
        );
        assert_eq!(
            parse_bg_id(
                "\x1b[32mbackgrounded\x1b[0m \x1b[2m·\x1b[0m \x1b[1;36m5CAC8CF1\x1b[0m · KAR-1 + KAR-2\n"
            ),
            Some("5cac8cf1".to_string())
        );
        assert_eq!(parse_bg_id("no session id here"), None);
        assert_eq!(parse_bg_id("backgrounded · nothex12"), None);
    }

    #[test]
    fn test_sanitize_name() {
        assert_eq!(sanitize_name("KAR-1 + KAR-2"), "KAR-1 + KAR-2");
        assert_eq!(
            sanitize_name("  Fix #42: $(rm -rf /); 'hello'_world.v2  "),
            "Fix #42 rm -rf hello_world.v2"
        );
        assert_eq!(sanitize_name("!@$%^&*()"), "Linear Pulse session");
        let long = "a".repeat(100);
        assert_eq!(sanitize_name(&long).len(), 80);
    }

    #[test]
    fn test_make_slug() {
        let ids = vec![
            "KAR-896".to_string(),
            "KAR-930".to_string(),
            "KAR-898".to_string(),
            "KAR-999".to_string(),
        ];
        let slug = make_slug(&ids);
        assert!(slug.starts_with("lp-kar-896-kar-930-kar-898-"));
        assert!(!slug.contains("999"));
        assert!(slug
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-'));
        let tail = slug.strip_prefix("lp-kar-896-kar-930-kar-898-").unwrap();
        assert_eq!(tail.len(), 4);
        assert!(tail.bytes().all(|b| b.is_ascii_hexdigit()));
    }

    #[test]
    fn test_build_dev_command() {
        let cmd = build_dev_command(
            DEFAULT_DEV_COMMAND,
            "KAR-1's fix",
            "lp-kar-1-abcd",
            "Hello, World!",
            "opus",
            "high",
        );
        assert!(cmd.contains("-n 'KAR-1'\\''s fix'"));
        assert!(cmd.contains("--remote-control 'KAR-1'\\''s fix'"));
        assert!(cmd.contains("-w lp-kar-1-abcd"));
        assert!(cmd.contains(
            "--model 'opus' --effort high \"$(printf %s 'SGVsbG8sIFdvcmxkIQ==' | base64 -d)\""
        ));
    }

    #[test]
    fn test_build_dev_command_flags_absent() {
        let cmd = build_dev_command(
            DEFAULT_DEV_COMMAND,
            "KAR-1",
            "lp-kar-1-abcd",
            "Hello, World!",
            "",
            "",
        );
        assert!(!cmd.contains("--model"));
        assert!(!cmd.contains("--effort"));
        assert!(cmd.contains(
            "--permission-mode auto \"$(printf %s 'SGVsbG8sIFdvcmxkIQ==' | base64 -d)\""
        ));
    }

    #[test]
    fn test_build_dev_command_model_flags_placeholder() {
        let tpl = "claude --bg {model_flags} -n {name} {prompt}";
        let cmd = build_dev_command(tpl, "sess", "lp-1", "hi", "sonnet", "xhigh");
        assert_eq!(
            cmd,
            "claude --bg --model 'sonnet' --effort xhigh -n 'sess' \"$(printf %s 'aGk=' | base64 -d)\""
        );

        let cmd_only_model = build_dev_command(tpl, "sess", "lp-1", "hi", "fable", "");
        assert_eq!(
            cmd_only_model,
            "claude --bg --model 'fable' -n 'sess' \"$(printf %s 'aGk=' | base64 -d)\""
        );

        let cmd_empty = build_dev_command(tpl, "sess", "lp-1", "hi", "", "");
        assert_eq!(
            cmd_empty,
            "claude --bg  -n 'sess' \"$(printf %s 'aGk=' | base64 -d)\""
        );
    }

    #[test]
    fn test_validate_model() {
        assert_eq!(validate_model("  ").unwrap(), "");
        assert_eq!(validate_model(" opus ").unwrap(), "opus");
        assert_eq!(
            validate_model("claude-opus-4-6[1m]").unwrap(),
            "claude-opus-4-6[1m]"
        );
        assert!(validate_model("opus; rm -rf /").is_err());
        assert!(validate_model("$(x)").is_err());
        assert!(validate_model(&"a".repeat(65)).is_err());
    }

    #[test]
    fn test_validate_effort() {
        assert_eq!(validate_effort(" ").unwrap(), "");
        for lvl in ["low", "medium", "high", "xhigh", "max"] {
            assert_eq!(validate_effort(lvl).unwrap(), lvl);
        }
        assert!(validate_effort("extreme").is_err());
        assert!(validate_effort("high; id").is_err());
    }
}
