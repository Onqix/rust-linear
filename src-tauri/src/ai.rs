use crate::db::{AiSuggestion, AiTriageResult, AiWorkBucket, LinearIssue};
use chrono::Utc;
use serde::{Deserialize, Serialize};

const ANTHROPIC_API_URL: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_MODELS_URL: &str = "https://api.anthropic.com/v1/models?limit=100";

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

pub async fn run_claude_triage(
    api_key: &str,
    model: &str,
    viewer_name: Option<&str>,
    issues: &[LinearIssue],
) -> Result<AiTriageResult, String> {
    if api_key.trim().is_empty() {
        return Err("Anthropic API key is not configured. Add it in Settings.".to_string());
    }

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
    let prompt = format!(
        r#"You are an engineering triage assistant for {user_label}.
Analyze these active Linear tickets and call the `submit_triage` tool with your structured triage plan.

Rules:
- Put 3 to 5 top picks in `next_to_grab`.
- Prioritize tickets with `unread_responses > 0` (especially `[UNREAD]` comments), `In Progress` work, high/urgent priority, or clear actionable scope.
- Group tickets into non-empty `work_buckets` using names from: "Needs Your Reply", "Quick Wins", "Deep Work", "Blocked / Waiting" (include up to 6 tickets per bucket).
- Keep each `reason` concise (1-2 sentences, max 35 words).
- Use exact ticket identifiers from the input.

Tickets:
{}"#,
        serde_json::to_string_pretty(&digest).unwrap_or_else(|_| "[]".into())
    );

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

    let triage_tool = serde_json::json!({
        "name": "submit_triage",
        "description": "Submit the structured Linear ticket triage summary, top next tickets to grab, and categorized work buckets.",
        "input_schema": {
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
        }
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
