use crate::db::{self, BacklogEntry, LinearIssue};
use crate::linear::{self, UpdateIssuePatch};
use axum::body::Bytes;
use axum::extract::State;
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{DateTime, Duration, SecondsFormat, Utc};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

pub type Notify = Arc<dyn Fn(&'static str) + Send + Sync>;

pub struct McpContext {
    pub db: Arc<Mutex<Connection>>,
    pub notify: Notify,
    pub token: String,
    pub app_version: String,
    pub last_request_at: Arc<Mutex<Option<String>>>,
}

pub async fn serve(
    ctx: Arc<McpContext>,
    port: u16,
    shutdown: tokio::sync::oneshot::Receiver<()>,
) -> Result<(), String> {
    let addr = format!("127.0.0.1:{port}");
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .map_err(|e| format!("Failed to bind MCP server on {addr}: {e}"))?;

    let app = Router::new()
        .route(
            "/mcp",
            post(handle_mcp)
                .get(handle_method_not_allowed)
                .delete(handle_method_not_allowed),
        )
        .route("/health", get(handle_health))
        .with_state(ctx);

    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            let _ = shutdown.await;
        })
        .await
        .map_err(|e| format!("MCP server error: {e}"))
}

async fn handle_health() -> impl IntoResponse {
    (StatusCode::OK, Json(json!({ "ok": true })))
}

async fn handle_method_not_allowed() -> StatusCode {
    StatusCode::METHOD_NOT_ALLOWED
}

fn jsonrpc_error(id: Value, code: i64, message: impl Into<String>) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": {
            "code": code,
            "message": message.into(),
        }
    })
}

fn jsonrpc_result(id: Value, result: Value) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": result,
    })
}

async fn handle_mcp(
    State(ctx): State<Arc<McpContext>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    if headers.contains_key(header::ORIGIN) {
        return (
            StatusCode::FORBIDDEN,
            Json(jsonrpc_error(
                Value::Null,
                -32000,
                "Forbidden: Origin header is not allowed",
            )),
        )
            .into_response();
    }

    let authorized = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
        .map(|tok| !ctx.token.is_empty() && tok == ctx.token)
        .unwrap_or(false);

    if !authorized {
        return (
            StatusCode::UNAUTHORIZED,
            Json(jsonrpc_error(
                Value::Null,
                -32001,
                "Unauthorized: invalid or missing bearer token",
            )),
        )
            .into_response();
    }

    {
        let now = Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true);
        if let Ok(mut guard) = ctx.last_request_at.lock() {
            *guard = Some(now);
        }
    }

    let parsed: Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(e) => {
            return (
                StatusCode::OK,
                Json(jsonrpc_error(
                    Value::Null,
                    -32700,
                    format!("Parse error: {e}"),
                )),
            )
                .into_response();
        }
    };

    match parsed {
        Value::Object(_) => {
            if let Some(resp) = process_message(&ctx, parsed).await {
                (StatusCode::OK, Json(resp)).into_response()
            } else {
                StatusCode::ACCEPTED.into_response()
            }
        }
        Value::Array(items) => {
            if items.is_empty() {
                return (
                    StatusCode::OK,
                    Json(jsonrpc_error(
                        Value::Null,
                        -32600,
                        "Invalid Request: empty batch",
                    )),
                )
                    .into_response();
            }
            let mut responses = Vec::new();
            for item in items {
                if let Some(resp) = process_message(&ctx, item).await {
                    responses.push(resp);
                }
            }
            if responses.is_empty() {
                StatusCode::ACCEPTED.into_response()
            } else {
                (StatusCode::OK, Json(Value::Array(responses))).into_response()
            }
        }
        _ => (
            StatusCode::OK,
            Json(jsonrpc_error(
                Value::Null,
                -32600,
                "Invalid Request: expected JSON object or array",
            )),
        )
            .into_response(),
    }
}

