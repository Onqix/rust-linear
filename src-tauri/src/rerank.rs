use crate::db::{self, BridgeSettings, DEFAULT_AGY_RERANK_COMMAND, DEFAULT_RERANK_COMMAND};
use crate::mcp::Notify;
use chrono::{SecondsFormat, Utc};
use rusqlite::Connection;
use serde_json::Value;
use std::process::{ExitStatus, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const RERANK_TIMEOUT_SECS: u64 = 15 * 60;
const MAX_PLAIN_STDOUT_CHARS: usize = 4000;
const MAX_ERROR_LINES: usize = 20;

/// How to rank the backlog. Shared by the Rerank button's prompt and the MCP
/// server's standing instructions, so every Claude session ranks the same way.
pub const RANKING_RULES: &[&str] = &[
    "Steps: call get_backlog, then get_changes_since_last_rank, then use list_issues / get_issue as needed for candidates or detail.",
    "You may add newly relevant open issues and remove ones that are done, canceled or no longer relevant.",
    "Rank in two passes. Pass 1, find batches: tickets that are cheaper to ship together in ONE development session than apart, because they touch the same code area, depend on each other, or are parts of one feature or fix. A batch has 2–5 tickets; most tickets stay single, so don't force a batch. Look at the issues themselves (get_issue) when titles alone don't show the overlap.",
    "Respect dependencies: get_backlog shows each item's `blocked_by` (Linear relations and earlier suggestions). Never rank a ticket above an open ticket that blocks it; a blocker and the ticket it blocks can be one batch when both fit one session. When an open blocker isn't in the backlog, add it if it is relevant. If the tickets themselves show an unrecorded dependency (one needs another's work first), put it in that item's `blocked_by` with a one-line reason; only when the text supports it, never guess.",
    "Also name themes: a theme is a broader initiative several tickets belong to (for example one stakeholder review or one product push), even when they are built in separate sessions. A theme holds batches and single tickets; every ticket of a batch has the batch's theme. Themes are optional; leave unrelated tickets without one.",
    "Pass 2, rank units: each batch is one unit, and each single ticket is a unit. Order the units with the most important and urgent work first. A batch ranks at least as high as its most important ticket, and may rank higher when doing its tickets together saves real work (shared context, one PR, one review). A batch's tickets are listed one after another at the batch's position, in the order they should be worked. Keep a theme's units near each other when that doesn't push more important work down.",
    "Write the full new order with ONE call to set_backlog: `group` (the batch name) on every batched item, a one-line reason per batch in `groups` saying why its tickets ship together, `theme` on every themed item, a one-line reason per theme in `themes`, `blocked_by` on any item with newly inferred dependencies, and a one-line `note` on every item explaining its position.",
    "Items with a non-null `dev_session` are being worked on by a Claude session right now: keep them in the backlog, keep each session's tickets together as one batch, and rank it by importance as usual. Never remove them.",
    "Do not change issue states or post comments during a rerank.",
];

/// Build the stdin prompt sent to headless Claude Code for a backlog rerank.
pub fn build_rerank_prompt(comment: &str) -> String {
    let mut parts = vec![
        "You are maintaining James's ranked Linear backlog in his Linear Pulse desktop app, via the `linear-pulse` MCP tools.".to_string(),
    ];
    parts.extend(RANKING_RULES.iter().map(|s| s.to_string()));

    let trimmed = comment.trim();
    if !trimmed.is_empty() {
        parts.push(format!(
            "James's instruction for this rerank (highest weight): {trimmed}"
        ));
    }

    parts.push(
        "Finish with a short summary (3–6 lines) of what moved and why. Plain text.".to_string(),
    );
    parts.join("\n\n")
}

/// Run headless Claude Code over SSH to rerank the backlog and persist the result.
pub async fn run_rerank(
    db: Arc<Mutex<Connection>>,
    notify: Notify,
    settings: BridgeSettings,
    run_id: String,
    comment: String,
) {
    let target = {
        let primary = settings.rerank_ssh_target.trim();
        if !primary.is_empty() {
            primary.to_string()
        } else {
            settings.ssh_target.trim().to_string()
        }
    };

    if target.is_empty() {
        finish_and_notify(
            &db,
            &notify,
            &run_id,
            "failed",
            None,
            Some("No SSH target configured. Set Rerank SSH Target or Tunnel SSH Target in Settings."),
        );
        return;
    }

    let remote_cmd = if settings.rerank_provider.trim() == "antigravity" {
        let trimmed = settings.agy_rerank_command.trim();
        if trimmed.is_empty() {
            DEFAULT_AGY_RERANK_COMMAND.to_string()
        } else {
            trimmed.to_string()
        }
    } else {
        let trimmed = settings.rerank_command.trim();
        if trimmed.is_empty() {
            DEFAULT_RERANK_COMMAND.to_string()
        } else {
            trimmed.to_string()
        }
    };

    let mut cmd = tokio::process::Command::new("ssh");
    cmd.args(crate::devsession::ssh_base_args())
        .arg(&target)
        .arg(&remote_cmd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            finish_and_notify(
                &db,
                &notify,
                &run_id,
                "failed",
                None,
                Some(&format!("Failed to launch ssh: {e}")),
            );
            return;
        }
    };

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

    let prompt = build_rerank_prompt(&comment);
    if let Some(mut stdin) = child.stdin.take() {
        let write_res = stdin.write_all(prompt.as_bytes()).await;
        let shutdown_res = if write_res.is_ok() {
            stdin.shutdown().await
        } else {
            Ok(())
        };
        drop(stdin);

        if let Err(e) = write_res.and(shutdown_res) {
            if e.kind() != std::io::ErrorKind::BrokenPipe {
                let _ = child.kill().await;
                let _ = child.wait().await;
                stdout_task.abort();
                stderr_task.abort();
                finish_and_notify(
                    &db,
                    &notify,
                    &run_id,
                    "failed",
                    None,
                    Some(&format!("Failed to write prompt to ssh stdin: {e}")),
                );
                return;
            }
        }
    }

    let wait_res =
        tokio::time::timeout(Duration::from_secs(RERANK_TIMEOUT_SECS), child.wait()).await;

    let status = match wait_res {
        Ok(Ok(status)) => status,
        Ok(Err(e)) => {
            stdout_task.abort();
            stderr_task.abort();
            finish_and_notify(
                &db,
                &notify,
                &run_id,
                "failed",
                None,
                Some(&format!("SSH process wait error: {e}")),
            );
            return;
        }
        Err(_) => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            stdout_task.abort();
            stderr_task.abort();
            finish_and_notify(
                &db,
                &notify,
                &run_id,
                "failed",
                None,
                Some("Timed out after 15 minutes"),
            );
            return;
        }
    };

    let stdout_bytes = stdout_task.await.unwrap_or_default();
    let stderr_bytes = stderr_task.await.unwrap_or_default();
    let stdout_str = String::from_utf8_lossy(&stdout_bytes).into_owned();
    let stderr_str = String::from_utf8_lossy(&stderr_bytes).into_owned();

    if status.success() {
        match parse_claude_success_output(&stdout_str) {
            Ok(summary) => {
                finish_and_notify(&db, &notify, &run_id, "succeeded", Some(&summary), None);
                (notify)("backlog-changed");
            }
            Err(err_msg) => {
                finish_and_notify(&db, &notify, &run_id, "failed", None, Some(&err_msg));
            }
        }
    } else {
        let err_msg = format_failure_output(&stderr_str, &stdout_str, status);
        finish_and_notify(&db, &notify, &run_id, "failed", None, Some(&err_msg));
    }
}

