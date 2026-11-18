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
                    "instructions": server_instructions()
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

/// Standing instructions sent to every Claude session that connects, including
/// the same ranking rules the Rerank button uses.
fn server_instructions() -> String {
    let mut parts = vec![
        "This is the user's local Linear Pulse backlog and issue cache. The ranking lives only in the user's local Linear Pulse app, not in Linear itself. The user decides what Claude works on, so do not start working on an issue just because it is ranked first. Issue state changes and comments posted through these tools go directly to Linear.".to_string(),
        "When asked to rank, rerank, reprioritise, groom or update the backlog, follow these rules (the same ones the app's Rerank button uses):".to_string(),
    ];
    parts.extend(crate::rerank::RANKING_RULES.iter().map(|s| s.to_string()));
    parts.push("If the user asked to add or remove specific issues, do that as part of the same set_backlog call, and finish with a short summary of what moved and why.".to_string());
    parts.join("\n\n")
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
            "description": "Replace the entire local ranked backlog order in one atomic operation. Most important issue first, with a concise one-line note per item explaining the ranking. Preserves an existing note if note is omitted. Backlog ranking is stored only in the user's local Linear Pulse app; the user decides what Claude works on. Cluster items that can ship together in ONE development session (same code area, shared dependencies, or one feature) with `group`, 2–5 items per group, and describe each group in `groups` with a one-line reason. List a group's items consecutively, in the order they should be worked; if you don't, each group is moved up to sit together at its highest-ranked member. Leave items ungrouped when they don't fit a group. Also tag items with an optional broader initiative label `theme` (one theme can hold several groups and single tickets, which ship in separate sessions), described in `themes` with a one-line reason; a group's members share one theme; keep a theme's items near each other when that doesn't push more important work down. The server enforces that no item sits above an open item that blocks it (Linear relations and suggestions), moving the blocked unit down below its blocker.",
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
                                },
                                "group": {
                                    "type": "string",
                                    "description": "Optional group name clustering items that can ship together in one dev session."
                                },
                                "theme": {
                                    "type": "string",
                                    "description": "Optional broader initiative name grouping related batches and single tickets across separate sessions."
                                },
                                "blocked_by": {
                                    "type": "array",
                                    "description": "Dependencies you inferred from the tickets that Linear doesn't record yet: this item can only be done after these. Stored locally as suggestions for the user to confirm; don't repeat Linear's own relations (get_backlog shows them).",
                                    "items": {
                                        "type": "object",
                                        "properties": {
                                            "identifier": {
                                                "type": "string",
                                                "description": "Human issue identifier of the blocking issue, e.g. ENG-123."
                                            },
                                            "reason": {
                                                "type": "string",
                                                "description": "One-line reason why that ticket must be done first."
                                            }
                                        },
                                        "required": ["identifier"]
                                    }
                                }
                            },
                            "required": ["identifier"]
                        }
                    },
                    "groups": {
                        "type": "array",
                        "description": "Optional group descriptions for groups referenced by items.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {
                                    "type": "string",
                                    "description": "Group name matching the `group` field on items."
                                },
                                "reason": {
                                    "type": "string",
                                    "description": "One-line reason these items belong together in one dev session."
                                }
                            },
                            "required": ["name"]
                        }
                    },
                    "themes": {
                        "type": "array",
                        "description": "Optional theme descriptions for themes referenced by items.",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {
                                    "type": "string",
                                    "description": "Theme name matching the `theme` field on items."
                                },
                                "reason": {
                                    "type": "string",
                                    "description": "One-line reason describing this broader initiative."
                                }
                            },
                            "required": ["name"]
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
        },
        {
            "name": "get_session_queue",
            "description": "Your work queue for a dev session started from Linear Pulse. Call at the start and again after finishing each item. James may add issues while you work.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "session_id": {
                        "type": "string",
                        "description": "The dev session id."
                    }
                },
                "required": ["session_id"]
            }
        },
        {
            "name": "update_session_item",
            "description": "Report progress on an issue in your dev session queue: in_progress when you start it, split when you hand it to a sub-session (note who/what), blocked (note what you need from James), done when finished per the repo workflow; done also removes the ticket from the local backlog.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "session_id": {
                        "type": "string",
                        "description": "The dev session id."
                    },
                    "issue": {
                        "type": "string",
                        "description": "Issue identifier (e.g. KAR-12) or Linear issue id."
                    },
                    "status": {
                        "type": "string",
                        "enum": ["in_progress", "split", "blocked", "done"],
                        "description": "Progress status for this issue in the dev session."
                    },
                    "note": {
                        "type": "string",
                        "description": "Optional note (e.g. sub-session details for split, or what is needed for blocked)."
                    }
                },
                "required": ["session_id", "issue", "status"]
            }
        }
    ])
}