async fn process_message(ctx: &Arc<McpContext>, msg: Value) -> Option<Value> {
    let obj = match msg.as_object() {
        Some(o) => o,
        None => {
            return Some(jsonrpc_error(
                Value::Null,
                -32600,
                "Invalid Request: message must be a JSON object",
            ));
        }
    };

    let id = obj.get("id").cloned();
    let method = match obj.get("method").and_then(|v| v.as_str()) {
        Some(m) => m,
        None => {
            return id.map(|id_val| {
                jsonrpc_error(id_val, -32600, "Invalid Request: missing method")
            });
        }
    };

    let params = obj.get("params").cloned().unwrap_or_else(|| json!({}));

    let Some(id_val) = id else {
        // Notification (no `id`): process silently and return no response.
        return None;
    };

    let resp = match method {
        "initialize" => {
            let requested = params
                .get("protocolVersion")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let protocol_version = match requested {
                "2025-06-18" | "2025-03-26" | "2024-11-05" => requested,
                _ => "2025-06-18",
            };
            jsonrpc_result(
                id_val,
                json!({
                    "protocolVersion": protocol_version,
                    "capabilities": {
                        "tools": {
                            "listChanged": false
                        }
                    },
                    "serverInfo": {
                        "name": "linear-pulse",
                        "version": ctx.app_version,
                    },
                    "instructions": "This is the user's local Linear Pulse backlog and issue cache. Keep the backlog ranked with the most important issues first, and write a concise one-line note per item explaining why it is ranked there. The ranking lives only in the user's local Linear Pulse app, not in Linear itself. The user decides what Claude works on, so do not start working on an issue just because it is ranked first. Issue state changes and comments posted through these tools go directly to Linear."
                }),
            )
        }
        "ping" => jsonrpc_result(id_val, json!({})),
        "tools/list" => jsonrpc_result(id_val, json!({ "tools": tool_definitions() })),
        "tools/call" => {
            let Some(params_obj) = params.as_object() else {
                return Some(jsonrpc_error(
                    id_val,
                    -32602,
                    "Invalid params: expected object",
                ));
            };
            let Some(tool_name) = params_obj.get("name").and_then(|v| v.as_str()) else {
                return Some(jsonrpc_error(
                    id_val,
                    -32602,
                    "Invalid params: missing tool 'name'",
                ));
            };
            let args = match params_obj.get("arguments") {
                None | Some(Value::Null) => json!({}),
                Some(Value::Object(_)) => params_obj["arguments"].clone(),
                Some(_) => {
                    return Some(jsonrpc_error(
                        id_val,
                        -32602,
                        "Invalid params: 'arguments' must be an object",
                    ));
                }
            };

            match dispatch_tool(ctx, tool_name, args).await {
                Ok(payload) => {
                    let text = serde_json::to_string_pretty(&payload)
                        .unwrap_or_else(|_| payload.to_string());
                    jsonrpc_result(
                        id_val,
                        json!({
                            "content": [{ "type": "text", "text": text }],
                            "isError": false,
                        }),
                    )
                }
                Err(ToolError::UnknownTool(name)) => {
                    jsonrpc_error(id_val, -32602, format!("Unknown tool: {name}"))
                }
                Err(ToolError::Execution(msg)) => jsonrpc_result(
                    id_val,
                    json!({
                        "content": [{ "type": "text", "text": msg }],
                        "isError": true,
                    }),
                ),
            }
        }
        _ => jsonrpc_error(id_val, -32601, format!("Method not found: {method}")),
    };

    Some(resp)
}

enum ToolError {
    UnknownTool(String),
    Execution(String),
}

impl From<String> for ToolError {
    fn from(s: String) -> Self {
        ToolError::Execution(s)
    }
}

