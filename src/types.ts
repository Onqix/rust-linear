export interface AppSettings {
  linear_api_key: string;
  anthropic_api_key: string;
  claude_model: string;
  viewer_id: string | null;
  viewer_name: string | null;
  auto_sync_seconds: number;
  notifications_enabled: boolean;
}

export interface LinearComment {
  id: string;
  body: string;
  created_at: string;
  author_id: string | null;
  author_name: string;
  is_unread: boolean;
}

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  url: string;
  priority: number;
  priority_label: string;
  state_id: string;
  state_name: string;
  state_type: string;
  state_color: string;
  team_id: string;
  team_key: string;
  team_name: string;
  project_id: string | null;
  project_name: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  labels: string[];
  label_ids: string[];
  updated_at: string;
  created_at: string;
  last_seen_at: string | null;
  unread_responses: number;
  comments: LinearComment[];
}

export interface LinearWorkflowState {
  id: string;
  name: string;
  state_type: string;
  color: string;
  position: number;
}

export interface LinearTeam {
  id: string;
  key: string;
  name: string;
  states: LinearWorkflowState[];
}

export interface LinearUser {
  id: string;
  name: string;
}

export interface LinearProject {
  id: string;
  name: string;
}

export interface LinearLabel {
  id: string;
  name: string;
  color: string;
  team_id: string | null;
}

export interface WorkspaceMetadata {
  teams: LinearTeam[];
  users: LinearUser[];
  projects: LinearProject[];
  labels: LinearLabel[];
}

export type FilterField =
  | "status"
  | "state_type"
  | "priority"
  | "assignee"
  | "team"
  | "project"
  | "label"
  | "unread"
  | "text";

export type FilterOperator =
  | "is"
  | "is_not"
  | "includes_all"
  | "is_set"
  | "is_not_set"
  | "contains"
  | "not_contains";

export type FilterMatchMode = "all" | "any";

export interface FilterRule {
  id: string;
  field: FilterField;
  operator: FilterOperator;
  values: string[];
}

export interface SavedView {
  id: string;
  name: string;
  icon?: string;
  match_mode?: FilterMatchMode;
  filters_json?: string;
  team_filter: string;
  scope_filter: string;
  assignee_filter: string;
  project_filter: string;
  label_filter: string;
  search_query: string;
  layout_mode: string;
  created_at?: string;
}

export interface CreateIssueInput {
  team_id: string;
  title: string;
  description?: string | null;
  state_id?: string | null;
  priority?: number | null;
  assignee_id?: string | null;
  project_id?: string | null;
  label_ids?: string[] | null;
}

export interface UpdateIssuePatch {
  title?: string;
  description?: string;
  state_id?: string;
  priority?: number;
  assignee_id?: string;
  project_id?: string;
  label_ids?: string[];
}

export interface CreateIssueResponse {
  created_id: string;
  issues: LinearIssue[];
}

export interface AiSuggestion {
  identifier: string;
  title: string;
  reason: string;
  urgency: "high" | "medium" | "low" | string;
}

export interface AiWorkBucket {
  name: string;
  description: string;
  tickets: AiSuggestion[];
}

export interface AiTriageResult {
  generated_at: string;
  model: string;
  summary: string;
  next_to_grab: AiSuggestion[];
  work_buckets: AiWorkBucket[];
}

export interface ClaudeModelOption {
  id: string;
  display_name: string;
}

export type ActiveTab = "latest" | "responses" | "triage";
export type ScopeFilter =
  | "all"
  | "active"
  | "started"
  | "backlog"
  | "completed"
  | "mine";
export type LayoutMode = "list" | "board";