async fn dispatch_tool(ctx: &Arc<McpContext>, name: &str, args: Value) -> Result<Value, ToolError> {
    match name {
        "get_backlog" => tool_get_backlog(ctx).await.map_err(ToolError::Execution),
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
        "get_session_queue" => tool_get_session_queue(ctx, args).map_err(ToolError::Execution),
        "update_session_item" => tool_update_session_item(ctx, args)
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

async fn refresh_backlog_dependencies(ctx: &Arc<McpContext>) -> Result<(), String> {
    let (api_key, backlog_ids) = {
        let conn = ctx.db.lock().map_err(|e| e.to_string())?;
        let settings = db::load_settings(&conn).map_err(|e| e.to_string())?;
        let entries = db::load_backlog(&conn).map_err(|e| e.to_string())?;
        let ids: Vec<String> = entries.into_iter().map(|e| e.issue_id).collect();
        (settings.linear_api_key, ids)
    };

    if backlog_ids.is_empty() {
        return Ok(());
    }

    let rels = linear::fetch_block_relations(&api_key, &backlog_ids).await?;
    let conn = ctx.db.lock().map_err(|e| e.to_string())?;
    db::replace_linear_dependencies(&conn, &backlog_ids, &rels).map_err(|e| e.to_string())?;
    Ok(())
}

fn build_backlog_payload(conn: &Connection) -> Result<Value, String> {
    let settings = db::load_settings(conn).map_err(|e| e.to_string())?;
    let entries: Vec<BacklogEntry> = db::load_backlog(conn).map_err(|e| e.to_string())?;
    let groups = db::load_backlog_groups(conn).map_err(|e| e.to_string())?;
    let themes = db::load_backlog_themes(conn).map_err(|e| e.to_string())?;
    let deps = db::load_dependencies(conn).map_err(|e| e.to_string())?;
    let active_rows = db::active_dev_session_for_issues(conn).map_err(|e| e.to_string())?;
    let issues = db::load_issues(
        conn,
        settings.viewer_id.as_deref(),
        settings.viewer_name.as_deref(),
    )
    .map_err(|e| e.to_string())?;

    let mut active_sessions: HashMap<String, Value> = HashMap::new();
    for (issue_id, session_id, session_name, item_status) in active_rows {
        active_sessions.entry(issue_id).or_insert_with(|| {
            json!({
                "id": session_id,
                "name": session_name,
                "item_status": item_status,
            })
        });
    }

    let issue_map: HashMap<String, LinearIssue> =
        issues.into_iter().map(|i| (i.id.clone(), i)).collect();
    let backlog_ids: HashSet<String> = entries.iter().map(|e| e.issue_id.clone()).collect();

    let mut blocked_by_map: HashMap<String, Vec<Value>> = HashMap::new();
    let mut blocks_map: HashMap<String, Vec<String>> = HashMap::new();
    for dep in deps {
        let blocker_ident = if !dep.blocker_identifier.is_empty() {
            dep.blocker_identifier.clone()
        } else {
            issue_map
                .get(&dep.blocker_id)
                .map(|i| i.identifier.clone())
                .unwrap_or_else(|| dep.blocker_id.clone())
        };
        let blocker_title = if !dep.blocker_title.is_empty() {
            dep.blocker_title.clone()
        } else {
            issue_map
                .get(&dep.blocker_id)
                .map(|i| i.title.clone())
                .unwrap_or_default()
        };
        blocked_by_map
            .entry(dep.issue_id.clone())
            .or_default()
            .push(json!({
                "identifier": blocker_ident,
                "title": blocker_title,
                "state": dep.blocker_state_name,
                "open": dep.blocker_open,
                "source": dep.source,
                "reason": dep.reason,
                "in_backlog": backlog_ids.contains(&dep.blocker_id),
            }));

        let blocked_ident = if !dep.issue_identifier.is_empty() {
            dep.issue_identifier.clone()
        } else {
            issue_map
                .get(&dep.issue_id)
                .map(|i| i.identifier.clone())
                .unwrap_or_else(|| dep.issue_id.clone())
        };
        blocks_map
            .entry(dep.blocker_id)
            .or_default()
            .push(blocked_ident);
    }

    let items: Vec<Value> = entries
        .into_iter()
        .map(|entry| {
            let dev_session = active_sessions
                .get(&entry.issue_id)
                .cloned()
                .unwrap_or(Value::Null);
            let blocked_by = blocked_by_map
                .remove(&entry.issue_id)
                .unwrap_or_default();
            let blocks = blocks_map.remove(&entry.issue_id).unwrap_or_default();
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
                    "group": entry.group_name,
                    "theme": entry.theme_name,
                    "dev_session": dev_session,
                    "blocked_by": blocked_by,
                    "blocks": blocks,
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
                    "group": entry.group_name,
                    "theme": entry.theme_name,
                    "dev_session": dev_session,
                    "blocked_by": blocked_by,
                    "blocks": blocks,
                    "added_by": entry.added_by,
                    "updated_at": entry.updated_at,
                })
            }
        })
        .collect();

    Ok(json!({
        "items": items,
        "groups": groups,
        "themes": themes,
    }))
}

