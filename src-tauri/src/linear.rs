use crate::db::{
    LinearComment, LinearIssue, LinearLabel, LinearProject, LinearTeam, LinearUser,
    LinearWorkflowState, WorkspaceMetadata,
};
use serde::{Deserialize, Serialize};

const LINEAR_GRAPHQL_URL: &str = "https://api.linear.app/graphql";

const ISSUE_FIELDS: &str = r#"
  id
  identifier
  title
  description
  url
  priority
  priorityLabel
  updatedAt
  createdAt
  state {
    id
    name
    type
    color
  }
  team {
    id
    key
    name
  }
  project {
    id
    name
  }
  assignee {
    id
    name
  }
  labels(first: 10) {
    nodes {
      id
      name
    }
  }
"#;

#[derive(Debug, Clone, Deserialize)]
pub struct CreateIssueInput {
    pub team_id: String,
    pub title: String,
    pub description: Option<String>,
    pub state_id: Option<String>,
    pub priority: Option<i64>,
    pub assignee_id: Option<String>,
    pub project_id: Option<String>,
    pub label_ids: Option<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateIssuePatch {
    pub title: Option<String>,
    pub description: Option<String>,
    pub state_id: Option<String>,
    pub priority: Option<i64>,
    pub assignee_id: Option<String>,
    pub project_id: Option<String>,
    pub label_ids: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
struct GraphQlEnvelope<T> {
    data: Option<T>,
    errors: Option<Vec<GraphQlError>>,
}

#[derive(Debug, Deserialize)]
struct GraphQlError {
    message: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ViewerNode {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogData {
    viewer: ViewerNode,
    teams: TeamConnection,
    users: UserConnection,
    projects: ProjectConnection,
    issue_labels: WorkspaceLabelConnection,
}

#[derive(Debug, Deserialize)]
struct TeamConnection {
    nodes: Vec<TeamCatalogNode>,
}

#[derive(Debug, Deserialize)]
struct TeamCatalogNode {
    id: String,
    key: String,
    name: String,
    states: WorkflowStateConnection,
}

#[derive(Debug, Deserialize)]
struct WorkflowStateConnection {
    nodes: Vec<WorkflowStateNode>,
}

#[derive(Debug, Deserialize)]
struct WorkflowStateNode {
    id: String,
    name: String,
    #[serde(rename = "type")]
    state_type: String,
    color: String,
    position: f64,
}

#[derive(Debug, Deserialize)]
struct UserConnection {
    nodes: Vec<ViewerNode>,
}

#[derive(Debug, Deserialize)]
struct ProjectConnection {
    nodes: Vec<IdNameNode>,
}

#[derive(Debug, Deserialize)]
struct WorkspaceLabelConnection {
    nodes: Vec<WorkspaceLabelNode>,
}

#[derive(Debug, Deserialize)]
struct WorkspaceLabelNode {
    id: String,
    name: String,
    color: String,
    team: Option<IdOnlyNode>,
}

#[derive(Debug, Deserialize)]
struct IdOnlyNode {
    id: String,
}

#[derive(Debug, Deserialize)]
struct IdNameNode {
    id: String,
    name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PageInfo {
    has_next_page: bool,
    end_cursor: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IssueConnection {
    nodes: Vec<IssueNode>,
    page_info: PageInfo,
}

#[derive(Debug, Deserialize)]
struct IssuesQueryData {
    issues: IssueConnection,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchIssuesQueryData {
    search_issues: IssueConnection,
}

#[derive(Debug, Deserialize)]
struct SingleIssueQueryData {
    issue: Option<IssueNode>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IssueMutationData {
    issue_create: Option<IssuePayload>,
    issue_update: Option<IssuePayload>,
}

#[derive(Debug, Deserialize)]
struct IssuePayload {
    success: bool,
    issue: Option<IssueNode>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CommentCreateData {
    comment_create: Option<CommentPayload>,
}

#[derive(Debug, Deserialize)]
struct CommentPayload {
    success: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IssueNode {
    id: String,
    identifier: String,
    title: String,
    description: Option<String>,
    url: String,
    priority: i64,
    priority_label: String,
    updated_at: String,
    created_at: String,
    state: StateNode,
    team: TeamNode,
    project: Option<IdNameNode>,
    assignee: Option<ViewerNode>,
    labels: IssueLabelConnection,
    comments: CommentConnection,
}

#[derive(Debug, Deserialize)]
struct StateNode {
    id: String,
    name: String,
    #[serde(rename = "type")]
    state_type: String,
    color: String,
}

#[derive(Debug, Deserialize)]
struct TeamNode {
    id: String,
    key: String,
    name: String,
}

#[derive(Debug, Deserialize)]
struct IssueLabelConnection {
    nodes: Vec<IdNameNode>,
}

#[derive(Debug, Deserialize)]
struct CommentConnection {
    nodes: Vec<CommentNode>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CommentNode {
    id: String,
    body: String,
    created_at: String,
    user: Option<ViewerNode>,
}

impl From<IssueNode> for LinearIssue {
    fn from(n: IssueNode) -> Self {
        let mut labels = Vec::with_capacity(n.labels.nodes.len());
        let mut label_ids = Vec::with_capacity(n.labels.nodes.len());
        for l in n.labels.nodes {
            label_ids.push(l.id);
            labels.push(l.name);
        }

        LinearIssue {
            id: n.id,
            identifier: n.identifier,
            title: n.title,
            description: n.description,
            url: n.url,
            priority: n.priority,
            priority_label: n.priority_label,
            state_id: n.state.id,
            state_name: n.state.name,
            state_type: n.state.state_type,
            state_color: n.state.color,
            team_id: n.team.id,
            team_key: n.team.key,
            team_name: n.team.name,
            project_id: n.project.as_ref().map(|p| p.id.clone()),
            project_name: n.project.map(|p| p.name),
            assignee_id: n.assignee.as_ref().map(|a| a.id.clone()),
            assignee_name: n.assignee.map(|a| a.name),
            labels,
            label_ids,
            updated_at: n.updated_at,
            created_at: n.created_at,
            last_seen_at: None,
            unread_responses: 0,
            comments: n
                .comments
                .nodes
                .into_iter()
                .map(|c| LinearComment {
                    id: c.id,
                    body: c.body,
                    created_at: c.created_at,
                    author_id: c.user.as_ref().map(|u| u.id.clone()),
                    author_name: c
                        .user
                        .map(|u| u.name)
                        .unwrap_or_else(|| "Unknown".to_string()),
                    is_unread: false,
                })
                .collect(),
        }
    }
}

async fn graphql_post<T: for<'de> Deserialize<'de>>(
    client: &reqwest::Client,
    api_key: &str,
    query: &str,
    variables: serde_json::Value,
) -> Result<T, String> {
    if api_key.trim().is_empty() {
        return Err("Linear API key is not configured. Add it in Settings.".to_string());
    }

    let res = client
        .post(LINEAR_GRAPHQL_URL)
        .header("Authorization", api_key.trim())
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({
            "query": query,
            "variables": variables,
        }))
        .send()
        .await
        .map_err(|e| format!("Failed to reach Linear API: {e}"))?;

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(format!("Linear API returned {status}: {body}"));
    }

    let parsed: GraphQlEnvelope<T> = res
        .json()
        .await
        .map_err(|e| format!("Failed to parse Linear response: {e}"))?;

    if let Some(errors) = parsed.errors {
        if !errors.is_empty() {
            let msg = errors
                .into_iter()
                .map(|e| e.message)
                .collect::<Vec<_>>()
                .join("; ");
            return Err(format!("Linear GraphQL error: {msg}"));
        }
    }

    parsed
        .data
        .ok_or_else(|| "Linear response contained no data".to_string())
}

pub async fn fetch_workspace_catalog(
    api_key: &str,
) -> Result<(ViewerNode, WorkspaceMetadata), String> {
    const CATALOG_QUERY: &str = r#"
    query WorkspaceCatalog {
      viewer {
        id
        name
      }
      teams(first: 50) {
        nodes {
          id
          key
          name
          states(first: 50) {
            nodes {
              id
              name
              type
              color
              position
            }
          }
        }
      }
      users(first: 100, filter: { active: { eq: true } }) {
        nodes {
          id
          name
        }
      }
      projects(first: 100) {
        nodes {
          id
          name
        }
      }
      issueLabels(first: 150) {
        nodes {
          id
          name
          color
          team {
            id
          }
        }
      }
    }
    "#;

    let client = reqwest::Client::new();
    let data: CatalogData =
        graphql_post(&client, api_key, CATALOG_QUERY, serde_json::json!({})).await?;

    let teams = data
        .teams
        .nodes
        .into_iter()
        .map(|t| {
            let mut states: Vec<LinearWorkflowState> = t
                .states
                .nodes
                .into_iter()
                .map(|s| LinearWorkflowState {
                    id: s.id,
                    name: s.name,
                    state_type: s.state_type,
                    color: s.color,
                    position: s.position,
                })
                .collect();
            states.sort_by(|a, b| {
                workflow_state_type_rank(&a.state_type)
                    .cmp(&workflow_state_type_rank(&b.state_type))
                    .then_with(|| {
                        a.position
                            .partial_cmp(&b.position)
                            .unwrap_or(std::cmp::Ordering::Equal)
                    })
            });
            LinearTeam {
                id: t.id,
                key: t.key,
                name: t.name,
                states,
            }
        })
        .collect();

    let mut users: Vec<LinearUser> = data
        .users
        .nodes
        .into_iter()
        .map(|u| LinearUser {
            id: u.id,
            name: u.name,
        })
        .collect();
    users.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    let mut projects: Vec<LinearProject> = data
        .projects
        .nodes
        .into_iter()
        .map(|p| LinearProject {
            id: p.id,
            name: p.name,
        })
        .collect();
    projects.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    let mut labels: Vec<LinearLabel> = data
        .issue_labels
        .nodes
        .into_iter()
        .map(|l| LinearLabel {
            id: l.id,
            name: l.name,
            color: l.color,
            team_id: l.team.map(|t| t.id),
        })
        .collect();
    labels.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    Ok((
        data.viewer,
        WorkspaceMetadata {
            teams,
            users,
            projects,
            labels,
        },
    ))
}

fn workflow_state_type_rank(state_type: &str) -> u8 {
    match state_type.to_lowercase().as_str() {
        "backlog" => 0,
        "triage" => 1,
        "unstarted" => 2,
        "started" => 3,
        "completed" => 4,
        "canceled" | "cancelled" => 5,
        _ => 3,
    }
}

pub async fn fetch_issues_sync(
    api_key: &str,
    updated_since: Option<&str>,
) -> Result<Vec<LinearIssue>, String> {
    let client = reqwest::Client::new();
    let mut collected = Vec::new();
    let mut after_cursor: Option<String> = None;

    if let Some(since) = updated_since {
        let query = format!(
            r#"
            query IncrementalSync($after: String, $since: DateTimeOrDuration!) {{
              issues(
                first: 60
                after: $after
                orderBy: updatedAt
                filter: {{ updatedAt: {{ gte: $since }} }}
              ) {{
                nodes {{
                  {ISSUE_FIELDS}
                  comments(last: 35) {{
                    nodes {{
                      id
                      body
                      createdAt
                      user {{
                        id
                        name
                      }}
                    }}
                  }}
                }}
                pageInfo {{
                  hasNextPage
                  endCursor
                }}
              }}
            }}
            "#
        );

        for _ in 0..15 {
            let data: IssuesQueryData = graphql_post(
                &client,
                api_key,
                &query,
                serde_json::json!({
                    "after": after_cursor,
                    "since": since,
                }),
            )
            .await?;

            collected.extend(data.issues.nodes.into_iter().map(LinearIssue::from));
            if !data.issues.page_info.has_next_page || data.issues.page_info.end_cursor.is_none()
            {
                break;
            }
            after_cursor = data.issues.page_info.end_cursor;
        }
    } else {
        let query = format!(
            r#"
            query FullCatalogSync($after: String) {{
              issues(first: 80, after: $after, orderBy: updatedAt) {{
                nodes {{
                  {ISSUE_FIELDS}
                  comments(last: 15) {{
                    nodes {{
                      id
                      body
                      createdAt
                      user {{
                        id
                        name
                      }}
                    }}
                  }}
                }}
                pageInfo {{
                  hasNextPage
                  endCursor
                }}
              }}
            }}
            "#
        );

        for _ in 0..35 {
            let data: IssuesQueryData = graphql_post(
                &client,
                api_key,
                &query,
                serde_json::json!({
                    "after": after_cursor,
                }),
            )
            .await?;

            collected.extend(data.issues.nodes.into_iter().map(LinearIssue::from));
            if !data.issues.page_info.has_next_page || data.issues.page_info.end_cursor.is_none()
            {
                break;
            }
            after_cursor = data.issues.page_info.end_cursor;
        }
    }

    Ok(collected)
}

pub async fn search_issues_remote(api_key: &str, term: &str) -> Result<Vec<LinearIssue>, String> {
    let trimmed = term.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    let query = format!(
        r#"
        query SearchIssues($term: String!) {{
          searchIssues(term: $term, first: 40, includeComments: true) {{
            nodes {{
              {ISSUE_FIELDS}
              comments(last: 20) {{
                nodes {{
                  id
                  body
                  createdAt
                  user {{
                    id
                    name
                  }}
                }}
              }}
            }}
            pageInfo {{
              hasNextPage
              endCursor
            }}
          }}
        }}
        "#
    );

    let client = reqwest::Client::new();
    let data: SearchIssuesQueryData = graphql_post(
        &client,
        api_key,
        &query,
        serde_json::json!({ "term": trimmed }),
    )
    .await?;

    Ok(data
        .search_issues
        .nodes
        .into_iter()
        .map(LinearIssue::from)
        .collect())
}

pub async fn fetch_single_issue(api_key: &str, issue_id: &str) -> Result<LinearIssue, String> {
    let query = format!(
        r#"
        query SingleIssue($id: String!) {{
          issue(id: $id) {{
            {ISSUE_FIELDS}
            comments(last: 50) {{
              nodes {{
                id
                body
                createdAt
                user {{
                  id
                  name
                }}
              }}
            }}
          }}
        }}
        "#
    );

    let client = reqwest::Client::new();
    let data: SingleIssueQueryData = graphql_post(
        &client,
        api_key,
        &query,
        serde_json::json!({ "id": issue_id }),
    )
    .await?;

    data.issue
        .map(LinearIssue::from)
        .ok_or_else(|| "Issue not found in Linear".to_string())
}

pub async fn create_linear_issue(
    api_key: &str,
    input: CreateIssueInput,
) -> Result<LinearIssue, String> {
    if input.team_id.trim().is_empty() {
        return Err("Team is required to create an issue.".to_string());
    }
    if input.title.trim().is_empty() {
        return Err("Title cannot be empty.".to_string());
    }

    let mut map = serde_json::Map::new();
    map.insert(
        "teamId".to_string(),
        serde_json::Value::String(input.team_id.trim().to_string()),
    );
    map.insert(
        "title".to_string(),
        serde_json::Value::String(input.title.trim().to_string()),
    );

    if let Some(desc) = input.description.map(|d| d.trim().to_string()).filter(|d| !d.is_empty()) {
        map.insert("description".to_string(), serde_json::Value::String(desc));
    }
    if let Some(state_id) = input.state_id.filter(|s| !s.trim().is_empty()) {
        map.insert("stateId".to_string(), serde_json::Value::String(state_id));
    }
    if let Some(priority) = input.priority {
        map.insert("priority".to_string(), serde_json::json!(priority));
    }
    if let Some(assignee_id) = input.assignee_id.filter(|s| !s.trim().is_empty()) {
        map.insert(
            "assigneeId".to_string(),
            serde_json::Value::String(assignee_id),
        );
    }
    if let Some(project_id) = input.project_id.filter(|s| !s.trim().is_empty()) {
        map.insert(
            "projectId".to_string(),
            serde_json::Value::String(project_id),
        );
    }
    if let Some(label_ids) = input.label_ids.filter(|ids| !ids.is_empty()) {
        map.insert("labelIds".to_string(), serde_json::json!(label_ids));
    }

    let mutation = format!(
        r#"
        mutation CreateIssue($input: IssueCreateInput!) {{
          issueCreate(input: $input) {{
            success
            issue {{
              {ISSUE_FIELDS}
              comments(last: 10) {{
                nodes {{
                  id
                  body
                  createdAt
                  user {{
                    id
                    name
                  }}
                }}
              }}
            }}
          }}
        }}
        "#
    );

    let client = reqwest::Client::new();
    let data: IssueMutationData = graphql_post(
        &client,
        api_key,
        &mutation,
        serde_json::json!({ "input": serde_json::Value::Object(map) }),
    )
    .await?;

    let payload = data
        .issue_create
        .ok_or_else(|| "Linear did not return issueCreate payload".to_string())?;

    if !payload.success {
        return Err("Linear failed to create the issue.".to_string());
    }

    payload
        .issue
        .map(LinearIssue::from)
        .ok_or_else(|| "Linear created the issue without returning details.".to_string())
}

pub async fn update_linear_issue(
    api_key: &str,
    issue_id: &str,
    patch: UpdateIssuePatch,
) -> Result<LinearIssue, String> {
    let mut map = serde_json::Map::new();

    if let Some(title) = patch.title {
        let trimmed = title.trim();
        if trimmed.is_empty() {
            return Err("Issue title cannot be empty.".to_string());
        }
        map.insert(
            "title".to_string(),
            serde_json::Value::String(trimmed.to_string()),
        );
    }
    if let Some(desc) = patch.description {
        map.insert("description".to_string(), serde_json::Value::String(desc));
    }
    if let Some(state_id) = patch.state_id.filter(|s| !s.trim().is_empty()) {
        map.insert("stateId".to_string(), serde_json::Value::String(state_id));
    }
    if let Some(priority) = patch.priority {
        map.insert("priority".to_string(), serde_json::json!(priority));
    }
    if let Some(assignee_id) = patch.assignee_id {
        if assignee_id.trim().is_empty() {
            map.insert("assigneeId".to_string(), serde_json::Value::Null);
        } else {
            map.insert(
                "assigneeId".to_string(),
                serde_json::Value::String(assignee_id),
            );
        }
    }
    if let Some(project_id) = patch.project_id {
        if project_id.trim().is_empty() {
            map.insert("projectId".to_string(), serde_json::Value::Null);
        } else {
            map.insert(
                "projectId".to_string(),
                serde_json::Value::String(project_id),
            );
        }
    }
    if let Some(label_ids) = patch.label_ids {
        map.insert("labelIds".to_string(), serde_json::json!(label_ids));
    }

    if map.is_empty() {
        return Err("No fields provided to update.".to_string());
    }

    let mutation = format!(
        r#"
        mutation UpdateIssue($id: String!, $input: IssueUpdateInput!) {{
          issueUpdate(id: $id, input: $input) {{
            success
            issue {{
              {ISSUE_FIELDS}
              comments(last: 50) {{
                nodes {{
                  id
                  body
                  createdAt
                  user {{
                    id
                    name
                  }}
                }}
              }}
            }}
          }}
        }}
        "#
    );

    let client = reqwest::Client::new();
    let data: IssueMutationData = graphql_post(
        &client,
        api_key,
        &mutation,
        serde_json::json!({
            "id": issue_id,
            "input": serde_json::Value::Object(map)
        }),
    )
    .await?;

    let payload = data
        .issue_update
        .ok_or_else(|| "Linear did not return issueUpdate payload".to_string())?;

    if !payload.success {
        return Err("Linear failed to update the issue.".to_string());
    }

    payload
        .issue
        .map(LinearIssue::from)
        .ok_or_else(|| "Linear updated the issue without returning details.".to_string())
}

pub async fn create_linear_comment(
    api_key: &str,
    issue_id: &str,
    body: &str,
) -> Result<LinearIssue, String> {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return Err("Comment cannot be empty.".to_string());
    }

    const COMMENT_MUTATION: &str = r#"
    mutation CreateComment($input: CommentCreateInput!) {
      commentCreate(input: $input) {
        success
      }
    }
    "#;

    let client = reqwest::Client::new();
    let data: CommentCreateData = graphql_post(
        &client,
        api_key,
        COMMENT_MUTATION,
        serde_json::json!({
            "input": {
                "issueId": issue_id,
                "body": trimmed,
            }
        }),
    )
    .await?;

    let payload = data
        .comment_create
        .ok_or_else(|| "Linear did not return commentCreate payload".to_string())?;

    if !payload.success {
        return Err("Linear failed to post comment.".to_string());
    }

    fetch_single_issue(api_key, issue_id).await
}
