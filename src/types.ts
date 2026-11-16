export interface AppSettings {
  linear_api_key: string;
  anthropic_api_key: string;
  claude_model: string;
  viewer_id: string | null;
  viewer_name: string | null;
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
  state_name: string;
  state_type: string;
  state_color: string;
  team_key: string;
  team_name: string;
  assignee_name: string | null;
  labels: string[];
  updated_at: string;
  created_at: string;
  last_seen_at: string | null;
  unread_responses: number;
  comments: LinearComment[];
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

export type ActiveTab = "latest" | "responses" | "triage";
