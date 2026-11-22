use crate::db::{AiSuggestion, AiTriageResult, AiWorkBucket, BridgeSettings, LinearIssue};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

const ANTHROPIC_API_URL: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODELS_URL: &str = "https://api.anthropic.com/v1/models?limit=100";
const GEMINI_MODELS_URL: &str = "https://generativelanguage.googleapis.com/v1beta/models?pageSize=100";
const GEMINI_API_BASE: &str = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_GEMINI_MODEL: &str = "gemini-2.5-flash";
const DEFAULT_AGY_TRIAGE_MODEL: &str = "gemini-4-hydrogen-high";
const AGY_TRIAGE_TIMEOUT_SECS: u64 = 210;

pub enum GeminiAuth {
    ApiKey(String),
    OAuthBearer(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClaudeModelOption {
    pub id: String,
    pub display_name: String,
}

#[derive(Debug, Deserialize)]
struct AnthropicModelsResponse {
    data: Vec<RawAnthropicModel>,
}

#[derive(Debug, Deserialize)]
struct RawAnthropicModel {
    id: String,
    display_name: Option<String>,
    lifecycle: Option<String>,
}

pub async fn fetch_anthropic_models(api_key: &str) -> Result<Vec<ClaudeModelOption>, String> {
    if api_key.trim().is_empty() {
        return Err("Anthropic API key is empty".to_string());
    }

    let client = reqwest::Client::new();
    let res = client
        .get(ANTHROPIC_MODELS_URL)
        .header("x-api-key", api_key.trim())
        .header("anthropic-version", "2023-06-01")
        .send()
        .await
        .map_err(|e| format!("Failed to reach Anthropic models API: {e}"))?;

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(format!("Anthropic models API returned {status}: {body}"));
    }

    let parsed: AnthropicModelsResponse = res
        .json()
        .await
        .map_err(|e| format!("Failed to parse Anthropic models response: {e}"))?;

    let options = parsed
        .data
        .into_iter()
        .filter(|m| {
            !matches!(
                m.lifecycle.as_deref(),
                Some("retired") | Some("deprecated")
            )
        })
        .map(|m| {
            let display_name = m
                .display_name
                .filter(|d| !d.trim().is_empty())
                .unwrap_or_else(|| m.id.clone());
            ClaudeModelOption {
                id: m.id,
                display_name,
            }
        });

    let (mut haiku, mut others): (Vec<ClaudeModelOption>, Vec<ClaudeModelOption>) =
        options.partition(|m| m.id.to_lowercase().contains("haiku"));
    haiku.append(&mut others);
    Ok(haiku)
}

#[derive(Debug, Deserialize)]
struct AnthropicResponse {
    stop_reason: Option<String>,
    content: Vec<ContentBlock>,
}

#[derive(Debug, Deserialize)]
struct ContentBlock {
    #[serde(rename = "type")]
    block_type: String,
    text: Option<String>,
    input: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
#[serde(default)]
struct RawTriagePayload {
    summary: String,
    next_to_grab: Vec<AiSuggestion>,
    work_buckets: Vec<AiWorkBucket>,
}

impl Default for RawTriagePayload {
    fn default() -> Self {
        Self {
            summary: String::new(),
            next_to_grab: Vec::new(),
            work_buckets: Vec::new(),
        }
    }
}

fn extract_json_block(raw: &str) -> &str {
    let trimmed = raw.trim();
    if let Some(start) = trimmed.find('{') {
        if let Some(end) = trimmed.rfind('}') {
            if end >= start {
                return &trimmed[start..=end];
            }
        }
    }
    trimmed
}

fn build_triage_prompt(viewer_name: Option<&str>, issues: &[LinearIssue]) -> Result<String, String> {
    let mut active_issues: Vec<&LinearIssue> = issues
        .iter()
        .filter(|i| i.state_type != "completed" && i.state_type != "canceled")
        .collect();

    if active_issues.is_empty() {
        return Err("No active Linear issues found to triage. Sync Linear first.".to_string());
    }

    active_issues.sort_by(|a, b| {
        (b.unread_responses > 0)
            .cmp(&(a.unread_responses > 0))
            .then_with(|| (b.state_type == "started").cmp(&(a.state_type == "started")))
            .then_with(|| {
                let pa = if a.priority == 0 { 99 } else { a.priority };
                let pb = if b.priority == 0 { 99 } else { b.priority };
                pa.cmp(&pb)
            })
            .then_with(|| b.updated_at.cmp(&a.updated_at))
    });
    active_issues.truncate(40);

    let digest: Vec<serde_json::Value> = active_issues
        .iter()
        .map(|i| {
            let description_snippet: Option<String> = i
                .description
                .as_deref()
                .map(str::trim)
                .filter(|d| !d.is_empty())
                .map(|d| d.chars().take(240).collect());

            let recent_comments: Vec<String> = i
                .comments
                .iter()
                .rev()
                .take(3)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .map(|c| {
                    let snippet: String = c.body.chars().take(220).collect();
                    let prefix = if c.is_unread { "[UNREAD] " } else { "" };
                    format!("{prefix}{}: {}", c.author_name, snippet)
                })
                .collect();

            serde_json::json!({
                "identifier": i.identifier,
                "title": i.title,
                "project": i.project_name,
                "state": i.state_name,
                "state_type": i.state_type,
                "priority": i.priority_label,
                "assignee": i.assignee_name,
                "labels": i.labels,
                "unread_responses": i.unread_responses,
                "description_snippet": description_snippet,
                "recent_comments": recent_comments,
                "updated_at": i.updated_at,
            })
        })
        .collect();

    let user_label = viewer_name.unwrap_or("the user");
    Ok(format!(
        r#"You are an engineering triage assistant for {user_label}.
Analyze these active Linear tickets and produce your structured triage plan.

Rules:
- Put 3 to 5 top picks in `next_to_grab`.
- Prioritize tickets with `unread_responses > 0` (especially `[UNREAD]` comments), `In Progress` work, high/urgent priority, or clear actionable scope.
- Group tickets into non-empty `work_buckets` using names from: "Needs Your Reply", "Quick Wins", "Deep Work", "Blocked / Waiting" (include up to 6 tickets per bucket).
- Keep each `reason` concise (1-2 sentences, max 35 words).
- Use exact ticket identifiers from the input.

Tickets:
{}"#,
        serde_json::to_string_pretty(&digest).unwrap_or_else(|_| "[]".into())
    ))
}

fn triage_json_schema() -> serde_json::Value {
    let suggestion_schema = serde_json::json!({
        "type": "object",
        "properties": {
            "identifier": { "type": "string" },
            "title": { "type": "string" },
            "reason": { "type": "string" },
            "urgency": { "type": "string", "enum": ["high", "medium", "low"] }
        },
        "required": ["identifier", "title", "reason", "urgency"]
    });

    serde_json::json!({
        "type": "object",
        "properties": {
            "summary": { "type": "string" },
            "next_to_grab": {
                "type": "array",
                "items": suggestion_schema
            },
            "work_buckets": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": { "type": "string" },
                        "description": { "type": "string" },
                        "tickets": {
                            "type": "array",
                            "items": suggestion_schema
                        }
                    },
                    "required": ["name", "description", "tickets"]
                }
            }
        },
        "required": ["summary", "next_to_grab", "work_buckets"]
    })
}

