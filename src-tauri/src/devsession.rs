use crate::db::{self, BridgeSettings, DevSessionView, DEFAULT_DEV_COMMAND, DEFAULT_DEV_ENVIRONMENT_ID};
use crate::mcp::Notify;
use rusqlite::Connection;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::process::{ExitStatus, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::AsyncReadExt;

const START_TIMEOUT_SECS: u64 = 90;
const CONTROL_TIMEOUT_SECS: u64 = 30;
const LAUNCHER_WAIT_MAX_SECS: u64 = 120;
const LAUNCHER_WAIT_SSH_TIMEOUT_SECS: u64 = 150;
const LAUNCHER_ONLINE_MAX_AGE_SECS: i64 = 300;
const MAX_ERROR_LINES: usize = 20;
const SSH_RETRY_DELAYS_SECS: [u64; 2] = [8, 20];
pub const AUTO_FINISH_GRACE_SECS: i64 = 30 * 60;

const TRANSIENT_SSH_ERROR_PATTERNS: &[&str] = &[
    "connection refused",
    "connection reset",
    "connection timed out",
    "kex_exchange_identification",
    "connection closed by",
    "no route to host",
    "network is unreachable",
    "temporary failure in name resolution",
    "mux_client",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SplitHow {
    Cli {
        model_flags: String,
    },
    Full {
        environment_id: String,
        model: String,
        effort: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaunchResult {
    pub ok: bool,
    pub remote_session_id: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct LauncherStatus {
    pub online: bool,
    pub heartbeat_age_secs: Option<i64>,
    pub launcher_session_id: Option<String>,
}

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

/// Validate a cloud environment id (`^(env|ccpool)_[A-Za-z0-9]{6,64}$`); empty uses the default.
pub fn validate_environment_id(s: &str) -> Result<String, String> {
    let trimmed = s.trim();
    if trimmed.is_empty() {
        return Ok(DEFAULT_DEV_ENVIRONMENT_ID.to_string());
    }
    let rest = trimmed
        .strip_prefix("env_")
        .or_else(|| trimmed.strip_prefix("ccpool_"));
    match rest {
        Some(r) if (6..=64).contains(&r.len()) && r.bytes().all(|b| b.is_ascii_alphanumeric()) => {
            Ok(trimmed.to_string())
        }
        _ => Err(
            "Invalid environment id: expected env_... or ccpool_... followed by 6-64 alphanumeric characters."
                .to_string(),
        ),
    }
}

/// Map a short model alias to its full Claude model ID, passing unknown/empty strings through.
pub fn full_model_id(alias: &str) -> String {
    match alias.to_ascii_lowercase().as_str() {
        "opus" => "claude-opus-5-5".to_string(),
        "sonnet" => "claude-sonnet-5-5".to_string(),
        "fable" => "claude-fable-5-2".to_string(),
        "haiku" => "claude-haiku-5-5".to_string(),
        _ => alias.to_string(),
    }
}

fn is_lower_hex(s: &str, len: usize) -> bool {
    s.len() == len && s.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

/// Validate a launcher request id against `^[a-f0-9]{16}-(start|stop|notify-[a-f0-9]{8})$`.
pub fn is_valid_request_id(s: &str) -> bool {
    if let Some(hex) = s.strip_suffix("-start").or_else(|| s.strip_suffix("-stop")) {
        return is_lower_hex(hex, 16);
    }
    if let Some((prefix, suffix)) = s.split_once("-notify-") {
        return is_lower_hex(prefix, 16) && is_lower_hex(suffix, 8);
    }
    false
}

/// Validate a Claude remote session id against `^session_[A-Za-z0-9]{10,64}$`.
pub fn is_valid_claude_session_id(s: &str) -> bool {
    let Some(rest) = s.strip_prefix("session_") else {
        return false;
    };
    (10..=64).contains(&rest.len()) && rest.bytes().all(|b| b.is_ascii_alphanumeric())
}

/// Build the JSON payload for a launcher start request.
pub fn build_start_request(
    sid: &str,
    title: &str,
    environment_id: &str,
    model_full: &str,
    effort: &str,
    prompt: &str,
) -> String {
    serde_json::json!({
        "id": format!("{sid}-start"),
        "kind": "start",
        "dev_session_id": sid,
        "title": title,
        "environment_id": environment_id,
        "model": model_full,
        "effort": effort,
        "prompt": prompt,
    })
    .to_string()
}

/// Build the JSON payload for a launcher stop request.
pub fn build_stop_request(sid: &str, remote_session_id: &str) -> String {
    serde_json::json!({
        "id": format!("{sid}-stop"),
        "kind": "stop",
        "dev_session_id": sid,
        "remote_session_id": remote_session_id,
    })
    .to_string()
}

/// Build the JSON payload for a launcher notify request.
pub fn build_notify_request(
    request_id: &str,
    sid: &str,
    remote_session_id: &str,
    message: &str,
) -> String {
    serde_json::json!({
        "id": request_id,
        "kind": "notify",
        "dev_session_id": sid,
        "remote_session_id": remote_session_id,
        "message": message,
    })
    .to_string()
}

fn format_queue_item_entry(identifier: &str, title: &str) -> String {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        return identifier.to_string();
    }
    let mut chars = trimmed.chars();
    let short: String = chars.by_ref().take(120).collect();
    if chars.next().is_some() {
        format!("{identifier} ({short}…)")
    } else {
        format!("{identifier} ({short})")
    }
}

/// Format a message informing a running Claude dev session of queue additions/removals.
pub fn build_queue_change_message(
    session_name: &str,
    added: &[(String, String)],
    removed: &[(String, String)],
) -> Option<String> {
    if added.is_empty() && removed.is_empty() {
        return None;
    }
    let mut msg = format!(
        "From James's Linear Pulse app: your queue for \"{session_name}\" changed."
    );
    if !added.is_empty() {
        let items = added
            .iter()
            .map(|(id, title)| format_queue_item_entry(id, title))
            .collect::<Vec<_>>()
            .join(", ");
        msg.push_str(&format!(
            " Added: {items}. Call get_session_queue to see the full queue, then work the new tickets like the others (respect blockers: a ticket that blocks one you are on comes first) and report progress with update_session_item."
        ));
    }
    if !removed.is_empty() {
        let items = removed
            .iter()
            .map(|(id, title)| format_queue_item_entry(id, title))
            .collect::<Vec<_>>()
            .join(", ");
        msg.push_str(&format!(
            " Removed: {items}. Stop working on removed tickets; don't report on them."
        ));
    }
    Some(msg)
}

/// Build the remote shell command that atomically writes a request JSON file via base64.
pub fn build_write_request_cmd(request_id: &str, json: &str) -> String {
    assert!(is_valid_request_id(request_id), "invalid request_id");
    let b64 = base64_encode(json.as_bytes());
    format!(
        "mkdir -p ~/.linear-pulse/requests && rm -f ~/.linear-pulse/results/{request_id}.json && printf %s '{b64}' | base64 -d > ~/.linear-pulse/requests/.{request_id}.tmp && mv ~/.linear-pulse/requests/.{request_id}.tmp ~/.linear-pulse/requests/{request_id}.json"
    )
}

/// Build the remote shell loop that polls for a launcher result file up to `max_secs`.
pub fn build_wait_result_cmd(request_id: &str, max_secs: u64) -> String {
    assert!(is_valid_request_id(request_id), "invalid request_id");
    let file = format!("~/.linear-pulse/results/{request_id}.json");
    let max_iters = max_secs.div_ceil(3);
    format!(
        "i=0; while [ ! -f {file} ] && [ \"$i\" -lt {max_iters} ]; do sleep 3; i=$((i + 1)); done; if [ -f {file} ]; then cat {file}; else echo PENDING; fi"
    )
}

fn launch_result_from_value(v: &Value) -> LaunchResult {
    let ok = v.get("ok").and_then(|x| x.as_bool()).unwrap_or(false);
    let remote_session_id = v
        .get("remote_session_id")
        .and_then(|x| x.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let error = v
        .get("error")
        .and_then(|x| x.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    LaunchResult {
        ok,
        remote_session_id,
        error,
    }
}

/// Parse a launcher result file response, returning `None` for empty output or `PENDING`.
pub fn parse_result(text: &str) -> Option<LaunchResult> {
    let trimmed = text.trim();
    if trimmed.is_empty() || trimmed == "PENDING" {
        return None;
    }
    let val: Value = serde_json::from_str(trimmed).ok()?;
    Some(launch_result_from_value(&val))
}

/// Parse the stdout of the launcher heartbeat/status probe.
pub fn parse_launcher_status(stdout: &str) -> LauncherStatus {
    let mut lines = stdout.lines().map(str::trim);
    let hb_opt = lines.next().and_then(|s| s.parse::<i64>().ok());
    let now_opt = lines.next().and_then(|s| s.parse::<i64>().ok());
    let launcher_session_id = lines
        .next()
        .filter(|s| is_valid_claude_session_id(s))
        .map(str::to_string);

    match (hb_opt, now_opt) {
        (Some(hb), Some(now)) if hb > 0 && now > 0 => {
            let age = now - hb;
            LauncherStatus {
                online: age <= LAUNCHER_ONLINE_MAX_AGE_SECS,
                heartbeat_age_secs: Some(age.max(0)),
                launcher_session_id,
            }
        }
        _ => LauncherStatus {
            online: false,
            heartbeat_age_secs: None,
            launcher_session_id,
        },
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
    split: &SplitHow,
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

    let split_paragraph = match split {
        SplitHow::Cli { model_flags } => format!(
            "This session was started from the command line, so it has no claude-code-remote tools (no add_repo, subscribe_pr_activity or create_session). That is expected; don't stop to ask about it. For PRs, use `gh` instead of subscribing: `gh pr checks <n> --watch` for CI, and `gh pr view <n> --comments` / `gh api` for reviews. You may work through issues yourself in this session, or split off an issue that can proceed independently by starting a sub-session from Bash in the main checkout: `cd /srv/repos/dealwire && claude --bg --remote-control '<name>' -n '<name>' -w <slug> --permission-mode auto {model_flags} '<prompt>'`, with a prompt that names the issue and the session_id of this queue so it can report through update_session_item. Mark the item split, track sub-sessions from here (`claude agents --json`), and report on them. Do the work in order unless dependencies say otherwise.",
        ),
        SplitHow::Full {
            environment_id,
            model,
            effort,
        } => {
            let mut clauses = vec![format!("environment_id \"{environment_id}\"")];
            if !model.trim().is_empty() {
                clauses.push(format!("model \"{}\"", model.trim()));
            }
            if !effort.trim().is_empty() {
                clauses.push(format!("effort \"{}\"", effort.trim()));
            }
            let tool_args = clauses.join(", ");
            format!(
                "This session has the full Claude Code tools. Follow this repository's CLAUDE.md for pull requests, including `add_repo` and `subscribe_pr_activity` for each PR you open. You may work through the issues yourself, or split off an issue that can proceed independently into its own session with the claude-code-remote `create_session` tool: {tool_args}, a title naming the issue, and a prompt that names the issue and this queue's session_id ({session_id}) so it can report through `update_session_item`. Mark the item split and keep track of the sessions you start. Do the work in order unless dependencies say otherwise."
            )
        }
    };
    parts.push(split_paragraph);

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

#[cfg(unix)]
fn current_user_suffix() -> String {
    #[cfg(target_os = "linux")]
    if let Ok(meta) = std::fs::metadata("/proc/self") {
        use std::os::unix::fs::MetadataExt;
        return meta.uid().to_string();
    }

    for key in ["USER", "LOGNAME"] {
        if let Ok(val) = std::env::var(key) {
            let cleaned: String = val
                .chars()
                .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
                .collect();
            if !cleaned.is_empty() {
                return cleaned;
            }
        }
    }

    "user".to_string()
}

#[cfg(unix)]
fn ensure_control_dir() -> Option<std::path::PathBuf> {
    use std::os::unix::fs::DirBuilderExt;

    let dir = std::env::var_os("XDG_RUNTIME_DIR")
        .filter(|v| !v.is_empty())
        .map(std::path::PathBuf::from)
        .filter(|p| p.is_dir())
        .map(|p| p.join("linear-pulse"))
        .unwrap_or_else(|| {
            std::env::temp_dir().join(format!("linear-pulse-{}", current_user_suffix()))
        });

    std::fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(&dir)
        .ok()?;

    // Unix socket paths are capped near 104 bytes; ssh adds "/lp-" + 40 hex chars and a
    // 17-char temp suffix while creating the socket. Too long and ssh refuses to run at all.
    if dir.as_os_str().len() > 40 {
        return None;
    }

    let meta = std::fs::symlink_metadata(&dir).ok()?;
    if meta.file_type().is_symlink() || !meta.is_dir() {
        return None;
    }

    Some(dir)
}

/// Build base OpenSSH options shared across devsession and rerank commands,
/// enabling ControlMaster connection multiplexing on Unix when the socket directory is ready.
pub fn ssh_base_args() -> Vec<String> {
    let mut args = vec![
        "-o".to_string(),
        "BatchMode=yes".to_string(),
        "-o".to_string(),
        "StrictHostKeyChecking=accept-new".to_string(),
        "-o".to_string(),
        "ConnectTimeout=15".to_string(),
        // Notice a dead shared connection within ~45s instead of hanging on it.
        "-o".to_string(),
        "ServerAliveInterval=15".to_string(),
        "-o".to_string(),
        "ServerAliveCountMax=3".to_string(),
    ];

    #[cfg(unix)]
    if let Some(dir) = ensure_control_dir() {
        let control_path = dir.join("lp-%C");
        args.push("-o".to_string());
        args.push("ControlMaster=auto".to_string());
        args.push("-o".to_string());
        args.push("ControlPersist=300".to_string());
        args.push("-o".to_string());
        args.push(format!("ControlPath={}", control_path.to_string_lossy()));
    }

    args
}

/// Return true if `err` indicates a transient SSH connection/multiplexer failure before remote execution.
pub fn is_transient_ssh_error(err: &str) -> bool {
    let lower = err.to_ascii_lowercase();
    TRANSIENT_SSH_ERROR_PATTERNS
        .iter()
        .any(|pat| lower.contains(pat))
}

/// Run a command over SSH, retrying transient connection failures up to 3 attempts total.
pub async fn run_ssh(
    target: &str,
    remote_cmd: &str,
    timeout: Duration,
) -> Result<(String, String), String> {
    let max_attempts = SSH_RETRY_DELAYS_SECS.len() + 1;
    for attempt in 1..=max_attempts {
        match run_ssh_once(target, remote_cmd, timeout).await {
            Ok(output) => return Ok(output),
            Err(err) => {
                if attempt < max_attempts && is_transient_ssh_error(&err) {
                    tokio::time::sleep(Duration::from_secs(SSH_RETRY_DELAYS_SECS[attempt - 1]))
                        .await;
                    continue;
                }
                if attempt > 1 {
                    return Err(format!("{err} (after {attempt} attempts)"));
                }
                return Err(err);
            }
        }
    }
    unreachable!()
}

async fn run_ssh_once(
    target: &str,
    remote_cmd: &str,
    timeout: Duration,
) -> Result<(String, String), String> {
    let mut cmd = tokio::process::Command::new("ssh");
    cmd.args(ssh_base_args())
        .arg(target)
        .arg(remote_cmd)
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

/// Probe the server launcher's heartbeat and optional session id in a single SSH command.
pub async fn launcher_status(settings: &BridgeSettings) -> Result<LauncherStatus, String> {
    let target = resolve_ssh_target(settings)?;
    let cmd = "cat ~/.linear-pulse/launcher.heartbeat 2>/dev/null || echo 0; date +%s; cat ~/.linear-pulse/launcher.session 2>/dev/null || true";
    let (stdout, _stderr) = run_ssh(&target, cmd, Duration::from_secs(CONTROL_TIMEOUT_SECS)).await?;
    Ok(parse_launcher_status(&stdout))
}

fn mark_dev_session_failed(db: &Arc<Mutex<Connection>>, session_id: &str, err: &str) {
    if let Ok(conn) = db.lock() {
        let _ = db::update_dev_session_status(&conn, session_id, "failed", None, None, Some(err));
    }
}

fn apply_launch_result(
    conn: &Connection,
    session_id: &str,
    result: &LaunchResult,
) -> rusqlite::Result<()> {
    if result.ok {
        if let Some(ref remote_id) = result.remote_session_id {
            db::set_dev_session_launch(conn, session_id, "launcher", Some(remote_id))?;
            db::update_dev_session_status(conn, session_id, "running", None, None, None)?;
        } else {
            db::update_dev_session_status(
                conn,
                session_id,
                "failed",
                None,
                None,
                Some("Launcher succeeded without returning remote_session_id"),
            )?;
        }
    } else {
        let err = result
            .error
            .as_deref()
            .filter(|s| !s.is_empty())
            .unwrap_or("Launcher failed to start session");
        db::update_dev_session_status(conn, session_id, "failed", None, None, Some(err))?;
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
async fn start_via_launcher(
    db: &Arc<Mutex<Connection>>,
    notify: &Notify,
    settings: &BridgeSettings,
    target: &str,
    view: &DevSessionView,
    clean_name: &str,
    prompt_items: &[(String, String)],
    model: &str,
    effort: &str,
) {
    let session_id = &view.session.id;
    let request_id = format!("{session_id}-start");
    if !is_valid_request_id(&request_id) {
        mark_dev_session_failed(db, session_id, &format!("Invalid dev session id: '{session_id}'"));
        (notify)("dev-sessions-changed");
        return;
    }

    let env_id = if settings.dev_environment_id.trim().is_empty() {
        DEFAULT_DEV_ENVIRONMENT_ID
    } else {
        settings.dev_environment_id.trim()
    };
    let model_full = full_model_id(model);
    let prompt = build_dev_prompt(
        session_id,
        clean_name,
        &view.session.note,
        &view.session.delivery,
        prompt_items,
        &SplitHow::Full {
            environment_id: env_id.to_string(),
            model: model_full.clone(),
            effort: effort.to_string(),
        },
    );
    let request_json = build_start_request(
        session_id,
        clean_name,
        env_id,
        &model_full,
        effort,
        &prompt,
    );
    let write_cmd = build_write_request_cmd(&request_id, &request_json);

    if let Err(err) = run_ssh(target, &write_cmd, Duration::from_secs(CONTROL_TIMEOUT_SECS)).await {
        mark_dev_session_failed(db, session_id, &err);
        (notify)("dev-sessions-changed");
        return;
    }

    if let Ok(conn) = db.lock() {
        let _ = db::set_dev_session_launch(&conn, session_id, "launcher", None);
    }
    (notify)("dev-sessions-changed");

    let wait_cmd = build_wait_result_cmd(&request_id, LAUNCHER_WAIT_MAX_SECS);
    match run_ssh(
        target,
        &wait_cmd,
        Duration::from_secs(LAUNCHER_WAIT_SSH_TIMEOUT_SECS),
    )
    .await
    {
        Ok((stdout, _stderr)) => {
            if let Some(res) = parse_result(&stdout) {
                if let Ok(conn) = db.lock() {
                    let _ = apply_launch_result(&conn, session_id, &res);
                }
            }
        }
        // The request is already written, so the launcher may still start the session.
        // Leave it `starting`; refresh reads the result file later.
        Err(_) => {}
    }

    (notify)("dev-sessions-changed");
}

/// Start a Claude Code dev session via the launcher (when configured & online) or over SSH.
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
            mark_dev_session_failed(&db, &session_id, &e.to_string());
            (notify)("dev-sessions-changed");
            return;
        }
    };

    let target = match resolve_ssh_target(&settings) {
        Ok(t) => t,
        Err(err) => {
            mark_dev_session_failed(&db, &session_id, &err);
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

    let model = match validate_model(view.session.model.as_deref().unwrap_or("")) {
        Ok(m) => m,
        Err(err) => {
            mark_dev_session_failed(&db, &session_id, &err);
            (notify)("dev-sessions-changed");
            return;
        }
    };
    let effort = match validate_effort(view.session.effort.as_deref().unwrap_or("")) {
        Ok(e) => e,
        Err(err) => {
            mark_dev_session_failed(&db, &session_id, &err);
            (notify)("dev-sessions-changed");
            return;
        }
    };

    let launcher_offline_note = if settings.dev_launch_mode == "launcher" {
        match launcher_status(&settings).await {
            Ok(status) if status.online => {
                start_via_launcher(
                    &db,
                    &notify,
                    &settings,
                    &target,
                    &view,
                    &clean_name,
                    &prompt_items,
                    &model,
                    &effort,
                )
                .await;
                return;
            }
            Ok(_) => Some("launcher offline"),
            Err(err) => {
                mark_dev_session_failed(
                    &db,
                    &session_id,
                    &format!("Couldn't reach the server to check the launcher: {err}"),
                );
                (notify)("dev-sessions-changed");
                return;
            }
        }
    } else {
        None
    };

    if let Ok(conn) = db.lock() {
        let _ = db::set_dev_session_launch(&conn, &session_id, "ssh", None);
    }

    let template = if settings.dev_command.trim().is_empty() {
        DEFAULT_DEV_COMMAND
    } else {
        settings.dev_command.trim()
    };
    let mut split_flags: Vec<String> = Vec::new();
    if !model.is_empty() {
        split_flags.push(format!("--model {model}"));
    }
    if !effort.is_empty() {
        split_flags.push(format!("--effort {effort}"));
    }
    let prompt = build_dev_prompt(
        &view.session.id,
        &clean_name,
        &view.session.note,
        &view.session.delivery,
        &prompt_items,
        &SplitHow::Cli {
            model_flags: split_flags.join(" "),
        },
    );

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
                        launcher_offline_note,
                        None,
                    );
                }
            } else {
                let preview: String = stdout.trim().chars().take(300).collect();
                let err = format!("Couldn't find the session id in: {preview}");
                mark_dev_session_failed(&db, &session_id, &err);
            }
        }
        Err(err) => {
            mark_dev_session_failed(&db, &session_id, &err);
        }
    }

    (notify)("dev-sessions-changed");
}

struct AutoFinishTarget {
    session_id: String,
    remote_id: Option<String>,
    done_issue_ids: Vec<String>,
}

/// Build the SSH command that writes a launcher stop request file for `id` / `remote_id`.
pub fn build_launcher_stop_cmd(id: &str, remote_id: &str) -> Result<String, String> {
    let request_id = format!("{id}-stop");
    if !is_valid_request_id(&request_id) {
        return Err(format!("Invalid dev session id: '{id}'"));
    }
    let json = build_stop_request(id, remote_id);
    Ok(build_write_request_cmd(&request_id, &json))
}

async fn write_launcher_stop_request(
    target: &str,
    id: &str,
    remote_id: &str,
) -> Result<(), String> {
    let cmd = build_launcher_stop_cmd(id, remote_id)?;
    run_ssh(target, &cmd, Duration::from_secs(CONTROL_TIMEOUT_SECS)).await?;
    Ok(())
}

fn finish_session_in_db(
    conn: &mut Connection,
    session_id: &str,
    done_issue_ids: &[String],
) -> rusqlite::Result<()> {
    db::update_dev_session_status(conn, session_id, "finished", None, None, None)?;
    for issue_id in done_issue_ids {
        db::remove_from_backlog(conn, issue_id)?;
    }
    Ok(())
}

fn is_grace_elapsed(
    all_done_at: &str,
    now: chrono::DateTime<chrono::Utc>,
    grace_secs: i64,
) -> bool {
    let Ok(done_dt) = chrono::DateTime::parse_from_rfc3339(all_done_at) else {
        return false;
    };
    now >= done_dt.with_timezone(&chrono::Utc) + chrono::Duration::seconds(grace_secs)
}

/// Build a single batched SSH command to run `lp-worktree-cleanup` for validated `(id, remote_id)` pairs.
pub fn build_batch_cleanup_cmd(sessions: &[(String, String)]) -> String {
    let mut parts = Vec::with_capacity(sessions.len());
    for (sid, rid) in sessions {
        assert!(
            is_valid_request_id(&format!("{sid}-stop")),
            "invalid session id"
        );
        assert!(is_valid_claude_session_id(rid), "invalid remote_session_id");
        parts.push(format!(
            "printf '__LP_S__:{sid}\\n'; ~/.local/bin/lp-worktree-cleanup {rid} --archived || true; printf '\\n__LP_E__\\n'"
        ));
    }
    parts.join("; ")
}

/// Parse batched cleanup output, returning `(session_id, first_trimmed_line)` pairs.
pub fn parse_batch_cleanup_output(stdout: &str) -> Vec<(String, String)> {
    let mut results = Vec::new();
    let mut current_sid: Option<String> = None;
    let mut first_line: Option<String> = None;

    for raw_line in stdout.lines() {
        let line = raw_line.trim();
        if let Some(sid) = line.strip_prefix("__LP_S__:") {
            current_sid = Some(sid.trim().to_string());
            first_line = None;
        } else if line == "__LP_E__" {
            if let (Some(sid), Some(status)) = (current_sid.take(), first_line.take()) {
                results.push((sid, status));
            }
            current_sid = None;
            first_line = None;
        } else if current_sid.is_some() && first_line.is_none() && !line.is_empty() {
            first_line = Some(line.to_string());
        }
    }
    results
}

/// Sync starting launcher sessions, auto-finish completed launcher sessions, clean up worktrees,
/// and sync running SSH `claude agents` statuses over SSH.
pub async fn refresh_dev_sessions(
    db: Arc<Mutex<Connection>>,
    settings: BridgeSettings,
) -> Result<(), String> {
    refresh_dev_sessions_checked(db, settings).await.map(|_| ())
}

/// Same as `refresh_dev_sessions`, returning `true` if any backlog items were removed.
pub async fn refresh_dev_sessions_checked(
    db: Arc<Mutex<Connection>>,
    settings: BridgeSettings,
) -> Result<bool, String> {
    let now = chrono::Utc::now();
    let now_str = now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true);

    let (starting_launcher_ids, has_running_ssh, to_auto_finish, awaiting_cleanup) = {
        let conn = db.lock().map_err(|e| e.to_string())?;
        let sessions = db::list_dev_sessions(&conn, 100).map_err(|e| e.to_string())?;
        let mut starting = Vec::new();
        let mut running_ssh = false;
        let mut auto_finish = Vec::new();
        let mut cleanup = Vec::new();

        for view in sessions {
            let is_launcher = view.session.launch_mode.as_deref() == Some("launcher");
            if is_launcher && view.session.status == "starting" {
                let rid = format!("{}-start", view.session.id);
                if is_valid_request_id(&rid) {
                    starting.push(view.session.id);
                }
            } else if is_launcher && view.session.status == "running" {
                if db::session_view_all_done(&view.items) {
                    if let Some(ref done_at) = view.session.all_done_at {
                        if !view.session.keep_open
                            && is_grace_elapsed(done_at, now, AUTO_FINISH_GRACE_SECS)
                        {
                            let done_issue_ids = view
                                .items
                                .iter()
                                .filter(|i| i.status == "done")
                                .map(|i| i.issue_id.clone())
                                .collect();
                            auto_finish.push(AutoFinishTarget {
                                session_id: view.session.id,
                                remote_id: view.session.remote_session_id,
                                done_issue_ids,
                            });
                        }
                    } else {
                        db::set_dev_session_all_done_at(&conn, &view.session.id, Some(&now_str))
                            .map_err(|e| e.to_string())?;
                    }
                } else if view.session.all_done_at.is_some() {
                    db::set_dev_session_all_done_at(&conn, &view.session.id, None)
                        .map_err(|e| e.to_string())?;
                }
            } else if is_launcher
                && matches!(view.session.status.as_str(), "finished" | "stopped")
                && matches!(view.session.cleanup_status.as_deref(), None | Some("BUSY"))
            {
                if let Some(ref remote_id) = view.session.remote_session_id {
                    if is_valid_claude_session_id(remote_id)
                        && is_valid_request_id(&format!("{}-stop", view.session.id))
                    {
                        cleanup.push((view.session.id, remote_id.clone()));
                    }
                }
            } else if !is_launcher
                && view.session.status == "running"
                && view.session.bg_id.is_some()
            {
                running_ssh = true;
            }
        }
        (starting, running_ssh, auto_finish, cleanup)
    };

    if starting_launcher_ids.is_empty()
        && !has_running_ssh
        && to_auto_finish.is_empty()
        && awaiting_cleanup.is_empty()
    {
        return Ok(false);
    }

    let target = resolve_ssh_target(&settings)?;
    let mut backlog_changed = false;

    if !starting_launcher_ids.is_empty() {
        let files: Vec<String> = starting_launcher_ids
            .iter()
            .map(|sid| format!("~/.linear-pulse/results/{sid}-start.json"))
            .collect();
        let cmd = format!("cat {} 2>/dev/null || true", files.join(" "));
        let (stdout, _stderr) =
            run_ssh(&target, &cmd, Duration::from_secs(CONTROL_TIMEOUT_SECS)).await?;

        let mut updates: Vec<(String, LaunchResult)> = Vec::new();
        for parsed in serde_json::Deserializer::from_str(&stdout).into_iter::<Value>() {
            if let Ok(val) = parsed {
                if let Some(sid) = val
                    .get("id")
                    .and_then(|v| v.as_str())
                    .and_then(|s| s.strip_suffix("-start"))
                    .filter(|sid| starting_launcher_ids.iter().any(|x| x == sid))
                {
                    updates.push((sid.to_string(), launch_result_from_value(&val)));
                }
            }
        }

        if !updates.is_empty() {
            let conn = db.lock().map_err(|e| e.to_string())?;
            for (sid, res) in &updates {
                apply_launch_result(&conn, sid, res).map_err(|e| e.to_string())?;
            }
        }
    }

    if has_running_ssh {
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
            if view.session.launch_mode.as_deref() == Some("launcher") {
                continue;
            }
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
    }

    for item in to_auto_finish {
        if let Some(ref remote_id) = item.remote_id {
            write_launcher_stop_request(&target, &item.session_id, remote_id).await?;
        }
        let mut conn = db.lock().map_err(|e| e.to_string())?;
        finish_session_in_db(&mut conn, &item.session_id, &item.done_issue_ids)
            .map_err(|e| e.to_string())?;
        backlog_changed = true;
    }

    if !awaiting_cleanup.is_empty() {
        let stop_files: Vec<String> = awaiting_cleanup
            .iter()
            .map(|(sid, _)| format!("~/.linear-pulse/results/{sid}-stop.json"))
            .collect();
        let stop_cmd = format!("cat {} 2>/dev/null || true", stop_files.join(" "));
        let (stop_stdout, _stderr) =
            run_ssh(&target, &stop_cmd, Duration::from_secs(CONTROL_TIMEOUT_SECS)).await?;

        let mut stopped_ok = std::collections::HashSet::new();
        for parsed in serde_json::Deserializer::from_str(&stop_stdout).into_iter::<Value>() {
            if let Ok(val) = parsed {
                if let Some(sid) = val
                    .get("id")
                    .and_then(|v| v.as_str())
                    .and_then(|s| s.strip_suffix("-stop"))
                {
                    if launch_result_from_value(&val).ok {
                        stopped_ok.insert(sid.to_string());
                    }
                }
            }
        }

        let ready_for_cleanup: Vec<(String, String)> = awaiting_cleanup
            .into_iter()
            .filter(|(sid, _)| stopped_ok.contains(sid))
            .collect();

        if !ready_for_cleanup.is_empty() {
            let cleanup_cmd = build_batch_cleanup_cmd(&ready_for_cleanup);
            // Each cleanup may stop leftover processes and fetch from git: allow time per session.
            let cleanup_secs = (CONTROL_TIMEOUT_SECS + 30 * ready_for_cleanup.len() as u64).min(600);
            let (cleanup_stdout, _stderr) = run_ssh(
                &target,
                &cleanup_cmd,
                Duration::from_secs(cleanup_secs),
            )
            .await?;
            let outcomes = parse_batch_cleanup_output(&cleanup_stdout);
            if !outcomes.is_empty() {
                let conn = db.lock().map_err(|e| e.to_string())?;
                for (sid, status) in outcomes {
                    db::set_dev_session_cleanup_status(&conn, &sid, Some(&status))
                        .map_err(|e| e.to_string())?;
                }
            }
        }
    }

    Ok(backlog_changed)
}

/// Finish a launcher dev session now: write the stop request, mark it `finished`,
/// and remove its done items from the backlog.
pub async fn finish_dev_session_now(
    db: Arc<Mutex<Connection>>,
    settings: BridgeSettings,
    id: String,
) -> Result<(), String> {
    let (session, done_issue_ids) = {
        let conn = db.lock().map_err(|e| e.to_string())?;
        let view = db::load_dev_session(&conn, &id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Dev session '{id}' not found."))?;
        let done_ids: Vec<String> = view
            .items
            .iter()
            .filter(|i| i.status == "done")
            .map(|i| i.issue_id.clone())
            .collect();
        (view.session, done_ids)
    };

    if session.launch_mode.as_deref() != Some("launcher") {
        return Err("Only launcher dev sessions can be finished now.".to_string());
    }

    if let Some(ref remote_id) = session.remote_session_id {
        let target = resolve_ssh_target(&settings)?;
        write_launcher_stop_request(&target, &id, remote_id).await?;
    }

    let mut conn = db.lock().map_err(|e| e.to_string())?;
    finish_session_in_db(&mut conn, &id, &done_issue_ids).map_err(|e| e.to_string())?;
    Ok(())
}

/// Stop a running or starting dev session on the server and mark it `stopped`.
pub async fn stop_dev_session(
    db: Arc<Mutex<Connection>>,
    settings: BridgeSettings,
    id: String,
) -> Result<(), String> {
    let session = {
        let conn = db.lock().map_err(|e| e.to_string())?;
        db::load_dev_session(&conn, &id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Dev session '{id}' not found."))?
            .session
    };

    if session.launch_mode.as_deref() == Some("launcher") {
        if let Some(ref remote_id) = session.remote_session_id {
            let target = resolve_ssh_target(&settings)?;
            write_launcher_stop_request(&target, &id, remote_id).await?;
        } else if session.status == "starting" {
            let request_id = format!("{id}-start");
            if !is_valid_request_id(&request_id) {
                return Err(format!("Invalid dev session id: '{id}'"));
            }
            let target = resolve_ssh_target(&settings)?;
            let cmd = format!("rm -f ~/.linear-pulse/requests/{request_id}.json");
            run_ssh(&target, &cmd, Duration::from_secs(CONTROL_TIMEOUT_SECS)).await?;
        }
    } else if let Some(ref bg_id) = session.bg_id {
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

/// Best-effort notification to a running launcher dev session when issues are added or removed.
pub async fn notify_session_queue_change(
    db: Arc<Mutex<Connection>>,
    settings: BridgeSettings,
    session_id: String,
    added_issue_ids: Vec<String>,
    removed_issue_ids: Vec<String>,
) {
    let view = {
        let Ok(conn) = db.lock() else {
            return;
        };
        match db::load_dev_session(&conn, &session_id) {
            Ok(Some(v)) => v,
            Ok(None) => return,
            Err(err) => {
                eprintln!("[devsession] failed to load session {session_id} for queue notify: {err}");
                return;
            }
        }
    };

    if view.session.launch_mode.as_deref() != Some("launcher") || view.session.status != "running" {
        return;
    }
    let Some(remote_session_id) = view.session.remote_session_id.clone() else {
        return;
    };
    if !is_valid_claude_session_id(&remote_session_id) {
        return;
    }

    let message = {
        let by_id: HashMap<&str, (String, String)> = view
            .items
            .iter()
            .map(|i| {
                (
                    i.issue_id.as_str(),
                    (
                        i.identifier.clone().unwrap_or_else(|| i.issue_id.clone()),
                        i.title.clone().unwrap_or_default(),
                    ),
                )
            })
            .collect();
        let map_ids = |ids: &[String]| -> Vec<(String, String)> {
            ids.iter()
                .map(|id| {
                    by_id
                        .get(id.as_str())
                        .cloned()
                        .unwrap_or_else(|| (id.clone(), String::new()))
                })
                .collect()
        };
        let added = map_ids(&added_issue_ids);
        let removed = map_ids(&removed_issue_ids);
        match build_queue_change_message(&view.session.name, &added, &removed) {
            Some(m) => m,
            None => return,
        }
    };

    let mut suffix = db::generate_token();
    suffix.truncate(8);
    let request_id = format!("{}-notify-{suffix}", view.session.id);
    if !is_valid_request_id(&request_id) {
        return;
    }

    let target = match resolve_ssh_target(&settings) {
        Ok(t) => t,
        Err(err) => {
            eprintln!("[devsession] queue notify skipped for {}: {err}", view.session.id);
            return;
        }
    };
    let request_json = build_notify_request(
        &request_id,
        &view.session.id,
        &remote_session_id,
        &message,
    );
    let write_cmd = build_write_request_cmd(&request_id, &request_json);
    if let Err(err) = run_ssh(&target, &write_cmd, Duration::from_secs(CONTROL_TIMEOUT_SECS)).await
    {
        eprintln!("[devsession] failed to write queue notify request {request_id}: {err}");
    }
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

    #[test]
    fn test_validate_environment_id() {
        assert_eq!(
            validate_environment_id("  ").unwrap(),
            DEFAULT_DEV_ENVIRONMENT_ID
        );
        assert_eq!(
            validate_environment_id("env_01D4f9186hqvLzMnvpSk5Xz5").unwrap(),
            "env_01D4f9186hqvLzMnvpSk5Xz5"
        );
        assert_eq!(
            validate_environment_id("ccpool_Abc123").unwrap(),
            "ccpool_Abc123"
        );
        assert!(validate_environment_id("env_short").is_err());
        assert!(validate_environment_id("other_123456").is_err());
        assert!(validate_environment_id("env_123456;rm").is_err());
    }

    #[test]
    fn test_full_model_id() {
        assert_eq!(full_model_id("opus"), "claude-opus-5-5");
        assert_eq!(full_model_id("OPUS"), "claude-opus-5-5");
        assert_eq!(full_model_id("Sonnet"), "claude-sonnet-5-5");
        assert_eq!(full_model_id("fable"), "claude-fable-5-2");
        assert_eq!(full_model_id("HAIKU"), "claude-haiku-5-5");
        assert_eq!(full_model_id("claude-opus-4-6"), "claude-opus-4-6");
        assert_eq!(full_model_id(""), "");
    }

    #[test]
    fn test_is_valid_request_id() {
        assert!(is_valid_request_id("0123456789abcdef-start"));
        assert!(is_valid_request_id("deadbeefcafebabe-stop"));
        assert!(is_valid_request_id("0123456789abcdef-notify-deadbeef"));
        assert!(!is_valid_request_id("../x-start"));
        assert!(!is_valid_request_id("abc-start"));
        assert!(!is_valid_request_id("0123456789abcdef-start;rm"));
        assert!(!is_valid_request_id("0123456789ABCDEF-start"));
        assert!(!is_valid_request_id("0123456789abcdef-other"));
        assert!(!is_valid_request_id("0123456789abcdef-notify-1234567"));
        assert!(!is_valid_request_id("0123456789abcdef-notify-123456789"));
        assert!(!is_valid_request_id("0123456789abcdef-notify-DEADBEEF"));
        assert!(!is_valid_request_id("0123456789ABCDEF-notify-deadbeef"));
        assert!(!is_valid_request_id("0123456789abcdef-notify-"));
        assert!(!is_valid_request_id("0123456789abcdef-notify"));
    }

    fn base64_decode_for_test(input: &str) -> Vec<u8> {
        let val = |b: u8| -> Option<u32> {
            match b {
                b'A'..=b'Z' => Some((b - b'A') as u32),
                b'a'..=b'z' => Some((b - b'a' + 26) as u32),
                b'0'..=b'9' => Some((b - b'0' + 52) as u32),
                b'+' => Some(62),
                b'/' => Some(63),
                _ => None,
            }
        };
        let bytes = input.as_bytes();
        let mut out = Vec::new();
        for chunk in bytes.chunks(4) {
            if chunk.len() < 4 {
                break;
            }
            let c0 = val(chunk[0]).unwrap();
            let c1 = val(chunk[1]).unwrap();
            let pad2 = chunk[2] == b'=';
            let pad3 = chunk[3] == b'=';
            let c2 = if pad2 { 0 } else { val(chunk[2]).unwrap() };
            let c3 = if pad3 { 0 } else { val(chunk[3]).unwrap() };
            let n = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
            out.push(((n >> 16) & 0xff) as u8);
            if !pad2 {
                out.push(((n >> 8) & 0xff) as u8);
            }
            if !pad3 {
                out.push((n & 0xff) as u8);
            }
        }
        out
    }

    #[test]
    fn test_build_write_request_cmd_roundtrip_and_no_raw_json() {
        let sid = "0123456789abcdef";
        let rid = format!("{sid}-start");
        let json = build_start_request(
            sid,
            "KAR-1's $(danger); rm -rf /",
            "env_01D4f9186hqvLzMnvpSk5Xz5",
            "claude-opus-5-5",
            "high",
            "prompt with 'quotes' and \"json\"",
        );
        let cmd = build_write_request_cmd(&rid, &json);
        assert!(!cmd.contains("KAR-1"));
        assert!(!cmd.contains("claude-opus-5-5"));
        assert!(!cmd.contains("danger"));
        assert!(!cmd.contains('{'));
        assert!(cmd.contains(&format!(".{rid}.tmp")));
        assert!(cmd.contains(&format!("{rid}.json")));

        let prefix = "printf %s '";
        let start = cmd.find(prefix).unwrap() + prefix.len();
        let end = start + cmd[start..].find('\'').unwrap();
        let b64 = &cmd[start..end];
        let decoded = String::from_utf8(base64_decode_for_test(b64)).unwrap();
        assert_eq!(decoded, json);
    }

    #[test]
    fn test_build_stop_request_and_wait_cmd() {
        let json = build_stop_request("0123456789abcdef", "session_AbCdEf123456");
        let parsed: Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["id"], "0123456789abcdef-stop");
        assert_eq!(parsed["kind"], "stop");
        assert_eq!(parsed["dev_session_id"], "0123456789abcdef");
        assert_eq!(parsed["remote_session_id"], "session_AbCdEf123456");

        let wait_cmd = build_wait_result_cmd("0123456789abcdef-start", 120);
        assert!(wait_cmd.contains("0123456789abcdef-start.json"));
        assert!(wait_cmd.contains("sleep 3"));
        assert!(wait_cmd.contains("PENDING"));
    }

    #[test]
    fn test_build_notify_request() {
        let json = build_notify_request(
            "0123456789abcdef-notify-deadbeef",
            "0123456789abcdef",
            "session_AbCdEf123456",
            "hello queue",
        );
        let parsed: Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["id"], "0123456789abcdef-notify-deadbeef");
        assert_eq!(parsed["kind"], "notify");
        assert_eq!(parsed["dev_session_id"], "0123456789abcdef");
        assert_eq!(parsed["remote_session_id"], "session_AbCdEf123456");
        assert_eq!(parsed["message"], "hello queue");
    }

    #[test]
    fn test_build_queue_change_message() {
        assert_eq!(build_queue_change_message("Sprint", &[], &[]), None);

        let added_only = build_queue_change_message(
            "Sprint",
            &[
                ("KAR-918".to_string(), "Fix login".to_string()),
                ("KAR-1".to_string(), "   ".to_string()),
            ],
            &[],
        )
        .unwrap();
        assert_eq!(
            added_only,
            "From James's Linear Pulse app: your queue for \"Sprint\" changed. Added: KAR-918 (Fix login), KAR-1. Call get_session_queue to see the full queue, then work the new tickets like the others (respect blockers: a ticket that blocks one you are on comes first) and report progress with update_session_item."
        );

        let removed_only = build_queue_change_message(
            "Sprint",
            &[],
            &[("KAR-2".to_string(), "  Old task  ".to_string())],
        )
        .unwrap();
        assert_eq!(
            removed_only,
            "From James's Linear Pulse app: your queue for \"Sprint\" changed. Removed: KAR-2 (Old task). Stop working on removed tickets; don't report on them."
        );

        let both = build_queue_change_message(
            "Sprint",
            &[("KAR-918".to_string(), "New one".to_string())],
            &[("KAR-2".to_string(), String::new())],
        )
        .unwrap();
        assert_eq!(
            both,
            "From James's Linear Pulse app: your queue for \"Sprint\" changed. Added: KAR-918 (New one). Call get_session_queue to see the full queue, then work the new tickets like the others (respect blockers: a ticket that blocks one you are on comes first) and report progress with update_session_item. Removed: KAR-2. Stop working on removed tickets; don't report on them."
        );

        let exact_120 = "a".repeat(120);
        let msg_exact = build_queue_change_message(
            "Sprint",
            &[("KAR-3".to_string(), format!("  {exact_120}  "))],
            &[],
        )
        .unwrap();
        assert!(msg_exact.contains(&format!("KAR-3 ({exact_120}).")));
        assert!(!msg_exact.contains('…'));

        let over_120 = format!("{}xyz", "b".repeat(120));
        let msg_trunc = build_queue_change_message(
            "Sprint",
            &[("KAR-4".to_string(), over_120)],
            &[],
        )
        .unwrap();
        let expected_short = format!("{}…", "b".repeat(120));
        assert!(msg_trunc.contains(&format!("KAR-4 ({expected_short}).")));
        assert!(!msg_trunc.contains("xyz"));
    }

    #[test]
    fn test_parse_result() {
        let ok = parse_result(
            "{\n  \"id\": \"0123456789abcdef-start\",\n  \"ok\": true,\n  \"remote_session_id\": \"session_AbCdEf123456\",\n  \"at\": 1700000000\n}\n",
        )
        .unwrap();
        assert!(ok.ok);
        assert_eq!(
            ok.remote_session_id.as_deref(),
            Some("session_AbCdEf123456")
        );
        assert_eq!(ok.error, None);

        let err = parse_result(
            "{\n  \"id\": \"0123456789abcdef-start\",\n  \"ok\": false,\n  \"error\": \"boom\",\n  \"at\": 1700000000\n}\n",
        )
        .unwrap();
        assert!(!err.ok);
        assert_eq!(err.remote_session_id, None);
        assert_eq!(err.error.as_deref(), Some("boom"));

        assert_eq!(parse_result("PENDING\n"), None);
        assert_eq!(parse_result("   \n"), None);
    }

    #[test]
    fn test_parse_launcher_status() {
        let online = parse_launcher_status("1700000000\n1700000120\nsession_AbCdEf123456\n");
        assert!(online.online);
        assert_eq!(online.heartbeat_age_secs, Some(120));
        assert_eq!(
            online.launcher_session_id.as_deref(),
            Some("session_AbCdEf123456")
        );

        let stale = parse_launcher_status("1700000000\n1700000301\nsession_AbCdEf123456\n");
        assert!(!stale.online);
        assert_eq!(stale.heartbeat_age_secs, Some(301));
        assert_eq!(
            stale.launcher_session_id.as_deref(),
            Some("session_AbCdEf123456")
        );

        let missing = parse_launcher_status("0\n1700000301\n");
        assert!(!missing.online);
        assert_eq!(missing.heartbeat_age_secs, None);
        assert_eq!(missing.launcher_session_id, None);

        let bad_sid = parse_launcher_status("1700000000\n1700000010\nsession_bad;rm\n");
        assert!(bad_sid.online);
        assert_eq!(bad_sid.launcher_session_id, None);

        let short_sid = parse_launcher_status("1700000000\n1700000010\nsession_short\n");
        assert_eq!(short_sid.launcher_session_id, None);
    }

    #[test]
    fn test_build_dev_prompt_variants() {
        let items = vec![("KAR-1".to_string(), "Fix bug".to_string())];

        let full = build_dev_prompt(
            "0123456789abcdef",
            "KAR-1",
            "",
            "per_issue",
            &items,
            &SplitHow::Full {
                environment_id: "env_01D4f9186hqvLzMnvpSk5Xz5".to_string(),
                model: "claude-opus-5-5".to_string(),
                effort: "high".to_string(),
            },
        );
        assert!(full.contains("create_session"));
        assert!(full.contains("subscribe_pr_activity"));
        assert!(full.contains("add_repo"));
        assert!(full.contains("environment_id \"env_01D4f9186hqvLzMnvpSk5Xz5\""));
        assert!(full.contains("model \"claude-opus-5-5\""));
        assert!(full.contains("effort \"high\""));
        assert!(!full.contains("claude --bg"));

        let full_empty_model_effort = build_dev_prompt(
            "0123456789abcdef",
            "KAR-1",
            "",
            "per_issue",
            &items,
            &SplitHow::Full {
                environment_id: "env_01D4f9186hqvLzMnvpSk5Xz5".to_string(),
                model: String::new(),
                effort: String::new(),
            },
        );
        assert!(!full_empty_model_effort.contains("model \""));
        assert!(!full_empty_model_effort.contains("effort \""));

        let cli = build_dev_prompt(
            "0123456789abcdef",
            "KAR-1",
            "",
            "per_issue",
            &items,
            &SplitHow::Cli {
                model_flags: "--model opus --effort high".to_string(),
            },
        );
        assert!(cli.contains("claude --bg"));
        assert!(cli.contains("--model opus --effort high"));
    }

    #[test]
    fn test_build_launcher_stop_cmd_and_grace() {
        let cmd = build_launcher_stop_cmd("0123456789abcdef", "session_AbCdEf123456").unwrap();
        assert!(cmd.contains("0123456789abcdef-stop.json"));
        assert!(build_launcher_stop_cmd("bad-id", "session_AbCdEf123456").is_err());

        let now = chrono::Utc::now();
        let recent = (now - chrono::Duration::seconds(AUTO_FINISH_GRACE_SECS - 10))
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let expired = (now - chrono::Duration::seconds(AUTO_FINISH_GRACE_SECS + 1))
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        assert!(!is_grace_elapsed(&recent, now, AUTO_FINISH_GRACE_SECS));
        assert!(is_grace_elapsed(&expired, now, AUTO_FINISH_GRACE_SECS));
        assert!(!is_grace_elapsed("not-a-timestamp", now, AUTO_FINISH_GRACE_SECS));
    }

    #[test]
    fn test_batch_cleanup_cmd_and_parser() {
        let cmd = build_batch_cleanup_cmd(&[
            (
                "0123456789abcdef".to_string(),
                "session_AbCdEf123456".to_string(),
            ),
            (
                "fedcba9876543210".to_string(),
                "session_ZyXwVu654321".to_string(),
            ),
        ]);
        assert!(cmd.contains("lp-worktree-cleanup session_AbCdEf123456"));
        assert!(cmd.contains("lp-worktree-cleanup session_ZyXwVu654321"));

        let stdout = "\
__LP_S__:0123456789abcdef
REMOVED
__LP_E__
__LP_S__:fedcba9876543210
KEPT dirty
extra line ignored
__LP_E__
__LP_S__:aaaaaaaaaaaaaaaa
__LP_E__
";
        let parsed = parse_batch_cleanup_output(stdout);
        assert_eq!(
            parsed,
            vec![
                ("0123456789abcdef".to_string(), "REMOVED".to_string()),
                ("fedcba9876543210".to_string(), "KEPT dirty".to_string()),
            ]
        );
    }

    #[tokio::test]
    async fn test_refresh_dev_sessions_sets_and_clears_all_done_at_without_ssh() {
        let conn = db::init_db(std::path::Path::new(":memory:")).expect("in-memory db");
        let session = db::DevSession {
            id: "0123456789abcdef".to_string(),
            name: "KAR-1".to_string(),
            slug: "lp-kar-1-abcd".to_string(),
            note: String::new(),
            delivery: "per_issue".to_string(),
            model: None,
            effort: None,
            launch_mode: Some("launcher".to_string()),
            remote_session_id: Some("session_AbCdEf123456".to_string()),
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
        db::insert_dev_session(&conn, &session, &["i1".to_string()]).unwrap();
        db::set_dev_session_item_status(&conn, &session.id, "i1", "done", None).unwrap();

        let db = Arc::new(Mutex::new(conn));
        let settings = BridgeSettings::default();

        // First refresh sets all_done_at without needing SSH.
        refresh_dev_sessions(Arc::clone(&db), settings.clone())
            .await
            .unwrap();
        {
            let c = db.lock().unwrap();
            let loaded = db::load_dev_session(&c, &session.id).unwrap().unwrap();
            assert!(loaded.session.all_done_at.is_some());
            assert_eq!(loaded.session.status, "running");

            // Adding a queued item clears all_done_at on next refresh.
            db::add_dev_session_items(&c, &session.id, &["i2".to_string()]).unwrap();
        }

        refresh_dev_sessions(Arc::clone(&db), settings)
            .await
            .unwrap();
        {
            let c = db.lock().unwrap();
            let loaded = db::load_dev_session(&c, &session.id).unwrap().unwrap();
            assert_eq!(loaded.session.all_done_at, None);
        }
    }

    #[test]
    fn test_ssh_base_args() {
        let args = ssh_base_args();
        assert!(args.windows(2).any(|w| w == ["-o", "BatchMode=yes"]));
        assert!(args
            .windows(2)
            .any(|w| w == ["-o", "StrictHostKeyChecking=accept-new"]));
        assert!(args.windows(2).any(|w| w == ["-o", "ConnectTimeout=15"]));

        #[cfg(unix)]
        {
            assert!(args.windows(2).any(|w| w == ["-o", "ControlMaster=auto"]));
            assert!(args.windows(2).any(|w| w == ["-o", "ControlPersist=300"]));
            let control_path_opt = args
                .windows(2)
                .find(|w| w[0] == "-o" && w[1].starts_with("ControlPath="))
                .expect("expected ControlPath option on unix");
            assert!(
                control_path_opt[1].ends_with("/lp-%C"),
                "unexpected ControlPath: {}",
                control_path_opt[1]
            );
        }
    }

    #[test]
    fn test_is_transient_ssh_error() {
        for err in [
            "ssh: connect to host example.com port 22: Connection refused",
            "Read from socket failed: Connection reset by peer",
            "ssh: connect to host 10.0.0.1 port 22: Connection timed out",
            "kex_exchange_identification: Connection closed by remote host",
            "Connection closed by 10.0.0.1 port 22",
            "ssh: connect to host example.com port 22: No route to host",
            "ssh: connect to host example.com port 22: Network is unreachable",
            "ssh: Could not resolve hostname example.com: Temporary failure in name resolution",
            "mux_client_request_session: session request failed: Session open refused by peer",
        ] {
            assert!(is_transient_ssh_error(err), "expected transient: {err}");
        }

        for err in [
            "Permission denied (publickey).",
            "bash: line 1: claude: command not found",
            "SSH exited with status exit status: 1",
            "SSH timed out after 30s",
            "",
        ] {
            assert!(!is_transient_ssh_error(err), "expected non-transient: {err}");
        }
    }
}
