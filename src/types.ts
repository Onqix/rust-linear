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

export interface LinearLinkedItem {
  kind: string;
  relation_label: string;
  id: string;
  identifier: string | null;
  title: string;
  subtitle: string | null;
  url: string;
  state_name: string | null;
  state_type: string | null;
  state_color: string | null;
  source_type: string | null;
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
  completed_at?: string | null;
  last_seen_at: string | null;
  unread_responses: number;
  comments: LinearComment[];
  links?: LinearLinkedItem[];
  links_loaded?: boolean;
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

export interface BoardColumnConfig {
  hiddenColumns: string[];
  columnOrder: string[];
}

export interface SavedView {
  id: string;
  name: string;
  icon?: string;
  match_mode?: FilterMatchMode;
  filters_json?: string;
  board_columns_json?: string;
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

export interface LinearProjectTeamRef {
  id: string;
  key: string;
  name: string;
}

export interface LinearProjectDetail {
  id: string;
  name: string;
  description: string;
  icon: string | null;
  color: string;
  url: string;
  progress: number;
  target_date: string | null;
  start_date: string | null;
  updated_at: string;
  health: string | null;
  lead_id: string | null;
  lead_name: string | null;
  status_id: string;
  status_name: string;
  status_type: string;
  status_color: string;
  status_position: number;
  teams: LinearProjectTeamRef[];
}

export interface LinearProjectStatusOption {
  id: string;
  name: string;
  status_type: string;
  color: string;
  position: number;
}

export interface ProjectsOverview {
  projects: LinearProjectDetail[];
  statuses: LinearProjectStatusOption[];
}

export interface CreateProjectInput {
  name: string;
  team_ids: string[];
  description?: string | null;
  status_id?: string | null;
  lead_id?: string | null;
  target_date?: string | null;
  start_date?: string | null;
}

export interface UpdateProjectPatch {
  name?: string;
  description?: string;
  status_id?: string;
  lead_id?: string;
  target_date?: string;
  start_date?: string;
}

export interface BacklogEntry {
  issue_id: string;
  position: number;
  note: string;
  group_name: string | null;
  added_by: "me" | "claude" | string;
  updated_at: string;
}

export interface BacklogGroup {
  name: string;
  reason: string;
  position: number;
}

export interface BridgeSettings {
  server_enabled: boolean;
  port: number;
  token: string;
  tunnel_enabled: boolean;
  ssh_target: string;
  remote_port: number;
  rerank_ssh_target: string;
  rerank_command: string;
  dev_command: string;
  dev_model: string;
  dev_effort: string;
}

export interface RerankRun {
  id: string;
  comment: string;
  status: "running" | "succeeded" | "failed" | string;
  started_at: string;
  finished_at: string | null;
  summary: string | null;
  error: string | null;
}

export interface DevSession {
  id: string;
  name: string;
  slug: string;
  note: string;
  delivery: "per_issue" | "combined" | string;
  model: string | null;
  effort: string | null;
  status: "starting" | "running" | "failed" | "stopped" | "ended" | string;
  agent_status: string | null;
  bg_id: string | null;
  error: string | null;
  started_at: string;
  updated_at: string;
}

export interface DevSessionItemView {
  session_id: string;
  issue_id: string;
  position: number;
  status: "queued" | "in_progress" | "split" | "blocked" | "done" | "removed" | string;
  note: string | null;
  updated_at: string;
  identifier: string | null;
  title: string | null;
  state: string | null;
  url: string | null;
}

export interface DevSessionView {
  session: DevSession;
  items: DevSessionItemView[];
}

export interface BridgeStatus {
  server_running: boolean;
  server_error: string | null;
  port: number;
  last_request_at: string | null;
  tunnel_state: "off" | "connecting" | "connected" | "error" | string;
  tunnel_error: string | null;
  tunnel_since: string | null;
}

export type ActiveTab =
  | "latest"
  | "responses"
  | "triage"
  | "backlog"
  | "projects"
  | "insights";
export type ScopeFilter =
  | "all"
  | "active"
  | "started"
  | "backlog"
  | "completed"
  | "mine";
export type LayoutMode = "list" | "board";
export type ThemeMode = "dark" | "light";