pub async fn run_claude_triage(
    api_key: &str,
    model: &str,
    viewer_name: Option<&str>,
    issues: &[LinearIssue],
) -> Result<AiTriageResult, String> {
    if api_key.trim().is_empty() {
        return Err("Anthropic API key is not configured. Add it in Settings.".to_string());
    }

    let base_prompt = build_triage_prompt(viewer_name, issues)?;
    let prompt = format!(
        "{base_prompt}\n\nCall the `submit_triage` tool with your structured triage plan."
    );

    let triage_tool = serde_json::json!({
        "name": "submit_triage",
        "description": "Submit the structured Linear ticket triage summary, top next tickets to grab, and categorized work buckets.",
        "input_schema": triage_json_schema()
    });

    let chosen_model = if model.trim().is_empty() {
        "claude-haiku-4-5"
    } else {
        model.trim()
    };

    let max_tokens = if chosen_model.starts_with("claude-3-haiku")
        || chosen_model.starts_with("claude-3-sonnet")
        || chosen_model.starts_with("claude-3-opus")
    {
        4096
    } else {
        8192
    };

    let client = reqwest::Client::new();
    let res = client
        .post(ANTHROPIC_API_URL)
        .header("x-api-key", api_key.trim())
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&serde_json::json!({
            "model": chosen_model,
            "max_tokens": max_tokens,
            "tools": [triage_tool],
            "tool_choice": { "type": "tool", "name": "submit_triage" },
            "messages": [
                { "role": "user", "content": prompt }
            ]
        }))
        .send()
        .await
        .map_err(|e| format!("Failed to reach Anthropic API: {e}"))?;

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(format!("Anthropic API returned {status}: {body}"));
    }

    let parsed: AnthropicResponse = res
        .json()
        .await
        .map_err(|e| format!("Failed to parse Anthropic response: {e}"))?;

    if parsed.stop_reason.as_deref() == Some("max_tokens") {
        return Err("AI triage output exceeded the token limit before completing. Try again or select a model with higher output capacity.".to_string());
    }

    let raw_payload: RawTriagePayload = if let Some(tool_input) = parsed
        .content
        .iter()
        .find(|b| b.block_type == "tool_use")
        .and_then(|b| b.input.clone())
    {
        serde_json::from_value(tool_input)
            .map_err(|e| format!("Failed to parse AI triage tool payload: {e}"))?
    } else {
        let text = parsed
            .content
            .into_iter()
            .find(|b| b.block_type == "text")
            .and_then(|b| b.text)
            .ok_or_else(|| "Anthropic response did not contain triage output".to_string())?;

        let json_str = extract_json_block(&text);
        serde_json::from_str(json_str)
            .map_err(|e| format!("Failed to parse AI triage JSON: {e}\nRaw output: {text}"))?
    };

    Ok(AiTriageResult {
        generated_at: Utc::now().to_rfc3339(),
        model: chosen_model.to_string(),
        summary: raw_payload.summary,
        next_to_grab: raw_payload.next_to_grab,
        work_buckets: raw_payload.work_buckets,
    })
}