fn tool_definitions() -> Value {
    json!([
        {
            "name": "get_backlog",
            "description": "Return the user's current ranked backlog from the local Linear Pulse database, ordered from rank 1 downwards. Use this first to see what is already prioritized and read the existing ranking notes. Backlog ranking is stored only in the user's local Linear Pulse app (not in Linear).",
            "inputSchema": {
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }
        },
        {
            "name": "get_changes_since_last_rank",
            "description": "Return cached Linear issues updated since the last backlog rank (up to 100, newest first), including any recent comments. Use it before reranking, to see what changed.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "since": {
                        "type": "string",
                        "description": "Optional RFC3339 timestamp cutoff. Defaults to the most recent of the last succeeded rerank and the latest backlog update, or 7 days ago."
                    }
                }
            }
        },
        {
            "name": "get_rerank_request",
            "description": "Return the currently running rerank request (id, comment, started_at) if one is active, or {\"pending\": null}.",
            "inputSchema": {
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }
        },
        {
            "name": "list_issues",
            "description": "Search and filter Linear issues in the local cache by text query, team, project, state type, or assignee. Use this to discover candidate issues before ranking them with set_backlog or add_to_backlog. Backlog ranking is stored only in the user's local app.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Case-insensitive substring match against identifier, title, description, project, assignee, state, or labels."
                    },
                    "team": {
                        "type": "string",
                        "description": "Team key (e.g. ENG) or team name."
                    },
                    "project": {
                        "type": "string",
                        "description": "Project name (substring match, case-insensitive)."
                    },
                    "state_type": {
                        "type": "string",
                        "description": "Linear workflow state type: triage, backlog, unstarted, started, completed, or canceled."
                    },
                    "assignee": {
                        "type": "string",
                        "description": "Filter by assignee: 'me' for the current viewer, 'none' for unassigned, or an assignee name."
                    },
                    "include_closed": {
                        "type": "boolean",
                        "description": "Include completed and canceled issues (default false)."
                    },
                    "only_unranked": {
                        "type": "boolean",
                        "description": "Only return issues not currently in the local backlog (default false)."
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of issues to return (default 50, max 200)."
                    }
                }
            }
        },
        {
            "name": "get_issue",
            "description": "Fetch full details for a Linear issue by identifier (e.g. ENG-123), including description, labels, the last 10 comments, and its current local backlog rank. If not in the local cache, fetches it from Linear and caches it locally.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "identifier": {
                        "type": "string",
                        "description": "Human issue identifier, e.g. ENG-123."
                    }
                },
                "required": ["identifier"]
            }
        },
        {
            "name": "set_backlog",
            "description": "Replace the entire local ranked backlog order in one atomic operation. Most important issue first, with a concise one-line note per item explaining the ranking. Preserves an existing note if note is omitted. Backlog ranking is stored only in the user's local Linear Pulse app; the user decides what Claude works on.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "items": {
                        "type": "array",
                        "description": "Ordered list of issues from rank 1 (most important) onwards.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "identifier": {
                                    "type": "string",
                                    "description": "Human issue identifier, e.g. ENG-123."
                                },
                                "note": {
                                    "type": "string",
                                    "description": "One-line rationale for this item's rank."
                                }
                            },
                            "required": ["identifier"]
                        }
                    },
                    "summary": {
                        "type": "string",
                        "description": "Optional short summary of the ranking changes."
                    }
                },
                "required": ["items"]
            }
        },
        {
            "name": "add_to_backlog",
            "description": "Add an issue to the local ranked backlog at an optional 1-based position (defaults to the end), or move it there if already present, optionally setting its ranking note. Backlog ranking is stored only in the user's local app.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "identifier": {
                        "type": "string",
                        "description": "Human issue identifier, e.g. ENG-123."
                    },
                    "position": {
                        "type": "integer",
                        "description": "1-based target rank (omit or past end to append)."
                    },
                    "note": {
                        "type": "string",
                        "description": "One-line rationale for this item's rank."
                    }
                },
                "required": ["identifier"]
            }
        },
        {
            "name": "move_backlog_item",
            "description": "Move an issue already in the local backlog to a new 1-based rank, clamping to the list bounds. Backlog ranking is stored only in the user's local app.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "identifier": {
                        "type": "string",
                        "description": "Human issue identifier, e.g. ENG-123."
                    },
                    "position": {
                        "type": "integer",
                        "description": "1-based target rank."
                    }
                },
                "required": ["identifier", "position"]
            }
        },
        {
            "name": "remove_from_backlog",
            "description": "Remove an issue from the local ranked backlog and renumber remaining items. Does not delete or modify the issue in Linear; backlog ranking is stored only in the user's local app.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "identifier": {
                        "type": "string",
                        "description": "Human issue identifier, e.g. ENG-123."
                    }
                },
                "required": ["identifier"]
            }
        },
        {
            "name": "set_issue_state",
            "description": "Update an issue's workflow state in Linear (e.g. 'In Progress', 'Done', or a state type like 'started'). Use only when updating real issue progress in Linear, not for local backlog ranking.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "identifier": {
                        "type": "string",
                        "description": "Human issue identifier, e.g. ENG-123."
                    },
                    "state": {
                        "type": "string",
                        "description": "Workflow state name in the issue's team (e.g. 'In Progress') or state type (e.g. 'started', 'completed')."
                    }
                },
                "required": ["identifier", "state"]
            }
        },
        {
            "name": "add_comment",
            "description": "Post a markdown comment on an issue in Linear. Use this to leave status updates, questions, or summaries visible to the team in Linear.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "identifier": {
                        "type": "string",
                        "description": "Human issue identifier, e.g. ENG-123."
                    },
                    "body": {
                        "type": "string",
                        "description": "Markdown comment body to post to Linear."
                    }
                },
                "required": ["identifier", "body"]
            }
        }
    ])
}

async fn dispatch_tool(ctx: &Arc<McpContext>, name: &str, args: Value) -> Result<Value, ToolError> {
    match name {
        "get_backlog" => tool_get_backlog(ctx).map_err(ToolError::Execution),
        "get_changes_since_last_rank" => {
            tool_get_changes_since_last_rank(ctx, args).map_err(ToolError::Execution)
        }
        "get_rerank_request" => tool_get_rerank_request(ctx).map_err(ToolError::Execution),
        "list_issues" => tool_list_issues(ctx, args).map_err(ToolError::Execution),
        "get_issue" => tool_get_issue(ctx, args).await.map_err(ToolError::Execution),
        "set_backlog" => tool_set_backlog(ctx, args).await.map_err(ToolError::Execution),
        "add_to_backlog" => tool_add_to_backlog(ctx, args)
            .await
            .map_err(ToolError::Execution),
        "move_backlog_item" => tool_move_backlog_item(ctx, args)
            .await
            .map_err(ToolError::Execution),
        "remove_from_backlog" => tool_remove_from_backlog(ctx, args).map_err(ToolError::Execution),
        "set_issue_state" => tool_set_issue_state(ctx, args)
            .await
            .map_err(ToolError::Execution),
        "add_comment" => tool_add_comment(ctx, args)
            .await
            .map_err(ToolError::Execution),
        other => Err(ToolError::UnknownTool(other.to_string())),
    }
}

fn require_non_empty_str<'a>(args: &'a Value, key: &str) -> Result<&'a str, String> {
    args.get(key)
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| format!("Missing or empty required string parameter '{key}'."))
}

