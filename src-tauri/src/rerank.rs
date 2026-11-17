use crate::db::{self, BridgeSettings, DEFAULT_RERANK_COMMAND};
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

/// Build the stdin prompt sent to headless Claude Code for a backlog rerank.
pub fn build_rerank_prompt(comment: &str) -> String {
    let mut parts = vec![
        "You are maintaining James's ranked Linear backlog in his Linear Pulse desktop app, via the `linear-pulse` MCP tools.".to_string(),
        "Steps: call get_backlog, then get_changes_since_last_rank, then use list_issues / get_issue as needed for candidates or detail.".to_string(),
        "Re-rank with the most important and urgent work first. You may add newly relevant open issues and remove ones that are done, canceled or no longer relevant.".to_string(),
        "Write the full new order with ONE call to set_backlog, giving every item a one-line `note` explaining its position.".to_string(),
        "Group items that can ship together in one development session with `group` on each item and a one-line reason per group in `groups` (2–5 items per group; leave the rest ungrouped).".to_string(),
        "Items with a non-null `dev_session` are being worked on by a Claude session right now: keep them in the backlog, keep their group together, and rank them by importance as usual — never remove them.".to_string(),
        "Do not change issue states or post comments during a rerank.".to_string(),
    ];

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

    let remote_cmd = {
        let trimmed = settings.rerank_command.trim();
        if trimmed.is_empty() {
            DEFAULT_RERANK_COMMAND.to_string()
        } else {
            trimmed.to_string()
        }
    };

    let mut cmd = tokio::process::Command::new("ssh");
    cmd.args([
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=accept-new",
        "-o",
        "ConnectTimeout=15",
        &target,
        &remote_cmd,
    ])
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
            arr.iter()
                .rev()
                .find(|item| item.get("result").is_some() || item.get("is_error").is_some())
        } else {
            None
        };

        if let Some(obj) = target {
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