fn apply_gemini_auth(
    req: reqwest::RequestBuilder,
    auth: &GeminiAuth,
) -> Result<reqwest::RequestBuilder, String> {
    match auth {
        GeminiAuth::ApiKey(key) => {
            let trimmed = key.trim();
            if trimmed.is_empty() {
                return Err("Gemini API key is empty. Add it or sign in with Google in Settings.".to_string());
            }
            Ok(req.header("x-goog-api-key", trimmed))
        }
        GeminiAuth::OAuthBearer(token) => {
            let trimmed = token.trim();
            if trimmed.is_empty() {
                return Err("Google OAuth access token is empty. Sign in with Google in Settings.".to_string());
            }
            Ok(req.bearer_auth(trimmed))
        }
    }
}

#[derive(Debug, Deserialize)]
struct GeminiModelsResponse {
    #[serde(default)]
    models: Vec<RawGeminiModel>,
}

#[derive(Debug, Deserialize)]
struct RawGeminiModel {
    name: String,
    #[serde(rename = "displayName")]
    display_name: Option<String>,
    #[serde(rename = "supportedGenerationMethods", default)]
    supported_generation_methods: Vec<String>,
}

pub async fn fetch_gemini_models(auth: GeminiAuth) -> Result<Vec<ClaudeModelOption>, String> {
    let client = reqwest::Client::new();
    let req = apply_gemini_auth(client.get(GEMINI_MODELS_URL), &auth)?;
    let res = req
        .send()
        .await
        .map_err(|e| format!("Failed to reach Gemini models API: {e}"))?;

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(format!("Gemini models API returned {status}: {body}"));
    }

    let parsed: GeminiModelsResponse = res
        .json()
        .await
        .map_err(|e| format!("Failed to parse Gemini models response: {e}"))?;

    let options = parsed.models.into_iter().filter_map(|m| {
        if !m.name.starts_with("models/gemini-") {
            return None;
        }
        if !m
            .supported_generation_methods
            .iter()
            .any(|method| method == "generateContent")
        {
            return None;
        }
        let id = m.name.strip_prefix("models/").unwrap_or(&m.name).to_string();
        let display_name = m
            .display_name
            .filter(|d| !d.trim().is_empty())
            .unwrap_or_else(|| id.clone());
        Some(ClaudeModelOption { id, display_name })
    });

    let (mut flash, mut others): (Vec<ClaudeModelOption>, Vec<ClaudeModelOption>) =
        options.partition(|m| m.id.to_lowercase().contains("flash"));
    flash.append(&mut others);
    Ok(flash)
}

#[derive(Debug, Deserialize)]
struct GeminiGenerateResponse {
    #[serde(default)]
    candidates: Vec<GeminiCandidate>,
}