fn build_backlog_payload(conn: &Connection) -> Result<Value, String> {
    let settings = db::load_settings(conn).map_err(|e| e.to_string())?;
    let entries: Vec<BacklogEntry> = db::load_backlog(conn).map_err(|e| e.to_string())?;
    let issues = db::load_issues(
        conn,
        settings.viewer_id.as_deref(),
        settings.viewer_name.as_deref(),
    )
    .map_err(|e| e.to_string())?;

    let issue_map: HashMap<String, LinearIssue> =
        issues.into_iter().map(|i| (i.id.clone(), i)).collect();

    let items: Vec<Value> = entries
        .into_iter()
        .map(|entry| {
            if let Some(issue) = issue_map.get(&entry.issue_id) {
                json!({
                    "rank": entry.position,
                    "identifier": issue.identifier,
                    "title": issue.title,
                    "state": issue.state_name,
                    "state_type": issue.state_type,
                    "priority_label": issue.priority_label,
                    "assignee": issue.assignee_name,
                    "project": issue.project_name,
                    "team_key": issue.team_key,
                    "url": issue.url,
                    "note": entry.note,
                    "added_by": entry.added_by,
                    "updated_at": entry.updated_at,
                })
            } else {
                json!({
                    "rank": entry.position,
                    "identifier": entry.issue_id,
                    "title": "(not synced)",
                    "state": Value::Null,
                    "state_type": Value::Null,
                    "priority_label": Value::Null,
                    "assignee": Value::Null,
                    "project": Value::Null,
                    "team_key": Value::Null,
                    "url": Value::Null,
                    "note": entry.note,
                    "added_by": entry.added_by,
                    "updated_at": entry.updated_at,
                })
            }
        })
        .collect();

    Ok(Value::Array(items))
}

fn tool_get_backlog(ctx: &Arc<McpContext>) -> Result<Value, String> {
    let conn = ctx.db.lock().map_err(|e| e.to_string())?;
    build_backlog_payload(&conn)
}

fn parse_rfc3339_utc(raw: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(raw.trim())
        .ok()
        .map(|dt| dt.with_timezone(&Utc))
}

fn cmp_timestamps_asc(a: &str, b: &str) -> std::cmp::Ordering {
    match (parse_rfc3339_utc(a), parse_rfc3339_utc(b)) {
        (Some(ad), Some(bd)) => ad.cmp(&bd),
        _ => a.cmp(b),
    }
}

fn is_after_since(ts: &str, since_dt: DateTime<Utc>, since_str: &str) -> bool {
    if let Some(dt) = parse_rfc3339_utc(ts) {
        dt > since_dt
    } else {
        ts > since_str
    }
}

fn tool_get_changes_since_last_rank(ctx: &Arc<McpContext>, args: Value) -> Result<Value, String> {
    let explicit_since = match args.get("since") {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) => {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                None
            } else {
                let dt = parse_rfc3339_utc(trimmed).ok_or_else(|| {
                    format!("Invalid RFC3339 timestamp for 'since': {trimmed}")
                })?;
                Some((dt, trimmed.to_string()))
            }
        }
        Some(_) => return Err("Parameter 'since' must be an RFC3339 string.".to_string()),
    };

    let (since_dt, since_str, issues, backlog) = {
        let conn = ctx.db.lock().map_err(|e| e.to_string())?;
        let (since_dt, since_str) = match explicit_since {
            Some(pair) => pair,
            None => {
                let rerank_ts = db::latest_rerank_finished_at(&conn).map_err(|e| e.to_string())?;
                let backlog_ts = db::latest_backlog_updated_at(&conn).map_err(|e| e.to_string())?;
                let best_dt = [rerank_ts, backlog_ts]
                    .into_iter()
                    .flatten()
                    .filter_map(|s| parse_rfc3339_utc(&s))
                    .max()
                    .unwrap_or_else(|| Utc::now() - Duration::days(7));
                let s = best_dt.to_rfc3339_opts(SecondsFormat::Millis, true);
                (best_dt, s)
            }
        };

        let settings = db::load_settings(&conn).map_err(|e| e.to_string())?;
        let issues = db::load_issues(
            &conn,
            settings.viewer_id.as_deref(),
            settings.viewer_name.as_deref(),
        )
        .map_err(|e| e.to_string())?;
        let backlog = db::load_backlog(&conn).map_err(|e| e.to_string())?;
        (since_dt, since_str, issues, backlog)
    };

    let rank_by_id: HashMap<String, i64> = backlog
        .into_iter()
        .map(|b| (b.issue_id, b.position))
        .collect();

    let mut changed: Vec<LinearIssue> = issues
        .into_iter()
        .filter(|issue| is_after_since(&issue.updated_at, since_dt, &since_str))
        .collect();

    changed.sort_by(|a, b| cmp_timestamps_asc(&b.updated_at, &a.updated_at));

    let results: Vec<Value> = changed
        .into_iter()
        .take(100)
        .map(|issue| {
            let newest_comment = issue
                .comments
                .iter()
                .max_by(|a, b| cmp_timestamps_asc(&a.created_at, &b.created_at))
                .filter(|c| is_after_since(&c.created_at, since_dt, &since_str))
                .map(|c| {
                    let excerpt: String = c.body.chars().take(300).collect();
                    json!({
                        "author": c.author_name,
                        "created_at": c.created_at,
                        "body": excerpt,
                    })
                });

            json!({
                "identifier": issue.identifier,
                "title": issue.title,
                "state": issue.state_name,
                "state_type": issue.state_type,
                "priority_label": issue.priority_label,
                "assignee": issue.assignee_name,
                "updated_at": issue.updated_at,
                "in_backlog_rank": rank_by_id.get(&issue.id).copied(),
                "newest_comment": newest_comment,
            })
        })
        .collect();

    Ok(Value::Array(results))
}