async fn tool_get_backlog(ctx: &Arc<McpContext>) -> Result<Value, String> {
    let refresh_err = refresh_backlog_dependencies(ctx).await.err();
    let conn = ctx.db.lock().map_err(|e| e.to_string())?;
    let mut payload = build_backlog_payload(&conn)?;
    if let Some(err) = refresh_err {
        if let Some(obj) = payload.as_object_mut() {
            obj.insert("dependency_refresh_error".to_string(), json!(err));
        }
    }
    Ok(payload)
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

    let (in_backlog_rank, blocked_by, blocks) = {
        let conn = ctx.db.lock().map_err(|e| e.to_string())?;
        let backlog = db::load_backlog(&conn).map_err(|e| e.to_string())?;
        let in_backlog_rank = backlog
            .iter()
            .find(|b| b.issue_id == issue.id)
            .map(|b| b.position);
        let backlog_ids: HashSet<String> = backlog.into_iter().map(|b| b.issue_id).collect();
        let deps = db::load_dependencies(&conn).map_err(|e| e.to_string())?;

        let db_by_blocker: HashMap<String, &db::IssueDependency> = deps
            .iter()
            .filter(|d| d.issue_id == issue.id)
            .map(|d| (d.blocker_id.clone(), d))
            .collect();

        let mut blocked_by: Vec<Value> = Vec::new();
        let mut seen_blocker_ids: HashSet<String> = HashSet::new();
        let mut seen_blocker_idents: HashSet<String> = HashSet::new();

        for link in &issue.links {
            if link.kind != "blocked_by" {
                continue;
            }
            let ident = link
                .identifier
                .clone()
                .unwrap_or_else(|| link.id.clone());
            seen_blocker_ids.insert(link.id.clone());
            seen_blocker_idents.insert(ident.to_uppercase());
            let reason = db_by_blocker
                .get(&link.id)
                .map(|d| d.reason.clone())
                .unwrap_or_default();
            let state = link.state_name.clone().unwrap_or_default();
            let open = db::is_state_open(link.state_type.as_deref().unwrap_or(""));
            blocked_by.push(json!({
                "identifier": ident,
                "title": link.title,
                "state": state,
                "open": open,
                "source": "linear",
                "reason": reason,
                "in_backlog": backlog_ids.contains(&link.id),
            }));
        }

        for dep in &deps {
            if dep.issue_id != issue.id {
                continue;
            }
            let ident = if !dep.blocker_identifier.is_empty() {
                dep.blocker_identifier.clone()
            } else {
                dep.blocker_id.clone()
            };
            if seen_blocker_ids.contains(&dep.blocker_id)
                || seen_blocker_idents.contains(&ident.to_uppercase())
            {
                continue;
            }
            seen_blocker_ids.insert(dep.blocker_id.clone());
            seen_blocker_idents.insert(ident.to_uppercase());
            blocked_by.push(json!({
                "identifier": ident,
                "title": dep.blocker_title,
                "state": dep.blocker_state_name,
                "open": dep.blocker_open,
                "source": dep.source,
                "reason": dep.reason,
                "in_backlog": backlog_ids.contains(&dep.blocker_id),
            }));
        }

        let mut blocks: Vec<String> = Vec::new();
        let mut seen_blocks: HashSet<String> = HashSet::new();
        for link in &issue.links {
            if link.kind != "blocks" {
                continue;
            }
            let ident = link
                .identifier
                .clone()
                .unwrap_or_else(|| link.id.clone());
            if seen_blocks.insert(ident.to_uppercase()) {
                blocks.push(ident);
            }
        }
        for dep in &deps {
            if dep.blocker_id != issue.id {
                continue;
            }
            let ident = if !dep.issue_identifier.is_empty() {
                dep.issue_identifier.clone()
            } else {
                dep.issue_id.clone()
            };
            if seen_blocks.insert(ident.to_uppercase()) {
                blocks.push(ident);
            }
        }

        (in_backlog_rank, blocked_by, blocks)
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
        "blocked_by": blocked_by,
        "blocks": blocks,
        "comments": recent_comments,
    }))
}

