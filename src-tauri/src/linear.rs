use crate::db::{LinearComment, LinearIssue};
use serde::Deserialize;

const LINEAR_GRAPHQL_URL: &str = "https://api.linear.app/graphql";

const SYNC_QUERY: &str = r#"
query SyncPulse {
  viewer {
    id
    name
  }
  issues(first: 100, orderBy: updatedAt) {
    nodes {
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
        name
        type
        color
      }
      team {
        key
        name
      }
      project {
        name
      }
      assignee {
        name
      }
      labels {
        nodes {
          name
        }
      }
      comments(first: 25) {
        nodes {
          id
          body
          createdAt
          user {
            id
            name
          }
        }
      }
    }
  }
}
"#;

#[derive(Debug, Deserialize)]
struct GraphQlResponse {
    data: Option<SyncData>,
    errors: Option<Vec<GraphQlError>>,
}

#[derive(Debug, Deserialize)]
struct GraphQlError {
    message: String,
}

#[derive(Debug, Deserialize)]
struct SyncData {
    viewer: ViewerNode,
    issues: IssueConnection,
}

#[derive(Debug, Deserialize)]
pub struct ViewerNode {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Deserialize)]
struct IssueConnection {
    nodes: Vec<IssueNode>,
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
    project: Option<ProjectNode>,
    assignee: Option<UserNameNode>,
    labels: LabelConnection,
    comments: CommentConnection,
}

#[derive(Debug, Deserialize)]
struct StateNode {
    name: String,
    #[serde(rename = "type")]
    state_type: String,
    color: String,
}

#[derive(Debug, Deserialize)]
struct TeamNode {
    key: String,
    name: String,
}

#[derive(Debug, Deserialize)]
struct ProjectNode {
    name: String,
}

#[derive(Debug, Deserialize)]
struct UserNameNode {
    name: String,
}

#[derive(Debug, Deserialize)]
struct LabelConnection {
    nodes: Vec<LabelNode>,
}

#[derive(Debug, Deserialize)]
struct LabelNode {
    name: String,
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

pub async fn fetch_linear_workspace(
    api_key: &str,
) -> Result<(ViewerNode, Vec<LinearIssue>), String> {
    if api_key.trim().is_empty() {
        return Err("Linear API key is not configured. Add it in Settings.".to_string());
    }

    let client = reqwest::Client::new();
    let res = client
        .post(LINEAR_GRAPHQL_URL)
        .header("Authorization", api_key.trim())
        .header("Content-Type", "application/json")
        .json(&serde_json::json!({ "query": SYNC_QUERY }))
        .send()
        .await
        .map_err(|e| format!("Failed to reach Linear API: {e}"))?;

    if !res.status().is_success() {
        let status = res.status();
        let body = res.text().await.unwrap_or_default();
        return Err(format!("Linear API returned {status}: {body}"));
    }

    let parsed: GraphQlResponse = res
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

    let data = parsed
        .data
        .ok_or_else(|| "Linear response contained no data".to_string())?;

    let issues = data
        .issues
        .nodes
        .into_iter()
        .map(|n| LinearIssue {
            id: n.id,
            identifier: n.identifier,
            title: n.title,
            description: n.description,
            url: n.url,
            priority: n.priority,
            priority_label: n.priority_label,
            state_name: n.state.name,
            state_type: n.state.state_type,
            state_color: n.state.color,
            team_key: n.team.key,
            team_name: n.team.name,
            project_name: n.project.map(|p| p.name),
            assignee_name: n.assignee.map(|a| a.name),
            labels: n.labels.nodes.into_iter().map(|l| l.name).collect(),
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
        })
        .collect();

    Ok((data.viewer, issues))
}