fn tool_get_rerank_request(ctx: &Arc<McpContext>) -> Result<Value, String> {
    let conn = ctx.db.lock().map_err(|e| e.to_string())?;
    match db::latest_running_rerank_run(&conn).map_err(|e| e.to_string())? {
        Some(run) => Ok(json!({
            "id": run.id,
            "comment": run.comment,
            "started_at": run.started_at,
        })),
        None => Ok(json!({ "pending": Value::Null })),
    }
}

fn priority_sort_rank(priority: i64) -> i64 {
    if (1..=4).contains(&priority) {
        priority
    } else {
        5
    }
}

fn is_closed_state(state_type: &str) -> bool {
    matches!(
        state_type.trim().to_lowercase().as_str(),
        "completed" | "canceled" | "cancelled"
    )
}

fn tool_list_issues(ctx: &Arc<McpContext>, args: Value) -> Result<Value, String> {
    let query = args
        .get("query")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_lowercase);
    let team = args
        .get("team")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let project = args
        .get("project")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_lowercase);
    let state_type = args
        .get("state_type")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let assignee = args
        .get("assignee")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let include_closed = args
        .get("include_closed")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let only_unranked = args
        .get("only_unranked")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let limit = args
        .get("limit")
        .and_then(|v| v.as_i64())
        .unwrap_or(50)
        .clamp(1, 200) as usize;

    let (settings, issues, backlog) = {
        let conn = ctx.db.lock().map_err(|e| e.to_string())?;
        let settings = db::load_settings(&conn).map_err(|e| e.to_string())?;
        let issues = db::load_issues(
            &conn,
            settings.viewer_id.as_deref(),
            settings.viewer_name.as_deref(),
        )
        .map_err(|e| e.to_string())?;
        let backlog = db::load_backlog(&conn).map_err(|e| e.to_string())?;
        (settings, issues, backlog)
    };

    let rank_by_id: HashMap<String, i64> = backlog
        .into_iter()
        .map(|b| (b.issue_id, b.position))
        .collect();

    let mut filtered: Vec<LinearIssue> = issues
        .into_iter()
        .filter(|issue| {
            if !include_closed && is_closed_state(&issue.state_type) {
                return false;
            }
            if only_unranked && rank_by_id.contains_key(&issue.id) {
                return false;
            }
            if let Some(ref t) = team {
                if !issue.team_key.eq_ignore_ascii_case(t)
                    && !issue.team_name.eq_ignore_ascii_case(t)
                {
                    return false;
                }
            }
            if let Some(ref p) = project {
                let matches = issue
                    .project_name
                    .as_deref()
                    .map(|name| name.to_lowercase().contains(p))
                    .unwrap_or(false);
                if !matches {
                    return false;
                }
            }
            if let Some(ref st) = state_type {
                if !issue.state_type.eq_ignore_ascii_case(st) {
                    return false;
                }
            }
            if let Some(ref a) = assignee {
                if a.eq_ignore_ascii_case("none") {
                    if issue.assignee_id.is_some() || issue.assignee_name.is_some() {
                        return false;
                    }
                } else if a.eq_ignore_ascii_case("me") {
                    let is_me_id = settings
                        .viewer_id
                        .as_deref()
                        .filter(|s| !s.is_empty())
                        .is_some_and(|vid| issue.assignee_id.as_deref() == Some(vid));
                    let is_me_name = settings
                        .viewer_name
                        .as_deref()
                        .filter(|s| !s.is_empty())
                        .is_some_and(|vname| {
                            issue
                                .assignee_name
                                .as_deref()
                                .is_some_and(|aname| aname.eq_ignore_ascii_case(vname))
                        });
                    if !is_me_id && !is_me_name {
                        return false;
                    }
                } else {
                    let a_lower = a.to_lowercase();
                    let matches = issue
                        .assignee_name
                        .as_deref()
                        .map(|name| name.to_lowercase().contains(&a_lower))
                        .unwrap_or(false);
                    if !matches {
                        return false;
                    }
                }
            }
            if let Some(ref q) = query {
                let haystack = [
                    issue.identifier.as_str(),
                    issue.title.as_str(),
                    issue.description.as_deref().unwrap_or(""),
                    issue.project_name.as_deref().unwrap_or(""),
                    issue.assignee_name.as_deref().unwrap_or(""),
                    issue.team_key.as_str(),
                    issue.team_name.as_str(),
                    issue.state_name.as_str(),
                ];
                let hit = haystack.iter().any(|s| s.to_lowercase().contains(q))
                    || issue.labels.iter().any(|l| l.to_lowercase().contains(q));
                if !hit {
                    return false;
                }
            }
            true
        })
        .collect();

    filtered.sort_by(|a, b| {
        priority_sort_rank(a.priority)
            .cmp(&priority_sort_rank(b.priority))
            .then_with(|| b.updated_at.cmp(&a.updated_at))
    });

    let results: Vec<Value> = filtered
        .into_iter()
        .take(limit)
        .map(|issue| {
            let preview = issue
                .description
                .as_deref()
                .map(|d| d.chars().take(200).collect::<String>());
            json!({
                "identifier": issue.identifier,
                "title": issue.title,
                "state": issue.state_name,
                "state_type": issue.state_type,
                "priority_label": issue.priority_label,
                "assignee": issue.assignee_name,
                "project": issue.project_name,
                "team_key": issue.team_key,
                "updated_at": issue.updated_at,
                "in_backlog_rank": rank_by_id.get(&issue.id).copied(),
                "description_preview": preview,
            })
        })
        .collect();

    Ok(Value::Array(results))
}