fn parse_optional_item_label(
    obj: &serde_json::Map<String, Value>,
    idx: usize,
    field: &str,
) -> Result<Option<String>, String> {
    match obj.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => {
            let trimmed = s.trim();
            if trimmed.is_empty() {
                Ok(None)
            } else {
                Ok(Some(trimmed.to_string()))
            }
        }
        Some(_) => Err(format!("items[{idx}].{field} must be a string.")),
    }
}

fn parse_label_defs(args: &Value, key: &str) -> Result<Vec<(String, String)>, String> {
    match args.get(key) {
        None | Some(Value::Null) => Ok(Vec::new()),
        Some(Value::Array(arr)) => {
            let mut out = Vec::with_capacity(arr.len());
            for (idx, item) in arr.iter().enumerate() {
                let obj = item
                    .as_object()
                    .ok_or_else(|| format!("{key}[{idx}] must be an object."))?;
                let name = match obj.get("name") {
                    None | Some(Value::Null) => "",
                    Some(Value::String(s)) => s.trim(),
                    Some(_) => return Err(format!("{key}[{idx}].name must be a string.")),
                };
                if name.is_empty() {
                    continue;
                }
                let reason = match obj.get("reason") {
                    None | Some(Value::Null) => String::new(),
                    Some(Value::String(s)) => s.trim().to_string(),
                    Some(_) => return Err(format!("{key}[{idx}].reason must be a string.")),
                };
                out.push((name.to_string(), reason));
            }
            Ok(out)
        }
        Some(_) => Err(format!("Parameter '{key}' must be an array.")),
    }
}

fn parse_optional_blocked_by(
    obj: &serde_json::Map<String, Value>,
    idx: usize,
) -> Result<Option<Vec<(String, String)>>, String> {
    let Some(raw) = obj.get("blocked_by") else {
        return Ok(None);
    };
    if raw.is_null() {
        return Ok(None);
    }
    let arr = raw
        .as_array()
        .ok_or_else(|| format!("items[{idx}].blocked_by must be an array."))?;
    let mut out = Vec::with_capacity(arr.len());
    for (b_idx, entry) in arr.iter().enumerate() {
        let b_obj = entry
            .as_object()
            .ok_or_else(|| format!("items[{idx}].blocked_by[{b_idx}] must be an object."))?;
        let ident = b_obj
            .get("identifier")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                format!("items[{idx}].blocked_by[{b_idx}].identifier must be a non-empty string.")
            })?;
        let reason = match b_obj.get("reason") {
            None | Some(Value::Null) => String::new(),
            Some(Value::String(s)) => s.trim().to_string(),
            Some(_) => {
                return Err(format!(
                    "items[{idx}].blocked_by[{b_idx}].reason must be a string."
                ))
            }
        };
        out.push((ident.to_string(), reason));
    }
    Ok(Some(out))
}

