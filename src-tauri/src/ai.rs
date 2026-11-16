use crate::db::{AiSuggestion, AiTriageResult, AiWorkBucket, LinearIssue};
use chrono::Utc;
use serde::Deserialize;

const ANTHROPIC_API_URL: &str = "https://api.anthropic.com/v1/messages";

#[derive(Debug, Deserialize)]
struct AnthropicResponse {
    content: Vec<ContentBlock>,
}

#[derive(Debug, Deserialize)]
struct ContentBlock {
    #[serde(rename = "type")]
    block_type: String,
    text: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawTriagePayload {
    summary: String,
    next_to_grab: Vec<AiSuggestion>,
    work_buckets: Vec<AiWorkBucket>,
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

    let active_issues: Vec<&LinearIssue> = issues
        .iter()
        .filter(|i| i.state_type != "completed" && i.state_type != "canceled")
        .take(40)
        .collect();

    if active_issues.is_empty() {
        return Err("No active Linear issues found to triage. Sync Linear first.".to_string());
    }

    let digest: Vec<serde_json::Value> = active_issues
        .iter()
        .map(|i| {
            let latest_comment = i.comments.last().map(|c| {
                let snippet: String = c.body.chars().take(180).collect();
                format!("{}: {}", c.author_name, snippet)
            });
            serde_json::json!({
                "identifier": i.identifier,
                "title": i.title,
                "state": i.state_name,
                "state_type": i.state_type,
                "priority": i.priority_label,
                "assignee": i.assignee_name,
                "labels": i.labels,
                "unread_responses": i.unread_responses,
                "latest_comment": latest_comment,
                "updated_at": i.updated_at,
            })
        })
        .collect();

    let user_label = viewer_name.unwrap_or("the user");
    let prompt = format!(
        r#"You are an engineering triage assistant for {user_label}.
Analyze these active Linear tickets and return ONLY valid JSON (no markdown, no extra text) with this exact schema:
{{
  "summary": "1-2 sentence overview of the current workload and what needs attention first.",
  "next_to_grab": [
    {{
      "identifier": "ENG-123",
      "title": "Short title",
      "reason": "Why grab this next (e.g. high priority, unread reply, unblocked).",
      "urgency": "high" | "medium" | "low"
    }}
  ],
  "work_buckets": [
    {{
      "name": "Needs Your Reply" | "Quick Wins" | "Deep Work" | "Blocked / Waiting",
      "description": "One-line description of this bucket",
      "tickets": [
        {{
          "identifier": "ENG-123",
          "title": "Short title",
          "reason": "Actionable next step",
          "urgency": "high" | "medium" | "low"
        }}
      ]
    }}
  ]
}}

Rules:
- Put 3 to 5 top picks in "next_to_grab".
- Prioritize tickets with unread_responses > 0, high/urgent priority, or clear actionable scope.
- Only include non-empty buckets in "work_buckets".
- Use exact ticket identifiers from the input.

Tickets:
{}"#,
        serde_json::to_string_pretty(&digest).unwrap_or_else(|_| "[]".into())
    );

    let chosen_model = if model.trim().is_empty() {
        "claude-haiku-4-5"
    } else {
        model.trim()
    };

    let client = reqwest::Client::new();
    let res = client
        .post(ANTHROPIC_API_URL)
        .header("x-api-key", api_key.trim())
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&serde_json::json!({
            "model": chosen_model,
            "max_tokens": 2048,
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

    let text = parsed
        .content
        .into_iter()
        .find(|b| b.block_type == "text")
        .and_then(|b| b.text)
        .ok_or_else(|| "Anthropic response did not contain text".to_string())?;

    let json_str = extract_json_block(&text);
    let raw_payload: RawTriagePayload = serde_json::from_str(json_str)
        .map_err(|e| format!("Failed to parse AI triage JSON: {e}\nRaw output: {text}"))?;

    Ok(AiTriageResult {
        generated_at: Utc::now().to_rfc3339(),
        model: chosen_model.to_string(),
        summary: raw_payload.summary,
        next_to_grab: raw_payload.next_to_grab,
        work_buckets: raw_payload.work_buckets,
    })
}