async fn resolve_or_fetch_issue(
    ctx: &Arc<McpContext>,
    identifier: &str,
) -> Result<(LinearIssue, db::AppSettings), String> {
    let trimmed = identifier.trim();
    let (settings, cached) = {
        let conn = ctx.db.lock().map_err(|e| e.to_string())?;
        let settings = db::load_settings(&conn).map_err(|e| e.to_string())?;
        let cached = if let Some(id) =
            db::find_issue_id_by_identifier(&conn, trimmed).map_err(|e| e.to_string())?
        {
            db::load_issues(
                &conn,
                settings.viewer_id.as_deref(),
                settings.viewer_name.as_deref(),
            )
            .map_err(|e| e.to_string())?
            .into_iter()
            .find(|i| i.id == id)
        } else {
            None
        };
        (settings, cached)
    };

    if let Some(issue) = cached {
        return Ok((issue, settings));
    }

    let fetched = linear::fetch_single_issue(&settings.linear_api_key, trimmed).await?;
    let viewer_id = settings.viewer_id.clone().unwrap_or_default();
    let viewer_name = settings.viewer_name.clone().unwrap_or_default();

    {
        let mut conn = ctx.db.lock().map_err(|e| e.to_string())?;
        db::upsert_issues_batch(&mut conn, &[fetched.clone()], &viewer_id, &viewer_name, false)
            .map_err(|e| e.to_string())?;
    }
    (ctx.notify)("issues-changed");

    Ok((fetched, settings))
}

async fn tool_get_issue(ctx: &Arc<McpContext>, args: Value) -> Result<Value, String> {
    let identifier = require_non_empty_str(&args, "identifier")?;
    let (mut issue, _settings) = resolve_or_fetch_issue(ctx, identifier).await?;

    let in_backlog_rank = {
        let conn = ctx.db.lock().map_err(|e| e.to_string())?;
        db::load_backlog(&conn)
            .map_err(|e| e.to_string())?
            .into_iter()
            .find(|b| b.issue_id == issue.id)
            .map(|b| b.position)
    };

    issue
        .comments
        .sort_by(|a, b| a.created_at.cmp(&b.created_at));
    let start = issue.comments.len().saturating_sub(10);
    let recent_comments: Vec<Value> = issue.comments[start..]
        .iter()
        .map(|c| {
            json!({
                "author": c.author_name,
                "created_at": c.created_at,
                "body": c.body,
            })
        })
        .collect();

    Ok(json!({
        "identifier": issue.identifier,
        "title": issue.title,
        "description": issue.description,
        "state": issue.state_name,
        "state_type": issue.state_type,
        "priority_label": issue.priority_label,
        "assignee": issue.assignee_name,
        "project": issue.project_name,
        "team_key": issue.team_key,
        "team_name": issue.team_name,
        "url": issue.url,
        "labels": issue.labels,
        "updated_at": issue.updated_at,
        "created_at": issue.created_at,
        "in_backlog_rank": in_backlog_rank,
        "comments": recent_comments,
    }))
}