#[derive(Debug, Deserialize)]
struct GeminiCandidate {
    content: Option<GeminiContent>,
    #[serde(rename = "finishReason")]
    finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GeminiContent {
    #[serde(default)]
    parts: Vec<GeminiPart>,
}

#[derive(Debug, Deserialize)]
struct GeminiPart {
    text: Option<String>,
}

pub async fn run_gemini_triage(
    auth: GeminiAuth,
    model: &str,
    viewer_name: Option<&str>,
    issues: &[LinearIssue],
) -> Result<AiTriageResult, String> {
    let prompt = build_triage_prompt(viewer_name, issues)?;

    let raw_model = model.trim().trim_start_matches("models/");
    let chosen_model = if raw_model.is_empty() {
        DEFAULT_GEMINI_MODEL
    } else {
        raw_model
    };

    let url = format!("{GEMINI_API_BASE}/{chosen_model}:generateContent");
    let client = reqwest::Client::new();
    let req = apply_gemini_auth(client.post(&url), &auth)?;

    let res = req
        .header("content-type", "application/json")
        .json(&serde_json::json!({
            "contents": [
                {
                    "role": "user",
                    "parts": [{ "text": prompt }]
                }
            ],
            "generationConfig": {
                "responseMimeType": "application/json",
                "responseSchema": triage_json_schema()
            }
        }))
        .send()
        .await
        .map_err(|e| format!("Failed to reach Gemini API: {e}"))?;

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(format!("Gemini API returned {status}: {body}"));
    }

    let parsed: GeminiGenerateResponse = res
        .json()
        .await
        .map_err(|e| format!("Failed to parse Gemini response: {e}"))?;

    let candidate = parsed
        .candidates
        .into_iter()
        .next()
        .ok_or_else(|| "Gemini response contained no candidates".to_string())?;

