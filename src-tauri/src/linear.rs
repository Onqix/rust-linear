use crate::db::{
    LinearComment, LinearIssue, LinearLabel, LinearLinkedItem, LinearProject, LinearTeam,
    LinearUser, LinearWorkflowState, WorkspaceMetadata,
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
  completedAt
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
  parent {
    id
    identifier
    title
    url
    state {
      id
      name
      type
      color
    }
  }
"#;

const ISSUE_DETAIL_LINKS: &str = r#"
  children(first: 25) {
    nodes {
      id
      identifier
      title
      url
      state {
        id
        name
        type
        color
      }
    }
  }
  relations(first: 25) {
    nodes {
      id
      type
      relatedIssue {
        id
        identifier
        title
        url
        state {
          id
          name
          type
          color
        }
      }
    }
  }
  inverseRelations(first: 25) {
    nodes {
      id
      type
      issue {
        id
        identifier
        title
        url
        state {
          id
          name
          type
          color
        }
      }
    }
  }
  attachments(first: 25) {
    nodes {
      id
      title
      subtitle
      url
      sourceType
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

#[derive(Debug, Clone, Serialize)]
pub struct BlockRelation {
    pub blocked_id: String,
    pub blocked_identifier: String,
    pub blocked_title: String,
    pub blocked_state_name: String,
    pub blocked_state_type: String,
    pub blocker_id: String,
    pub blocker_identifier: String,
    pub blocker_title: String,
    pub blocker_state_name: String,
    pub blocker_state_type: String,
}

#[derive(Debug, Deserialize)]
struct BlockRelationsQueryData {
    issues: BlockIssueConnection,
}

#[derive(Debug, Default, Deserialize)]
struct BlockIssueConnection {
    #[serde(default)]
    nodes: Vec<BlockIssueNode>,
}

#[derive(Debug, Deserialize)]
struct BlockStateNode {
    name: String,
    #[serde(rename = "type")]
    state_type: String,
}

#[derive(Debug, Deserialize)]
struct BlockIssueSummaryNode {
    id: String,
    identifier: String,
    title: String,
    state: Option<BlockStateNode>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BlockRelationEdgeNode {
    #[serde(rename = "type")]
    rel_type: String,
    related_issue: Option<BlockIssueSummaryNode>,
}

#[derive(Debug, Default, Deserialize)]
struct BlockRelationConnection {
    #[serde(default)]
    nodes: Vec<BlockRelationEdgeNode>,
}

#[derive(Debug, Deserialize)]
struct BlockInverseRelationEdgeNode {
    #[serde(rename = "type")]
    rel_type: String,
    issue: Option<BlockIssueSummaryNode>,
}

#[derive(Debug, Default, Deserialize)]
struct BlockInverseRelationConnection {
    #[serde(default)]
    nodes: Vec<BlockInverseRelationEdgeNode>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BlockIssueNode {
    id: String,
    identifier: String,
    title: String,
    state: Option<BlockStateNode>,
    #[serde(default)]
    relations: BlockRelationConnection,
    #[serde(default)]
    inverse_relations: BlockInverseRelationConnection,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IssueRelationCreateData {
    issue_relation_create: Option<IssueRelationPayload>,
}

#[derive(Debug, Deserialize)]
struct IssueRelationPayload {
    success: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LinkedIssueRefNode {
    id: String,
    identifier: String,
    title: String,
    url: String,
    state: Option<StateNode>,
}

#[derive(Debug, Default, Deserialize)]
struct LinkedIssueConnection {
    #[serde(default)]
    nodes: Vec<LinkedIssueRefNode>,
}

#[derive(Debug, Default, Deserialize)]
struct IssueRelationConnection {
    #[serde(default)]
    nodes: Vec<IssueRelationNode>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IssueRelationNode {
    #[allow(dead_code)]
    id: String,
    #[serde(rename = "type")]
    rel_type: String,
    related_issue: Option<LinkedIssueRefNode>,
}

#[derive(Debug, Default, Deserialize)]
struct InverseRelationConnection {
    #[serde(default)]
    nodes: Vec<InverseRelationNode>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InverseRelationNode {
    #[allow(dead_code)]
    id: String,
    #[serde(rename = "type")]
    rel_type: String,
    issue: Option<LinkedIssueRefNode>,
}

#[derive(Debug, Default, Deserialize)]
struct AttachmentConnection {
    #[serde(default)]
    nodes: Vec<AttachmentNode>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AttachmentNode {
    id: String,
    title: String,
    subtitle: Option<String>,
    url: String,
    source_type: Option<String>,
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
    #[serde(default)]
    completed_at: Option<String>,
    state: StateNode,
    team: TeamNode,
    project: Option<IdNameNode>,
    assignee: Option<ViewerNode>,
    labels: IssueLabelConnection,
    #[serde(default)]
    parent: Option<LinkedIssueRefNode>,
    #[serde(default)]
    children: LinkedIssueConnection,
    #[serde(default)]
    relations: IssueRelationConnection,
    #[serde(default)]
    inverse_relations: InverseRelationConnection,
    #[serde(default)]
    attachments: AttachmentConnection,
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

fn push_issue_link(
    out: &mut Vec<LinearLinkedItem>,
    kind: &str,
    relation_label: &str,
    node: LinkedIssueRefNode,
) {
    let (state_name, state_type, state_color) = match node.state {
        Some(st) => (Some(st.name), Some(st.state_type), Some(st.color)),
        None => (None, None, None),
    };
    out.push(LinearLinkedItem {
        kind: kind.to_string(),
        relation_label: relation_label.to_string(),
        id: node.id,
        identifier: Some(node.identifier),
        title: node.title,
        subtitle: None,
        url: node.url,
        state_name,
        state_type,
        state_color,
        source_type: Some("linear".to_string()),
    });
}

fn format_source_label(source_type: Option<&str>) -> String {
    match source_type.map(|s| s.trim().to_lowercase()).as_deref() {
        Some("github") => "GitHub".to_string(),
        Some("gitlab") => "GitLab".to_string(),
        Some("slack") => "Slack".to_string(),
        Some("figma") => "Figma".to_string(),
        Some("notion") => "Notion".to_string(),
        Some("sentry") => "Sentry".to_string(),
        Some("zendesk") => "Zendesk".to_string(),
        Some("intercom") => "Intercom".to_string(),
        Some(other) if !other.is_empty() => {
            let mut chars = other.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                None => "Link".to_string(),
            }
        }
        _ => "Link".to_string(),
    }
}

impl From<IssueNode> for LinearIssue {
    fn from(n: IssueNode) -> Self {
        let mut labels = Vec::with_capacity(n.labels.nodes.len());
        let mut label_ids = Vec::with_capacity(n.labels.nodes.len());
        for l in n.labels.nodes {
            label_ids.push(l.id);
            labels.push(l.name);
        }

        let mut links = Vec::new();
        if let Some(parent) = n.parent {
            push_issue_link(&mut links, "parent", "Parent", parent);
        }
        for child in n.children.nodes {
            push_issue_link(&mut links, "sub_issue", "Sub-issue", child);
        }
        for rel in n.relations.nodes {
            if let Some(target) = rel.related_issue {
                let (kind, label) = match rel.rel_type.to_lowercase().as_str() {
                    "blocks" => ("blocks", "Blocks"),
                    "duplicate" => ("duplicate_of", "Duplicate of"),
                    "similar" => ("related", "Similar"),
                    _ => ("related", "Related"),
                };
                push_issue_link(&mut links, kind, label, target);
            }
        }
        for inv in n.inverse_relations.nodes {
            if let Some(source) = inv.issue {
                let (kind, label) = match inv.rel_type.to_lowercase().as_str() {
                    "blocks" => ("blocked_by", "Blocked by"),
                    "duplicate" => ("duplicated_by", "Duplicated by"),
                    "similar" => ("related", "Similar"),
                    _ => ("related", "Related"),
                };
                push_issue_link(&mut links, kind, label, source);
            }
        }
        for att in n.attachments.nodes {
            let label = format_source_label(att.source_type.as_deref());
            links.push(LinearLinkedItem {
                kind: "attachment".to_string(),
                relation_label: label,
                id: att.id,
                identifier: None,
                title: att.title,
                subtitle: att.subtitle,
                url: att.url,
                state_name: None,
                state_type: None,
                state_color: None,
                source_type: att.source_type,
            });
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
            completed_at: n.completed_at,
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
            links,
            links_loaded: false,
        }
    }
}

fn single_issue_with_links(node: IssueNode) -> LinearIssue {
    let mut issue = LinearIssue::from(node);
    issue.links_loaded = true;
    issue
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
            {ISSUE_DETAIL_LINKS}
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
        .map(single_issue_with_links)
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
              {ISSUE_DETAIL_LINKS}
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
        .map(single_issue_with_links)
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
              {ISSUE_DETAIL_LINKS}
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
        .map(single_issue_with_links)
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

const PROJECT_FIELDS: &str = r#"
  id
  name
  description
  icon
  color
  url
  progress
  targetDate
  startDate
  updatedAt
  health
  lead {
    id
    name
  }
  status {
    id
    name
    type
    color
    position
  }
  teams(first: 10) {
    nodes {
      id
      key
      name
    }
  }
"#;

#[derive(Debug, Clone, Serialize)]
pub struct LinearProjectTeamRef {
    pub id: String,
    pub key: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct LinearProjectDetail {
    pub id: String,
    pub name: String,
    pub description: String,
    pub icon: Option<String>,
    pub color: String,
    pub url: String,
    pub progress: f64,
    pub target_date: Option<String>,
    pub start_date: Option<String>,
    pub updated_at: String,
    pub health: Option<String>,
    pub lead_id: Option<String>,
    pub lead_name: Option<String>,
    pub status_id: String,
    pub status_name: String,
    pub status_type: String,
    pub status_color: String,
    pub status_position: f64,
    pub teams: Vec<LinearProjectTeamRef>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LinearProjectStatusOption {
    pub id: String,
    pub name: String,
    pub status_type: String,
    pub color: String,
    pub position: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProjectsOverview {
    pub projects: Vec<LinearProjectDetail>,
    pub statuses: Vec<LinearProjectStatusOption>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateProjectInput {
    pub name: String,
    pub team_ids: Vec<String>,
    pub description: Option<String>,
    pub status_id: Option<String>,
    pub lead_id: Option<String>,
    pub target_date: Option<String>,
    pub start_date: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct UpdateProjectPatch {
    pub name: Option<String>,
    pub description: Option<String>,
    pub status_id: Option<String>,
    pub lead_id: Option<String>,
    pub target_date: Option<String>,
    pub start_date: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectStatusNode {
    id: String,
    name: String,
    #[serde(rename = "type")]
    status_type: String,
    color: String,
    position: f64,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectTeamConnection {
    #[serde(default)]
    nodes: Vec<TeamNode>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectNode {
    id: String,
    name: String,
    #[serde(default)]
    description: String,
    icon: Option<String>,
    color: String,
    url: String,
    progress: f64,
    target_date: Option<String>,
    start_date: Option<String>,
    updated_at: String,
    health: Option<String>,
    lead: Option<ViewerNode>,
    status: ProjectStatusNode,
    #[serde(default)]
    teams: ProjectTeamConnection,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectDetailConnection {
    #[serde(default)]
    nodes: Vec<ProjectNode>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectStatusConnection {
    #[serde(default)]
    nodes: Vec<ProjectStatusNode>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectsOverviewQueryData {
    projects: ProjectDetailConnection,
    project_statuses: ProjectStatusConnection,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectMutationData {
    project_create: Option<ProjectPayload>,
    project_update: Option<ProjectPayload>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectPayload {
    success: bool,
    project: Option<ProjectNode>,
}

impl From<ProjectStatusNode> for LinearProjectStatusOption {
    fn from(s: ProjectStatusNode) -> Self {
        LinearProjectStatusOption {
            id: s.id,
            name: s.name,
            status_type: s.status_type,
            color: s.color,
            position: s.position,
        }
    }
}

impl From<ProjectNode> for LinearProjectDetail {
    fn from(p: ProjectNode) -> Self {
        LinearProjectDetail {
            id: p.id,
            name: p.name,
            description: p.description,
            icon: p.icon,
            color: p.color,
            url: p.url,
            progress: p.progress,
            target_date: p.target_date,
            start_date: p.start_date,
            updated_at: p.updated_at,
            health: p.health,
            lead_id: p.lead.as_ref().map(|l| l.id.clone()),
            lead_name: p.lead.map(|l| l.name),
            status_id: p.status.id,
            status_name: p.status.name,
            status_type: p.status.status_type,
            status_color: p.status.color,
            status_position: p.status.position,
            teams: p
                .teams
                .nodes
                .into_iter()
                .map(|t| LinearProjectTeamRef {
                    id: t.id,
                    key: t.key,
                    name: t.name,
                })
                .collect(),
        }
    }
}

fn project_status_type_rank(status_type: &str) -> u8 {
    match status_type.trim().to_lowercase().as_str() {
        "started" => 0,
        "planned" => 1,
        "paused" => 2,
        "backlog" => 3,
        "completed" => 4,
        "canceled" | "cancelled" => 5,
        _ => 6,
    }
}

pub async fn fetch_projects_overview(api_key: &str) -> Result<ProjectsOverview, String> {
    let query = format!(
        r#"
        query ProjectsOverview {{
          projects(first: 100) {{
            nodes {{
              {PROJECT_FIELDS}
            }}
          }}
          projectStatuses(first: 50) {{
            nodes {{
              id
              name
              type
              color
              position
            }}
          }}
        }}
        "#
    );

    let client = reqwest::Client::new();
    let data: ProjectsOverviewQueryData =
        graphql_post(&client, api_key, &query, serde_json::json!({})).await?;

    let mut statuses: Vec<LinearProjectStatusOption> = data
        .project_statuses
        .nodes
        .into_iter()
        .map(LinearProjectStatusOption::from)
        .collect();
    statuses.sort_by(|a, b| {
        a.position
            .partial_cmp(&b.position)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    let mut projects: Vec<LinearProjectDetail> = data
        .projects
        .nodes
        .into_iter()
        .map(LinearProjectDetail::from)
        .collect();
    projects.sort_by(|a, b| {
        project_status_type_rank(&a.status_type)
            .cmp(&project_status_type_rank(&b.status_type))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
            .then_with(|| a.name.cmp(&b.name))
    });

    Ok(ProjectsOverview { projects, statuses })
}

pub async fn create_linear_project(
    api_key: &str,
    input: CreateProjectInput,
) -> Result<LinearProjectDetail, String> {
    let trimmed_name = input.name.trim();
    if trimmed_name.is_empty() {
        return Err("Project name cannot be empty.".to_string());
    }
    let team_ids: Vec<String> = input
        .team_ids
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    if team_ids.is_empty() {
        return Err("At least one team is required to create a project.".to_string());
    }

    let mut map = serde_json::Map::new();
    map.insert(
        "name".to_string(),
        serde_json::Value::String(trimmed_name.to_string()),
    );
    map.insert("teamIds".to_string(), serde_json::json!(team_ids));

    if let Some(desc) = input
        .description
        .map(|d| d.trim().to_string())
        .filter(|d| !d.is_empty())
    {
        map.insert("description".to_string(), serde_json::Value::String(desc));
    }
    if let Some(status_id) = input
        .status_id
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
    {
        map.insert("statusId".to_string(), serde_json::Value::String(status_id));
    }
    if let Some(lead_id) = input
        .lead_id
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
    {
        map.insert("leadId".to_string(), serde_json::Value::String(lead_id));
    }
    if let Some(target_date) = input
        .target_date
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
    {
        map.insert(
            "targetDate".to_string(),
            serde_json::Value::String(target_date),
        );
    }
    if let Some(start_date) = input
        .start_date
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
    {
        map.insert(
            "startDate".to_string(),
            serde_json::Value::String(start_date),
        );
    }

    let mutation = format!(
        r#"
        mutation CreateProject($input: ProjectCreateInput!) {{
          projectCreate(input: $input) {{
            success
            project {{
              {PROJECT_FIELDS}
            }}
          }}
        }}
        "#
    );

    let client = reqwest::Client::new();
    let data: ProjectMutationData = graphql_post(
        &client,
        api_key,
        &mutation,
        serde_json::json!({ "input": serde_json::Value::Object(map) }),
    )
    .await?;

    let payload = data
        .project_create
        .ok_or_else(|| "Linear did not return projectCreate payload".to_string())?;

    if !payload.success {
        return Err("Linear failed to create the project.".to_string());
    }

    payload
        .project
        .map(LinearProjectDetail::from)
        .ok_or_else(|| "Linear created the project without returning details.".to_string())
}

pub async fn update_linear_project(
    api_key: &str,
    project_id: &str,
    patch: UpdateProjectPatch,
) -> Result<LinearProjectDetail, String> {
    let mut map = serde_json::Map::new();

    if let Some(name) = patch.name {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err("Project name cannot be empty.".to_string());
        }
        map.insert(
            "name".to_string(),
            serde_json::Value::String(trimmed.to_string()),
        );
    }
    if let Some(desc) = patch.description {
        map.insert("description".to_string(), serde_json::Value::String(desc));
    }
    if let Some(status_id) = patch.status_id.filter(|s| !s.trim().is_empty()) {
        map.insert(
            "statusId".to_string(),
            serde_json::Value::String(status_id.trim().to_string()),
        );
    }
    if let Some(lead_id) = patch.lead_id {
        if lead_id.trim().is_empty() {
            map.insert("leadId".to_string(), serde_json::Value::Null);
        } else {
            map.insert(
                "leadId".to_string(),
                serde_json::Value::String(lead_id.trim().to_string()),
            );
        }
    }
    if let Some(target_date) = patch.target_date {
        if target_date.trim().is_empty() {
            map.insert("targetDate".to_string(), serde_json::Value::Null);
        } else {
            map.insert(
                "targetDate".to_string(),
                serde_json::Value::String(target_date.trim().to_string()),
            );
        }
    }
    if let Some(start_date) = patch.start_date {
        if start_date.trim().is_empty() {
            map.insert("startDate".to_string(), serde_json::Value::Null);
        } else {
            map.insert(
                "startDate".to_string(),
                serde_json::Value::String(start_date.trim().to_string()),
            );
        }
    }

    if map.is_empty() {
        return Err("No fields provided to update.".to_string());
    }

    let mutation = format!(
        r#"
        mutation UpdateProject($id: String!, $input: ProjectUpdateInput!) {{
          projectUpdate(id: $id, input: $input) {{
            success
            project {{
              {PROJECT_FIELDS}
            }}
          }}
        }}
        "#
    );

    let client = reqwest::Client::new();
    let data: ProjectMutationData = graphql_post(
        &client,
        api_key,
        &mutation,
        serde_json::json!({
            "id": project_id,
            "input": serde_json::Value::Object(map)
        }),
    )
    .await?;

    let payload = data
        .project_update
        .ok_or_else(|| "Linear did not return projectUpdate payload".to_string())?;

    if !payload.success {
        return Err("Linear failed to update the project.".to_string());
    }

    payload
        .project
        .map(LinearProjectDetail::from)
        .ok_or_else(|| "Linear updated the project without returning details.".to_string())
}

fn state_fields(state: Option<&BlockStateNode>) -> (String, String) {
    match state {
        Some(s) => (s.name.clone(), s.state_type.clone()),
        None => (String::new(), String::new()),
    }
}

pub async fn fetch_block_relations(
    api_key: &str,
    issue_ids: &[String],
) -> Result<Vec<BlockRelation>, String> {
    let mut unique_ids = Vec::new();
    let mut seen_ids = std::collections::HashSet::new();
    for id in issue_ids {
        let trimmed = id.trim();
        if !trimmed.is_empty() && seen_ids.insert(trimmed.to_string()) {
            unique_ids.push(trimmed.to_string());
        }
    }
    if unique_ids.is_empty() {
        return Ok(Vec::new());
    }

    const QUERY: &str = r#"
    query IssueBlockRelations($ids: [ID!]!) {
      issues(filter: { id: { in: $ids } }, first: 25) {
        nodes {
          id
          identifier
          title
          state {
            name
            type
          }
          relations(first: 20) {
            nodes {
              type
              relatedIssue {
                id
                identifier
                title
                state {
                  name
                  type
                }
              }
            }
          }
          inverseRelations(first: 20) {
            nodes {
              type
              issue {
                id
                identifier
                title
                state {
                  name
                  type
                }
              }
            }
          }
        }
      }
    }
    "#;

    let client = reqwest::Client::new();
    let mut out = Vec::new();
    let mut seen_pairs: std::collections::HashSet<(String, String)> =
        std::collections::HashSet::new();

    for chunk in unique_ids.chunks(25) {
        let data: BlockRelationsQueryData = graphql_post(
            &client,
            api_key,
            QUERY,
            serde_json::json!({ "ids": chunk }),
        )
        .await?;

        for node in data.issues.nodes {
            let (node_state_name, node_state_type) = state_fields(node.state.as_ref());

            for rel in node.relations.nodes {
                if !rel.rel_type.trim().eq_ignore_ascii_case("blocks") {
                    continue;
                }
                let Some(target) = rel.related_issue else {
                    continue;
                };
                if target.id == node.id {
                    continue;
                }
                if !seen_pairs.insert((target.id.clone(), node.id.clone())) {
                    continue;
                }
                let (target_state_name, target_state_type) = state_fields(target.state.as_ref());
                out.push(BlockRelation {
                    blocked_id: target.id,
                    blocked_identifier: target.identifier,
                    blocked_title: target.title,
                    blocked_state_name: target_state_name,
                    blocked_state_type: target_state_type,
                    blocker_id: node.id.clone(),
                    blocker_identifier: node.identifier.clone(),
                    blocker_title: node.title.clone(),
                    blocker_state_name: node_state_name.clone(),
                    blocker_state_type: node_state_type.clone(),
                });
            }

            for inv in node.inverse_relations.nodes {
                if !inv.rel_type.trim().eq_ignore_ascii_case("blocks") {
                    continue;
                }
                let Some(source) = inv.issue else {
                    continue;
                };
                if source.id == node.id {
                    continue;
                }
                if !seen_pairs.insert((node.id.clone(), source.id.clone())) {
                    continue;
                }
                let (source_state_name, source_state_type) = state_fields(source.state.as_ref());
                out.push(BlockRelation {
                    blocked_id: node.id.clone(),
                    blocked_identifier: node.identifier.clone(),
                    blocked_title: node.title.clone(),
                    blocked_state_name: node_state_name.clone(),
                    blocked_state_type: node_state_type.clone(),
                    blocker_id: source.id,
                    blocker_identifier: source.identifier,
                    blocker_title: source.title,
                    blocker_state_name: source_state_name,
                    blocker_state_type: source_state_type,
                });
            }
        }
    }

    Ok(out)
}

pub async fn create_block_relation(
    api_key: &str,
    blocker_id: &str,
    blocked_id: &str,
) -> Result<(), String> {
    let blocker = blocker_id.trim();
    let blocked = blocked_id.trim();
    if blocker.is_empty() || blocked.is_empty() {
        return Err("Blocker and blocked issue ids are required.".to_string());
    }
    if blocker == blocked {
        return Err("An issue cannot block itself.".to_string());
    }

    const MUTATION: &str = r#"
    mutation CreateBlockRelation($blocker: String!, $blocked: String!) {
      issueRelationCreate(input: { issueId: $blocker, relatedIssueId: $blocked, type: blocks }) {
        success
      }
    }
    "#;

    let client = reqwest::Client::new();
    let data: IssueRelationCreateData = graphql_post(
        &client,
        api_key,
        MUTATION,
        serde_json::json!({
            "blocker": blocker,
            "blocked": blocked,
        }),
    )
    .await?;

    let payload = data
        .issue_relation_create
        .ok_or_else(|| "Linear did not return issueRelationCreate payload".to_string())?;

    if !payload.success {
        return Err("Linear failed to create the blocking relation.".to_string());
    }

    Ok(())
}

const MAX_UPLOAD_BYTES: usize = 20 * 1024 * 1024;

/// True for files uploaded to Linear (`https://uploads.linear.app/...`), which need the API key.
pub fn is_linear_upload_url(url: &str) -> bool {
    match reqwest::Url::parse(url.trim()) {
        Ok(u) => u.scheme() == "https" && u.host_str() == Some("uploads.linear.app"),
        Err(_) => false,
    }
}

/// Download an image uploaded to Linear with the API key and return it as a `data:` URL,
/// so the webview can show it without sending credentials itself.
pub async fn fetch_upload_as_data_url(api_key: &str, url: &str) -> Result<String, String> {
    if !is_linear_upload_url(url) {
        return Err("Only Linear upload links (uploads.linear.app) can be fetched.".to_string());
    }
    if api_key.trim().is_empty() {
        return Err("Linear API key is not configured. Add it in Settings.".to_string());
    }
    let res = reqwest::Client::new()
        .get(url.trim())
        .header("Authorization", api_key.trim())
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| format!("Failed to download image: {e}"))?;
    if !res.status().is_success() {
        return Err(format!("Linear returned {} for the image.", res.status()));
    }
    let content_type = res
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.split(';').next().unwrap_or("").trim().to_ascii_lowercase())
        .unwrap_or_default();
    if !content_type.starts_with("image/") {
        return Err(format!("Not an image ({content_type})."));
    }
    if res.content_length().is_some_and(|n| n as usize > MAX_UPLOAD_BYTES) {
        return Err("Image is larger than 20 MB.".to_string());
    }
    let bytes = res
        .bytes()
        .await
        .map_err(|e| format!("Failed to read image: {e}"))?;
    if bytes.len() > MAX_UPLOAD_BYTES {
        return Err("Image is larger than 20 MB.".to_string());
    }
    Ok(format!(
        "data:{content_type};base64,{}",
        crate::devsession::base64_encode(&bytes)
    ))
}

#[cfg(test)]
mod upload_tests {
    use super::is_linear_upload_url;

    #[test]
    fn only_https_linear_uploads() {
        assert!(is_linear_upload_url("https://uploads.linear.app/abc/def/image.png"));
        assert!(!is_linear_upload_url("http://uploads.linear.app/abc"));
        assert!(!is_linear_upload_url("https://uploads.linear.app.evil.com/abc"));
        assert!(!is_linear_upload_url("https://evil.com/?u=https://uploads.linear.app/x"));
        assert!(!is_linear_upload_url("not a url"));
    }
}