async fn tool_set_backlog(ctx: &Arc<McpContext>, args: Value) -> Result<Value, String> {
    let raw_items = args
        .get("items")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "Missing or invalid required array parameter 'items'.".to_string())?;

    let mut parsed_items: Vec<(String, Option<String>)> = Vec::with_capacity(raw_items.len());
    let mut seen_idents: HashSet<String> = HashSet::new();
    let mut duplicates: Vec<String> = Vec::new();

    for (idx, item) in raw_items.iter().enumerate() {
        let obj = item
            .as_object()
            .ok_or_else(|| format!("items[{idx}] must be an object."))?;
        let ident = obj
            .get("identifier")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| format!("items[{idx}].identifier must be a non-empty string."))?;
        let note = match obj.get("note") {
            None | Some(Value::Null) => None,
            Some(Value::String(s)) => Some(s.clone()),
            Some(_) => return Err(format!("items[{idx}].note must be a string.")),
        };
        let key = ident.to_uppercase();
        if !seen_idents.insert(key) {
            duplicates.push(ident.to_string());
        }
        parsed_items.push((ident.to_string(), note));
    }

    if !duplicates.is_empty() {
        return Err(format!(
            "Duplicate identifiers are not allowed: {}",
            duplicates.join(", ")
        ));
    }

    // Check local cache first.
    let (settings, mut resolved_map) = {
        let conn = ctx.db.lock().map_err(|e| e.to_string())?;
        let settings = db::load_settings(&conn).map_err(|e| e.to_string())?;
        let mut map: HashMap<String, String> = HashMap::new();
        for (ident, _) in &parsed_items {
            if let Some(id) =
                db::find_issue_id_by_identifier(&conn, ident).map_err(|e| e.to_string())?
            {
                map.insert(ident.to_uppercase(), id);
            }
        }
        (settings, map)
    };

    // Fetch missing issues from Linear outside the mutex.
    let mut fetched_issues: Vec<LinearIssue> = Vec::new();
    let mut bad_identifiers: Vec<String> = Vec::new();

    for (ident, _) in &parsed_items {
        let key = ident.to_uppercase();
        if resolved_map.contains_key(&key) {
            continue;
        }
        match linear::fetch_single_issue(&settings.linear_api_key, ident).await {
            Ok(issue) => {
                resolved_map.insert(key, issue.id.clone());
                fetched_issues.push(issue);
            }
            Err(_) => {
                bad_identifiers.push(ident.clone());
            }
        }
    }

    if !fetched_issues.is_empty() {
        let viewer_id = settings.viewer_id.clone().unwrap_or_default();
        let viewer_name = settings.viewer_name.clone().unwrap_or_default();
        {
            let mut conn = ctx.db.lock().map_err(|e| e.to_string())?;
            db::upsert_issues_batch(&mut conn, &fetched_issues, &viewer_id, &viewer_name, false)
                .map_err(|e| e.to_string())?;
        }
        (ctx.notify)("issues-changed");
    }

    if !bad_identifiers.is_empty() {
        return Err(format!(
            "Could not resolve issue identifier(s): {}. Backlog was not changed.",
            bad_identifiers.join(", ")
        ));
    }

    let mut seen_ids = HashSet::new();
    let mut final_items: Vec<(String, Option<String>)> = Vec::with_capacity(parsed_items.len());
    for (ident, note) in parsed_items {
        let id = resolved_map
            .get(&ident.to_uppercase())
            .cloned()
            .ok_or_else(|| format!("Failed to resolve {ident}"))?;
        if !seen_ids.insert(id.clone()) {
            return Err(format!("Duplicate issue resolved for '{ident}'."));
        }
        final_items.push((id, note));
    }

    let payload = {
        let mut conn = ctx.db.lock().map_err(|e| e.to_string())?;
        db::replace_backlog(&mut conn, &final_items, "claude").map_err(|e| e.to_string())?;
        build_backlog_payload(&conn)?
    };

    (ctx.notify)("backlog-changed");
    Ok(payload)
}

async fn tool_add_to_backlog(ctx: &Arc<McpContext>, args: Value) -> Result<Value, String> {
    let identifier = require_non_empty_str(&args, "identifier")?;
    let position = match args.get("position") {
        None | Some(Value::Null) => None,
        Some(v) => Some(
            v.as_i64()
                .ok_or_else(|| "Parameter 'position' must be an integer.".to_string())?,
        ),
    };
    let note = match args.get("note") {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) => Some(s.clone()),
        Some(_) => return Err("Parameter 'note' must be a string.".to_string()),
    };

    let (issue, _) = resolve_or_fetch_issue(ctx, identifier).await?;

    let payload = {
        let mut conn = ctx.db.lock().map_err(|e| e.to_string())?;
        db::add_to_backlog(&mut conn, &issue.id, position, note, "claude")
            .map_err(|e| e.to_string())?;
        build_backlog_payload(&conn)?
    };

    (ctx.notify)("backlog-changed");
    Ok(payload)
}

async fn tool_move_backlog_item(ctx: &Arc<McpContext>, args: Value) -> Result<Value, String> {
    let identifier = require_non_empty_str(&args, "identifier")?;
    let position = args
        .get("position")
        .and_then(|v| v.as_i64())
        .ok_or_else(|| "Missing or invalid required integer parameter 'position'.".to_string())?;

    let (issue, _) = resolve_or_fetch_issue(ctx, identifier).await?;

    let payload = {
        let mut conn = ctx.db.lock().map_err(|e| e.to_string())?;
        let entries = db::load_backlog(&conn).map_err(|e| e.to_string())?;
        if !entries.iter().any(|e| e.issue_id == issue.id) {
            return Err(format!("Issue {} is not in the backlog.", issue.identifier));
        }
        db::move_backlog_item(&mut conn, &issue.id, position).map_err(|e| e.to_string())?;
        build_backlog_payload(&conn)?
    };

    (ctx.notify)("backlog-changed");
    Ok(payload)
}