    let finish_reason = candidate.finish_reason.clone();
    let text = candidate
        .content
        .map(|c| {
            c.parts
                .into_iter()
                .filter_map(|p| p.text)
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default();

    if text.trim().is_empty() {
        return Err(format!(
            "Gemini response contained no text output (finishReason: {:?})",
            finish_reason
        ));
    }

    let json_str = extract_json_block(&text);
    let raw_payload: RawTriagePayload = serde_json::from_str(json_str).map_err(|e| {
        if finish_reason.as_deref() == Some("MAX_TOKENS") {
            "Gemini triage output exceeded MAX_TOKENS before completing.".to_string()
        } else {
            format!("Failed to parse Gemini triage JSON: {e}\nRaw output: {text}")
        }
    })?;

    Ok(AiTriageResult {
        generated_at: Utc::now().to_rfc3339(),
        model: chosen_model.to_string(),
        summary: raw_payload.summary,
        next_to_grab: raw_payload.next_to_grab,
        work_buckets: raw_payload.work_buckets,
    })
}

pub fn parse_antigravity_models(stdout: &str) -> Vec<ClaudeModelOption> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();

    for raw_line in stdout.lines() {
        let after_cr = raw_line.rsplit('\r').next().unwrap_or("");
        let clean = crate::devsession::strip_ansi_escapes(after_cr);
        let trimmed = clean.trim();
        if trimmed.is_empty()
            || trimmed.starts_with('-')
            || trimmed.starts_with('=')
            || trimmed.starts_with("Fetching")
            || trimmed.starts_with("Available")
        {
            continue;
        }

        let mut parts = trimmed.splitn(2, char::is_whitespace);
        let Some(slug) = parts.next().map(str::trim).filter(|s| !s.is_empty()) else {
            continue;
        };
        if !(slug
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
            && (slug.contains('-') || slug.contains('.')))
        {
            continue;
        }
        let display_name = parts
            .next()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(slug)
            .to_string();

        if seen.insert(slug.to_string()) {
            out.push(ClaudeModelOption {
                id: slug.to_string(),
                display_name,
            });
        }
    }

    out
}

pub async fn fetch_antigravity_models(
    settings: &BridgeSettings,
) -> Result<Vec<ClaudeModelOption>, String> {
    let target = crate::devsession::resolve_ssh_target(settings)?;
    let (stdout, _stderr) = crate::devsession::run_ssh(
        &target,
        "~/.local/bin/agy models",
        Duration::from_secs(30),
    )
    .await?;

    let models = parse_antigravity_models(&stdout);
    if models.is_empty() {
        return Err(format!(
            "No models found in `agy models` output: {}",
            stdout.trim()
        ));
    }
    Ok(models)
}

#[derive(Debug, Deserialize)]
struct AgyPrintResponse {
    status: Option<String>,
    response: Option<String>,
    structured_output: Option<serde_json::Value>,
    error: Option<String>,
}

pub async fn run_antigravity_triage(
    settings: &BridgeSettings,
    model: &str,
    viewer_name: Option<&str>,
    issues: &[LinearIssue],
) -> Result<AiTriageResult, String> {
    let target = crate::devsession::resolve_ssh_target(settings)?;
    let validated = crate::devsession::validate_model(model)?;
    let chosen_model = if validated.is_empty() {
        DEFAULT_AGY_TRIAGE_MODEL.to_string()
    } else {
        validated
    };

    let prompt = build_triage_prompt(viewer_name, issues)?;
    let schema_json = serde_json::to_string(&triage_json_schema())
        .map_err(|e| format!("Failed to serialize triage schema: {e}"))?;
    let schema_b64 = crate::devsession::base64_encode(schema_json.as_bytes());

    let remote_cmd = format!(
        "~/.local/bin/agy --model {} --output-format json --json-schema \"$(printf %s '{}' | base64 -d)\" --print-timeout 180s -p \"$(cat)\"",
        crate::devsession::shell_single_quote(&chosen_model),
        schema_b64,
    );

    let mut cmd = tokio::process::Command::new("ssh");
    cmd.args(crate::devsession::ssh_base_args())
        .arg(&target)
        .arg(&remote_cmd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to launch ssh for Antigravity triage: {e}"))?;

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
                return Err(format!("Failed to write triage prompt to ssh stdin: {e}"));
            }
        }
    }

    let status = match tokio::time::timeout(
        Duration::from_secs(AGY_TRIAGE_TIMEOUT_SECS),
        child.wait(),
    )
    .await
    {
        Ok(Ok(st)) => st,
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
            return Err("Antigravity AI triage timed out after 210s".to_string());
        }
    };

    let stdout_bytes = stdout_task.await.unwrap_or_default();
    let stderr_bytes = stderr_task.await.unwrap_or_default();
    let stdout_str = String::from_utf8_lossy(&stdout_bytes).into_owned();
    let stderr_str = String::from_utf8_lossy(&stderr_bytes).into_owned();

    if !status.success() {
        let detail = if !stderr_str.trim().is_empty() {
            stderr_str.trim()
        } else if !stdout_str.trim().is_empty() {
            stdout_str.trim()
        } else {
            "unknown SSH error"
        };
        return Err(format!("Antigravity triage failed ({status}): {detail}"));
    }

    let json_envelope = extract_json_block(&stdout_str);
    let envelope: AgyPrintResponse = serde_json::from_str(json_envelope).map_err(|e| {
        format!(
            "Failed to parse Antigravity JSON response: {e}\nRaw output: {}",
            stdout_str.trim()
        )
    })?;

    if envelope.status.as_deref() != Some("SUCCESS") {
        let err_msg = envelope
            .error
            .filter(|s| !s.trim().is_empty())
            .or_else(|| envelope.response.filter(|s| !s.trim().is_empty()))
            .unwrap_or_else(|| format!("Antigravity returned status {:?}", envelope.status));
        return Err(err_msg);
    }

    let raw_payload: RawTriagePayload = if let Some(structured) = envelope.structured_output {
        serde_json::from_value(structured)
            .map_err(|e| format!("Failed to parse Antigravity structured_output: {e}"))?
    } else {
        let resp = envelope
            .response
            .filter(|s| !s.trim().is_empty())
            .ok_or_else(|| "Antigravity response did not contain triage output".to_string())?;
        let json_str = extract_json_block(&resp);
        serde_json::from_str(json_str)
            .map_err(|e| format!("Failed to parse Antigravity triage JSON: {e}\nRaw output: {resp}"))?
    };

    Ok(AiTriageResult {
        generated_at: Utc::now().to_rfc3339(),
        model: chosen_model,
        summary: raw_payload.summary,
        next_to_grab: raw_payload.next_to_grab,
        work_buckets: raw_payload.work_buckets,
    })
}

#[cfg(test)]
mod tests {
    use super::parse_antigravity_models;

    #[test]
    fn test_parse_antigravity_models_handles_spinner_and_columns() {
        let sample = "\r⠋ Fetching available models...\r⠙ Fetching available models...\rgemini-4-neon-high             Gemini 4 Neon (High)\ngemini-4-hydrogen-high         Gemini 4 Hydrogen (High)\ngemini-pro-orchestrator-neon   Orchestrator (Neon)\n";
        let parsed = parse_antigravity_models(sample);
        assert_eq!(parsed.len(), 3);
        assert_eq!(parsed[0].id, "gemini-4-neon-high");
        assert_eq!(parsed[0].display_name, "Gemini 4 Neon (High)");
        assert_eq!(parsed[1].id, "gemini-4-hydrogen-high");
        assert_eq!(parsed[2].id, "gemini-pro-orchestrator-neon");
        assert_eq!(parsed[2].display_name, "Orchestrator (Neon)");
    }
}