fn finish_and_notify(
    db: &Arc<Mutex<Connection>>,
    notify: &Notify,
    run_id: &str,
    status: &str,
    summary: Option<&str>,
    error: Option<&str>,
) {
    let finished_at = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
    if let Ok(conn) = db.lock() {
        let _ = db::finish_rerank_run(&conn, run_id, status, summary, error, &finished_at);
    }
    (notify)("rerank-changed");
}

fn parse_claude_success_output(stdout: &str) -> Result<String, String> {
    let trimmed = stdout.trim();
    if let Ok(val) = serde_json::from_str::<Value>(trimmed) {
        let target = if val.is_object() {
            Some(&val)
        } else if let Some(arr) = val.as_array() {
            arr.iter().rev().find(|item| {
                item.get("result").is_some()
                    || item.get("is_error").is_some()
                    || item.get("status").is_some()
            })
        } else {
            None
        };

        if let Some(obj) = target {
            if let Some(agy_status) = obj.get("status").and_then(|v| v.as_str()) {
                let response_text = obj
                    .get("response")
                    .and_then(|v| v.as_str())
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty());
                let error_text = obj
                    .get("error")
                    .and_then(|v| v.as_str())
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty());

                if agy_status != "SUCCESS" {
                    return Err(error_text
                        .or(response_text)
                        .unwrap_or_else(|| truncate_chars(trimmed, MAX_PLAIN_STDOUT_CHARS)));
                }

                if let Some(summary) = response_text {
                    return Ok(summary);
                }
                return Ok("Rerank completed.".to_string());
            }

            let is_error = obj
                .get("is_error")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let result_text = obj
                .get("result")
                .and_then(|v| v.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty());

            if is_error {
                return Err(result_text.unwrap_or_else(|| {
                    if trimmed.is_empty() {
                        "Claude Code returned an error.".to_string()
                    } else {
                        truncate_chars(trimmed, MAX_PLAIN_STDOUT_CHARS)
                    }
                }));
            }

            if let Some(summary) = result_text {
                return Ok(summary);
            }
        }
    }

    Ok(truncate_chars(trimmed, MAX_PLAIN_STDOUT_CHARS))
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

fn truncate_chars(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        s.to_string()
    } else {
        s.chars().take(max_chars).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::parse_claude_success_output;

    #[test]
    fn test_parse_claude_and_antigravity_outputs() {
        let claude_ok = r#"{"is_error":false,"result":"Moved KAR-1 to top."}"#;
        assert_eq!(
            parse_claude_success_output(claude_ok).unwrap(),
            "Moved KAR-1 to top."
        );

        let claude_err = r#"{"is_error":true,"result":"MCP offline"}"#;
        assert_eq!(
            parse_claude_success_output(claude_err).unwrap_err(),
            "MCP offline"
        );

        let agy_ok = r#"{"status":"SUCCESS","response":"Reordered 5 items."}"#;
        assert_eq!(
            parse_claude_success_output(agy_ok).unwrap(),
            "Reordered 5 items."
        );

        let agy_err = r#"{"status":"ERROR","error":"Model quota exceeded","response":""}"#;
        assert_eq!(
            parse_claude_success_output(agy_err).unwrap_err(),
            "Model quota exceeded"
        );
    }
}