fn tool_remove_from_backlog(ctx: &Arc<McpContext>, args: Value) -> Result<Value, String> {
    let identifier = require_non_empty_str(&args, "identifier")?;

    let payload = {
        let mut conn = ctx.db.lock().map_err(|e| e.to_string())?;
        let issue_id = if let Some(id) =
            db::find_issue_id_by_identifier(&conn, identifier).map_err(|e| e.to_string())?
        {
            id
        } else {
            let entries = db::load_backlog(&conn).map_err(|e| e.to_string())?;
            entries
                .into_iter()
                .find(|e| e.issue_id.eq_ignore_ascii_case(identifier))
                .map(|e| e.issue_id)
                .ok_or_else(|| format!("Issue '{identifier}' was not found."))?
        };

        db::remove_from_backlog(&mut conn, &issue_id).map_err(|e| e.to_string())?;
        build_backlog_payload(&conn)?
    };

    (ctx.notify)("backlog-changed");
    Ok(payload)
}

async fn tool_set_issue_state(ctx: &Arc<McpContext>, args: Value) -> Result<Value, String> {
    let identifier = require_non_empty_str(&args, "identifier")?;
    let target_state = require_non_empty_str(&args, "state")?;

    let (issue, settings) = resolve_or_fetch_issue(ctx, identifier).await?;

    let mut meta = {
        let conn = ctx.db.lock().map_err(|e| e.to_string())?;
        db::load_workspace_meta(&conn).map_err(|e| e.to_string())?
    };

    if meta.teams.is_empty() {
        let (_viewer, fresh_meta) =
            linear::fetch_workspace_catalog(&settings.linear_api_key).await?;
        let conn = ctx.db.lock().map_err(|e| e.to_string())?;
        db::save_workspace_meta(&conn, &fresh_meta).map_err(|e| e.to_string())?;
        meta = fresh_meta;
    }

    let team = meta
        .teams
        .iter()
        .find(|t| t.id == issue.team_id || t.key.eq_ignore_ascii_case(&issue.team_key))
        .ok_or_else(|| {
            format!(
                "Team '{}' was not found in workspace metadata. Try syncing Linear in the app.",
                issue.team_key
            )
        })?;

    let matched_state = team
        .states
        .iter()
        .find(|s| s.name.eq_ignore_ascii_case(target_state))
        .or_else(|| {
            team.states
                .iter()
                .find(|s| s.state_type.eq_ignore_ascii_case(target_state))
        })
        .ok_or_else(|| {
            let available: Vec<String> = team
                .states
                .iter()
                .map(|s| format!("{} ({})", s.name, s.state_type))
                .collect();
            format!(
                "No workflow state matching '{target_state}' in team {}. Available: {}",
                team.key,
                available.join(", ")
            )
        })?;

    let patch = UpdateIssuePatch {
        title: None,
        description: None,
        state_id: Some(matched_state.id.clone()),
        priority: None,
        assignee_id: None,
        project_id: None,
        label_ids: None,
    };

    let updated =
        linear::update_linear_issue(&settings.linear_api_key, &issue.id, patch).await?;

    let viewer_id = settings.viewer_id.clone().unwrap_or_default();
    let viewer_name = settings.viewer_name.clone().unwrap_or_default();
    {
        let mut conn = ctx.db.lock().map_err(|e| e.to_string())?;
        db::upsert_issues_batch(&mut conn, &[updated.clone()], &viewer_id, &viewer_name, false)
            .map_err(|e| e.to_string())?;
    }
    (ctx.notify)("issues-changed");

    Ok(json!({
        "identifier": updated.identifier,
        "title": updated.title,
        "state": updated.state_name,
        "state_type": updated.state_type,
        "priority_label": updated.priority_label,
        "assignee": updated.assignee_name,
        "project": updated.project_name,
        "team_key": updated.team_key,
        "url": updated.url,
        "updated_at": updated.updated_at,
    }))
}

async fn tool_add_comment(ctx: &Arc<McpContext>, args: Value) -> Result<Value, String> {
    let identifier = require_non_empty_str(&args, "identifier")?;
    let body = require_non_empty_str(&args, "body")?;

    let (issue, settings) = resolve_or_fetch_issue(ctx, identifier).await?;

    let updated =
        linear::create_linear_comment(&settings.linear_api_key, &issue.id, body).await?;

    let viewer_id = settings.viewer_id.clone().unwrap_or_default();
    let viewer_name = settings.viewer_name.clone().unwrap_or_default();
    {
        let mut conn = ctx.db.lock().map_err(|e| e.to_string())?;
        db::upsert_issues_batch(&mut conn, &[updated], &viewer_id, &viewer_name, false)
            .map_err(|e| e.to_string())?;
    }
    (ctx.notify)("issues-changed");

    Ok(json!({ "ok": true }))
}