async fn tool_set_backlog(ctx: &Arc<McpContext>, args: Value) -> Result<Value, String> {
    let raw_items = args
        .get("items")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "Missing or invalid required array parameter 'items'.".to_string())?;

    let mut parsed_items: Vec<db::RankedItem> = Vec::with_capacity(raw_items.len());
    let mut parsed_blocked_by: Vec<Option<Vec<(String, String)>>> =
        Vec::with_capacity(raw_items.len());
    let mut seen_idents: HashSet<String> = HashSet::new();
    let mut duplicates: Vec<String> = Vec::new();
    let mut all_idents_to_resolve: Vec<String> = Vec::new();
    let mut seen_resolve_keys: HashSet<String> = HashSet::new();

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
        let group = parse_optional_item_label(obj, idx, "group")?;
        let theme = parse_optional_item_label(obj, idx, "theme")?;
        let blocked_by = parse_optional_blocked_by(obj, idx)?;
        let key = ident.to_uppercase();
        if !seen_idents.insert(key.clone()) {
            duplicates.push(ident.to_string());
        }
        if seen_resolve_keys.insert(key) {
            all_idents_to_resolve.push(ident.to_string());
        }
        if let Some(ref blockers) = blocked_by {
            for (b_ident, _) in blockers {
                let b_key = b_ident.to_uppercase();
                if seen_resolve_keys.insert(b_key) {
                    all_idents_to_resolve.push(b_ident.clone());
                }
            }
        }
        parsed_items.push(db::RankedItem {
            issue_id: ident.to_string(),
            note,
            group,
            theme,
        });
        parsed_blocked_by.push(blocked_by);
    }

    if !duplicates.is_empty() {
        return Err(format!(
            "Duplicate identifiers are not allowed: {}",
            duplicates.join(", ")
        ));
    }

    let parsed_groups = parse_label_defs(&args, "groups")?;
    let parsed_themes = parse_label_defs(&args, "themes")?;

    // Check local cache first.
    let (settings, mut resolved_map) = {
        let conn = ctx.db.lock().map_err(|e| e.to_string())?;
        let settings = db::load_settings(&conn).map_err(|e| e.to_string())?;
        let mut map: HashMap<String, String> = HashMap::new();
        for ident in &all_idents_to_resolve {
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

    for ident in &all_idents_to_resolve {
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
    let mut final_items: Vec<db::RankedItem> = Vec::with_capacity(parsed_items.len());
    let mut suggestions_to_write: Vec<(String, String, Vec<(String, String)>)> = Vec::new();
    for (item, blocked_by_opt) in parsed_items.into_iter().zip(parsed_blocked_by.into_iter()) {
        let ident = &item.issue_id;
        let id = resolved_map
            .get(&ident.to_uppercase())
            .cloned()
            .ok_or_else(|| format!("Failed to resolve {ident}"))?;
        if !seen_ids.insert(id.clone()) {
            return Err(format!("Duplicate issue resolved for '{ident}'."));
        }
        if let Some(blockers) = blocked_by_opt {
            let mut resolved_blockers = Vec::with_capacity(blockers.len());
            for (b_ident, reason) in blockers {
                let b_id = resolved_map
                    .get(&b_ident.to_uppercase())
                    .cloned()
                    .ok_or_else(|| format!("Failed to resolve {b_ident}"))?;
                resolved_blockers.push((b_id, reason));
            }
            suggestions_to_write.push((id.clone(), ident.clone(), resolved_blockers));
        }
        final_items.push(db::RankedItem {
            issue_id: id,
            note: item.note,
            group: item.group,
            theme: item.theme,
        });
    }

    // Fetch Linear's blocks relations for the new order before enforcing it, so tickets
    // that are new to the backlog are checked too. On failure, enforce with cached data.
    let final_ids: Vec<String> = final_items.iter().map(|i| i.issue_id.clone()).collect();
    let fresh_relations = linear::fetch_block_relations(&settings.linear_api_key, &final_ids)
        .await
        .ok();

    let (mut payload, dev_grouped, theme_unified, regrouped, dep_moved, cycle_idents) = {
        let mut conn = ctx.db.lock().map_err(|e| e.to_string())?;
        if let Some(rels) = &fresh_relations {
            db::replace_linear_dependencies(&conn, &final_ids, rels)
                .map_err(|e| e.to_string())?;
        }
        let cached_issues = db::load_issues(
            &conn,
            settings.viewer_id.as_deref(),
            settings.viewer_name.as_deref(),
        )
        .map_err(|e| e.to_string())?;
        let issue_by_id: HashMap<String, LinearIssue> = cached_issues
            .into_iter()
            .map(|i| (i.id.clone(), i))
            .collect();

        for (issue_id, fallback_ident, blockers) in &suggestions_to_write {
            let issue_ident = issue_by_id
                .get(issue_id)
                .map(|i| i.identifier.as_str())
                .unwrap_or(fallback_ident.as_str());
            let tuples: Vec<(String, String, String, String, String, String)> = blockers
                .iter()
                .map(|(b_id, reason)| {
                    if let Some(b_issue) = issue_by_id.get(b_id) {
                        (
                            b_id.clone(),
                            b_issue.identifier.clone(),
                            b_issue.title.clone(),
                            b_issue.state_name.clone(),
                            b_issue.state_type.clone(),
                            reason.clone(),
                        )
                    } else {
                        (
                            b_id.clone(),
                            b_id.clone(),
                            String::new(),
                            String::new(),
                            String::new(),
                            reason.clone(),
                        )
                    }
                })
                .collect();
            db::set_suggested_dependencies(&conn, issue_id, issue_ident, &tuples)
                .map_err(|e| e.to_string())?;
        }

        let active_rows = db::active_dev_session_for_issues(&conn).map_err(|e| e.to_string())?;
        let mut session_of: HashMap<String, (String, String)> = HashMap::new();
        for (issue_id, session_id, session_name, _item_status) in active_rows {
            session_of
                .entry(issue_id)
                .or_insert((session_id, session_name));
        }

        let dev_grouped = db::group_dev_sessions(&mut final_items, &session_of);
        let theme_unified = db::unify_group_themes(&mut final_items);
        // Items in one group ship in one session, so they sit next to each other in the order.
        let (final_items, regrouped) = db::cluster_groups(&final_items);

        let deps = db::load_dependencies(&conn).map_err(|e| e.to_string())?;
        let mut open_blockers: HashMap<String, Vec<String>> = HashMap::new();
        for dep in deps {
            if dep.blocker_open {
                open_blockers
                    .entry(dep.issue_id)
                    .or_default()
                    .push(dep.blocker_id);
            }
        }
        let (final_items, dep_moved, cycle_ids) =
            db::enforce_dependencies(&final_items, &open_blockers);

        db::replace_backlog_ranked(
            &mut conn,
            &final_items,
            &parsed_groups,
            &parsed_themes,
            "claude",
        )
        .map_err(|e| e.to_string())?;
        let payload = build_backlog_payload(&conn)?;

        let cycle_idents: Vec<String> = cycle_ids
            .into_iter()
            .map(|id| {
                issue_by_id
                    .get(&id)
                    .map(|i| i.identifier.clone())
                    .unwrap_or(id)
            })
            .collect();

        (
            payload,
            dev_grouped,
            theme_unified,
            regrouped,
            dep_moved,
            cycle_idents,
        )
    };

    let mut notices: Vec<String> = Vec::new();
    if dev_grouped {
        notices.push("Tickets sharing an active dev session were grouped into one batch.".to_string());
    }
    if theme_unified {
        notices.push("Group members' themes were unified so each group shares one theme.".to_string());
    }
    if regrouped {
        notices.push("Group members were not next to each other, so each group was moved up to sit together at its highest-ranked member. Check the order above.".to_string());
    }
    if dep_moved {
        notices.push("Some items were moved below the open tickets that block them.".to_string());
    }
    if !cycle_idents.is_empty() {
        notices.push(format!(
            "These tickets block each other in a loop, so their order was left as is: {}.",
            cycle_idents.join(", ")
        ));
    }
    if !notices.is_empty() {
        if let Some(obj) = payload.as_object_mut() {
            obj.insert("notice".to_string(), json!(notices.join(" ")));
        }
    }

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

fn tool_get_session_queue(ctx: &Arc<McpContext>, args: Value) -> Result<Value, String> {
    let session_id = require_non_empty_str(&args, "session_id")?;

    let (view, issues, backlog) = {
        let conn = ctx.db.lock().map_err(|e| e.to_string())?;
        let view = db::load_dev_session(&conn, session_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Unknown dev session '{session_id}'."))?;
        let settings = db::load_settings(&conn).map_err(|e| e.to_string())?;
        let issues = db::load_issues(
            &conn,
            settings.viewer_id.as_deref(),
            settings.viewer_name.as_deref(),
        )
        .map_err(|e| e.to_string())?;
        let backlog = db::load_backlog(&conn).map_err(|e| e.to_string())?;
        (view, issues, backlog)
    };

    let issue_map: HashMap<String, LinearIssue> =
        issues.into_iter().map(|i| (i.id.clone(), i)).collect();
    let backlog_map: HashMap<String, BacklogEntry> =
        backlog.into_iter().map(|b| (b.issue_id.clone(), b)).collect();

    let items: Vec<Value> = view
        .items
        .into_iter()
        .filter(|item| item.status != "removed")
        .map(|item| {
            let mut obj = serde_json::Map::new();
            if let Some(issue) = issue_map.get(&item.issue_id) {
                obj.insert("identifier".into(), json!(issue.identifier));
                obj.insert("title".into(), json!(issue.title));
                obj.insert("state".into(), json!(issue.state_name));
                obj.insert("priority_label".into(), json!(issue.priority_label));
                obj.insert("url".into(), json!(issue.url));
            } else {
                obj.insert(
                    "identifier".into(),
                    json!(item.identifier.unwrap_or_else(|| item.issue_id.clone())),
                );
                obj.insert("title".into(), json!(item.title));
                obj.insert("state".into(), json!(item.state));
                obj.insert("priority_label".into(), Value::Null);
                obj.insert("url".into(), json!(item.url));
            }
            obj.insert("status".into(), json!(item.status));
            obj.insert("note".into(), json!(item.note));
            if let Some(b) = backlog_map.get(&item.issue_id) {
                obj.insert("backlog_rank".into(), json!(b.position));
                obj.insert("backlog_note".into(), json!(b.note));
            }
            Value::Object(obj)
        })
        .collect();

    Ok(json!({
        "session": {
            "id": view.session.id,
            "name": view.session.name,
            "note": view.session.note,
            "delivery": view.session.delivery,
            "status": view.session.status,
        },
        "items": items,
    }))
}

async fn tool_update_session_item(ctx: &Arc<McpContext>, args: Value) -> Result<Value, String> {
    let session_id = require_non_empty_str(&args, "session_id")?;
    let issue_arg = require_non_empty_str(&args, "issue")?;
    let status = require_non_empty_str(&args, "status")?;
    if !matches!(status, "in_progress" | "split" | "blocked" | "done") {
        return Err(format!(
            "Invalid status '{status}'. Expected one of: in_progress, split, blocked, done."
        ));
    }
    let note = match args.get("note") {
        None | Some(Value::Null) => None,
        Some(Value::String(s)) => Some(s.clone()),
        Some(_) => return Err("Parameter 'note' must be a string.".to_string()),
    };

    let local_issue_id = {
        let conn = ctx.db.lock().map_err(|e| e.to_string())?;
        let view = db::load_dev_session(&conn, session_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Unknown dev session '{session_id}'."))?;
        if let Some(item) = view
            .items
            .iter()
            .find(|i| i.issue_id.eq_ignore_ascii_case(issue_arg))
        {
            Some(item.issue_id.clone())
        } else {
            db::find_issue_id_by_identifier(&conn, issue_arg).map_err(|e| e.to_string())?
        }
    };

    let resolved_issue_id = match local_issue_id {
        Some(id) => id,
        None => {
            let (issue, _) = resolve_or_fetch_issue(ctx, issue_arg).await?;
            issue.id
        }
    };

    {
        let mut conn = ctx.db.lock().map_err(|e| e.to_string())?;
        let view = db::load_dev_session(&conn, session_id)
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Unknown dev session '{session_id}'."))?;
        if !view
            .items
            .iter()
            .any(|i| i.issue_id == resolved_issue_id && i.status != "removed")
        {
            return Err(format!(
                "Issue '{issue_arg}' is not in dev session '{session_id}'."
            ));
        }
        db::set_dev_session_item_status(
            &conn,
            session_id,
            &resolved_issue_id,
            status,
            note.as_deref(),
        )
        .map_err(|e| e.to_string())?;
        if status == "done" {
            db::remove_from_backlog(&mut conn, &resolved_issue_id).map_err(|e| e.to_string())?;
        }
    }

    (ctx.notify)("dev-sessions-changed");
    if status == "done" {
        (ctx.notify)("backlog-changed");
    }
    Ok(json!({
        "ok": true,
        "session_id": session_id,
        "issue_id": resolved_issue_id,
        "status": status,
    }))
}

#[cfg(test)]
mod instructions_tests {
    #[test]
    fn instructions_include_ranking_rules() {
        let text = super::server_instructions();
        for rule in crate::rerank::RANKING_RULES {
            assert!(text.contains(rule));
        }
        assert!(text.contains("local Linear Pulse app"));
    }
}
