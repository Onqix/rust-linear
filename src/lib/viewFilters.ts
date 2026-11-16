import type {
  BoardColumnConfig,
  FilterField,
  FilterMatchMode,
  FilterOperator,
  FilterRule,
  LinearIssue,
  SavedView,
  ScopeFilter,
  WorkspaceMetadata,
} from "../types";

export function getWorkflowStageRank(stateType: string): number {
  switch (stateType.trim().toLowerCase()) {
    case "backlog":
      return 0;
    case "triage":
      return 1;
    case "unstarted":
      return 2;
    case "started":
      return 3;
    case "completed":
      return 4;
    case "canceled":
    case "cancelled":
      return 5;
    default:
      return 3;
  }
}

export function compareWorkflowStates(
  a: { state_type: string; position: number; name?: string },
  b: { state_type: string; position: number; name?: string }
): number {
  const rankDiff =
    getWorkflowStageRank(a.state_type) - getWorkflowStageRank(b.state_type);
  if (rankDiff !== 0) return rankDiff;
  const posDiff = a.position - b.position;
  if (posDiff !== 0) return posDiff;
  return (a.name ?? "").localeCompare(b.name ?? "");
}

export function normalizeColumnId(label: string): string {
  return label.trim().toLowerCase();
}

export const EMPTY_BOARD_CONFIG: BoardColumnConfig = {
  hiddenColumns: [],
  columnOrder: [],
};

export function parseBoardColumnConfig(
  raw?: string | null
): BoardColumnConfig {
  if (!raw || raw.trim() === "" || raw.trim() === "{}") {
    return { hiddenColumns: [], columnOrder: [] };
  }
  try {
    const parsed = JSON.parse(raw);
    const hiddenColumns = Array.isArray(parsed?.hiddenColumns)
      ? parsed.hiddenColumns
          .map((x: unknown) => normalizeColumnId(String(x)))
          .filter(Boolean)
      : [];
    const columnOrder = Array.isArray(parsed?.columnOrder)
      ? parsed.columnOrder
          .map((x: unknown) => normalizeColumnId(String(x)))
          .filter(Boolean)
      : [];
    return { hiddenColumns, columnOrder };
  } catch {
    return { hiddenColumns: [], columnOrder: [] };
  }
}

export function serializeBoardColumnConfig(cfg: BoardColumnConfig): string {
  return JSON.stringify({
    hiddenColumns: Array.from(
      new Set(cfg.hiddenColumns.map(normalizeColumnId).filter(Boolean))
    ),
    columnOrder: Array.from(
      new Set(cfg.columnOrder.map(normalizeColumnId).filter(Boolean))
    ),
  });
}

export interface CanonicalColumnSpec {
  key: string;
  normId: string;
  label: string;
  stateType: string;
  color: string;
  directStateId?: string;
}

export function getCanonicalBoardColumnSpecs(
  meta: WorkspaceMetadata,
  teamFilter: string
): CanonicalColumnSpec[] {
  const singleTeam =
    teamFilter !== "ALL"
      ? meta.teams.find((t) => t.key === teamFilter) ?? null
      : meta.teams.length === 1
      ? meta.teams[0]
      : null;

  if (singleTeam && singleTeam.states.length > 0) {
    return [...singleTeam.states].sort(compareWorkflowStates).map((st) => ({
      key: st.id,
      normId: normalizeColumnId(st.name),
      label: st.name,
      stateType: st.state_type,
      color: st.color,
      directStateId: st.id,
    }));
  }

  return [
    {
      key: "backlog",
      normId: "backlog",
      label: "Backlog",
      stateType: "backlog",
      color: "#71717a",
    },
    {
      key: "unstarted",
      normId: "todo",
      label: "Todo",
      stateType: "unstarted",
      color: "#94a3b8",
    },
    {
      key: "started",
      normId: "in progress",
      label: "In Progress",
      stateType: "started",
      color: "#f59e0b",
    },
    {
      key: "completed",
      normId: "done",
      label: "Done",
      stateType: "completed",
      color: "#6366f1",
    },
    {
      key: "canceled",
      normId: "canceled",
      label: "Canceled",
      stateType: "canceled",
      color: "#52525b",
    },
  ];
}

export function applyBoardColumnConfig<T extends { label: string }>(
  columns: T[],
  config: BoardColumnConfig
): { orderedAll: T[]; visible: T[]; hiddenSet: Set<string> } {
  const hiddenSet = new Set(config.hiddenColumns.map(normalizeColumnId));
  const orderMap = new Map<string, number>();
  config.columnOrder.forEach((id, idx) => {
    const norm = normalizeColumnId(id);
    if (!orderMap.has(norm)) {
      orderMap.set(norm, idx);
    }
  });

  const orderedAll = columns
    .map((col, idx) => ({
      col,
      idx,
      orderIdx: orderMap.get(normalizeColumnId(col.label)),
    }))
    .sort((a, b) => {
      if (a.orderIdx !== undefined && b.orderIdx !== undefined) {
        return a.orderIdx - b.orderIdx;
      }
      if (a.orderIdx !== undefined) return -1;
      if (b.orderIdx !== undefined) return 1;
      return a.idx - b.idx;
    })
    .map((item) => item.col);

  const visible = orderedAll.filter(
    (c) => !hiddenSet.has(normalizeColumnId(c.label))
  );

  return { orderedAll, visible, hiddenSet };
}

export const VIEW_COLOR_OPTIONS: {
  id: string;
  label: string;
  dotClass: string;
  badgeClass: string;
}[] = [
  {
    id: "indigo",
    label: "Indigo",
    dotClass: "bg-indigo-400",
    badgeClass: "border-indigo-500/40 bg-indigo-500/15 text-indigo-200",
  },
  {
    id: "emerald",
    label: "Emerald",
    dotClass: "bg-emerald-400",
    badgeClass: "border-emerald-500/40 bg-emerald-500/15 text-emerald-200",
  },
  {
    id: "amber",
    label: "Amber",
    dotClass: "bg-amber-400",
    badgeClass: "border-amber-500/40 bg-amber-500/15 text-amber-200",
  },
  {
    id: "rose",
    label: "Rose",
    dotClass: "bg-rose-400",
    badgeClass: "border-rose-500/40 bg-rose-500/15 text-rose-200",
  },
  {
    id: "violet",
    label: "Violet",
    dotClass: "bg-violet-400",
    badgeClass: "border-violet-500/40 bg-violet-500/15 text-violet-200",
  },
  {
    id: "sky",
    label: "Sky",
    dotClass: "bg-sky-400",
    badgeClass: "border-sky-500/40 bg-sky-500/15 text-sky-200",
  },
];

export function getViewColorDot(colorId?: string): string {
  return (
    VIEW_COLOR_OPTIONS.find((c) => c.id === colorId)?.dotClass ??
    "bg-indigo-400"
  );
}

export interface FilterFieldMeta {
  field: FilterField;
  label: string;
  operators: FilterOperator[];
  defaultOperator: FilterOperator;
}

export const FILTER_FIELDS: FilterFieldMeta[] = [
  {
    field: "status",
    label: "Status",
    operators: ["is", "is_not"],
    defaultOperator: "is",
  },
  {
    field: "state_type",
    label: "Status Category",
    operators: ["is", "is_not"],
    defaultOperator: "is",
  },
  {
    field: "priority",
    label: "Priority",
    operators: ["is", "is_not"],
    defaultOperator: "is",
  },
  {
    field: "assignee",
    label: "Assignee",
    operators: ["is", "is_not", "is_set", "is_not_set"],
    defaultOperator: "is",
  },
  {
    field: "label",
    label: "Labels",
    operators: ["is", "is_not", "includes_all", "is_set", "is_not_set"],
    defaultOperator: "is",
  },
  {
    field: "project",
    label: "Project",
    operators: ["is", "is_not", "is_set", "is_not_set"],
    defaultOperator: "is",
  },
  {
    field: "team",
    label: "Team",
    operators: ["is", "is_not"],
    defaultOperator: "is",
  },
  {
    field: "unread",
    label: "Unread Replies",
    operators: ["is", "is_not"],
    defaultOperator: "is",
  },
  {
    field: "text",
    label: "Text / Keyword",
    operators: ["contains", "not_contains"],
    defaultOperator: "contains",
  },
];

export function getFieldMeta(field: FilterField): FilterFieldMeta {
  return (
    FILTER_FIELDS.find((f) => f.field === field) ?? FILTER_FIELDS[0]
  );
}

export function isUnaryOperator(op: FilterOperator): boolean {
  return op === "is_set" || op === "is_not_set";
}

export function formatOperatorLabel(
  field: FilterField,
  operator: FilterOperator,
  valueCount = 1
): string {
  switch (operator) {
    case "is":
      if (field === "label") {
        return valueCount > 1 ? "includes any of" : "includes";
      }
      return valueCount > 1 ? "is any of" : "is";
    case "is_not":
      if (field === "label") {
        return valueCount > 1 ? "excludes all of" : "does not include";
      }
      return valueCount > 1 ? "is not any of" : "is not";
    case "includes_all":
      return "includes all of";
    case "is_set":
      return "is set";
    case "is_not_set":
      return "is not set";
    case "contains":
      return "contains";
    case "not_contains":
      return "does not contain";
  }
}

export function formatOperatorMenuLabel(
  field: FilterField,
  operator: FilterOperator
): string {
  return formatOperatorLabel(field, operator, 1);
}

export interface FieldOption {
  value: string;
  label: string;
  color?: string;
  stateType?: string;
  priority?: number;
  count: number;
}

const PRIORITY_LABELS: Record<string, { label: string; priority: number }> = {
  "1": { label: "Urgent", priority: 1 },
  "2": { label: "High", priority: 2 },
  "3": { label: "Medium", priority: 3 },
  "4": { label: "Low", priority: 4 },
  "0": { label: "No priority", priority: 0 },
};

const STATE_CATEGORIES: {
  value: string;
  label: string;
  stateType: string;
  color: string;
}[] = [
  { value: "triage", label: "Triage", stateType: "triage", color: "#f59e0b" },
  {
    value: "backlog",
    label: "Backlog",
    stateType: "backlog",
    color: "#71717a",
  },
  {
    value: "unstarted",
    label: "Unstarted / Todo",
    stateType: "unstarted",
    color: "#a1a1aa",
  },
  {
    value: "started",
    label: "In Progress",
    stateType: "started",
    color: "#f59e0b",
  },
  {
    value: "completed",
    label: "Completed",
    stateType: "completed",
    color: "#10b981",
  },
  {
    value: "canceled",
    label: "Canceled",
    stateType: "canceled",
    color: "#ef4444",
  },
];

export function buildFieldOptions(
  field: FilterField,
  issues: LinearIssue[],
  meta: WorkspaceMetadata,
  viewerName?: string | null
): FieldOption[] {
  if (field === "status") {
    const map = new Map<
      string,
      { stateType: string; color: string; position: number; count: number }
    >();
    for (const team of meta.teams) {
      for (const st of team.states) {
        if (!map.has(st.name)) {
          map.set(st.name, {
            stateType: st.state_type,
            color: st.color,
            position: st.position,
            count: 0,
          });
        }
      }
    }
    for (const issue of issues) {
      const existing = map.get(issue.state_name);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(issue.state_name, {
          stateType: issue.state_type,
          color: issue.state_color,
          position: 9999,
          count: 1,
        });
      }
    }
    return Array.from(map.entries())
      .sort((a, b) =>
        compareWorkflowStates(
          {
            state_type: a[1].stateType,
            position: a[1].position,
            name: a[0],
          },
          {
            state_type: b[1].stateType,
            position: b[1].position,
            name: b[0],
          }
        )
      )
      .map(([name, info]) => ({
        value: name,
        label: name,
        stateType: info.stateType,
        color: info.color,
        count: info.count,
      }));
  }

  if (field === "state_type") {
    const counts = new Map<string, number>();
    for (const issue of issues) {
      const key = issue.state_type.toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return STATE_CATEGORIES.map((cat) => ({
      value: cat.value,
      label: cat.label,
      stateType: cat.stateType,
      color: cat.color,
      count: counts.get(cat.value) ?? 0,
    }));
  }

  if (field === "priority") {
    const counts = new Map<string, number>();
    for (const issue of issues) {
      const key = String(issue.priority);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return ["1", "2", "3", "4", "0"].map((key) => ({
      value: key,
      label: PRIORITY_LABELS[key].label,
      priority: PRIORITY_LABELS[key].priority,
      count: counts.get(key) ?? 0,
    }));
  }

  if (field === "assignee") {
    const counts = new Map<string, number>();
    let unassignedCount = 0;
    let viewerCount = 0;
    const viewerLower = viewerName?.trim().toLowerCase() || "";
    for (const issue of issues) {
      const name = issue.assignee_name?.trim();
      if (!name) {
        unassignedCount += 1;
      } else {
        counts.set(name, (counts.get(name) ?? 0) + 1);
        if (viewerLower && name.toLowerCase() === viewerLower) {
          viewerCount += 1;
        }
      }
    }
    for (const u of meta.users) {
      if (u.name.trim() && !counts.has(u.name.trim())) {
        counts.set(u.name.trim(), 0);
      }
    }
    const items: FieldOption[] = [
      {
        value: "__VIEWER__",
        label: viewerName?.trim()
          ? `Current user (${viewerName.trim()})`
          : "Current user (Me)",
        count: viewerCount,
      },
      {
        value: "__UNASSIGNED__",
        label: "Unassigned",
        count: unassignedCount,
      },
    ];
    for (const [name, count] of Array.from(counts.entries()).sort((a, b) =>
      a[0].localeCompare(b[0])
    )) {
      items.push({ value: name, label: name, count });
    }
    return items;
  }

  if (field === "team") {
    const map = new Map<string, { name: string; count: number }>();
    for (const t of meta.teams) {
      map.set(t.key, { name: t.name, count: 0 });
    }
    for (const issue of issues) {
      const entry = map.get(issue.team_key);
      if (entry) {
        entry.count += 1;
      } else {
        map.set(issue.team_key, { name: issue.team_name, count: 1 });
      }
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([key, info]) => ({
        value: key,
        label: info.name ? `${key} — ${info.name}` : key,
        count: info.count,
      }));
  }

  if (field === "project") {
    const counts = new Map<string, number>();
    let noneCount = 0;
    for (const issue of issues) {
      const p = issue.project_name?.trim();
      if (!p) {
        noneCount += 1;
      } else {
        counts.set(p, (counts.get(p) ?? 0) + 1);
      }
    }
    for (const p of meta.projects) {
      if (p.name.trim() && !counts.has(p.name.trim())) {
        counts.set(p.name.trim(), 0);
      }
    }
    const items: FieldOption[] = [
      { value: "__NONE__", label: "No project", count: noneCount },
    ];
    for (const [name, count] of Array.from(counts.entries()).sort((a, b) =>
      a[0].localeCompare(b[0])
    )) {
      items.push({ value: name, label: name, count });
    }
    return items;
  }

  if (field === "label") {
    const map = new Map<string, { color: string; count: number }>();
    for (const l of meta.labels) {
      map.set(l.name, { color: l.color, count: 0 });
    }
    for (const issue of issues) {
      for (const l of issue.labels) {
        const existing = map.get(l);
        if (existing) {
          existing.count += 1;
        } else {
          map.set(l, { color: "#6366f1", count: 1 });
        }
      }
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, info]) => ({
        value: name,
        label: name,
        color: info.color,
        count: info.count,
      }));
  }

  if (field === "unread") {
    let unread = 0;
    let read = 0;
    for (const issue of issues) {
      if (issue.unread_responses > 0) unread += 1;
      else read += 1;
    }
    return [
      { value: "unread", label: "Has unread replies", count: unread },
      { value: "read", label: "No unread replies", count: read },
    ];
  }

  return [];
}

export function formatOptionLabel(
  field: FilterField,
  value: string,
  viewerName?: string | null
): string {
  if (field === "priority") {
    return PRIORITY_LABELS[value]?.label ?? value;
  }
  if (field === "state_type") {
    return (
      STATE_CATEGORIES.find((c) => c.value === value)?.label ?? value
    );
  }
  if (field === "assignee") {
    if (value === "__VIEWER__") {
      return viewerName?.trim() || "Me";
    }
    if (value === "__UNASSIGNED__") {
      return "Unassigned";
    }
    return value;
  }
  if (field === "project") {
    return value === "__NONE__" ? "No project" : value;
  }
  if (field === "unread") {
    return value === "unread" ? "Has unread replies" : "No unread replies";
  }
  return value;
}

export function issueMatchesSearchText(
  issue: LinearIssue,
  rawQuery: string
): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;
  return (
    issue.identifier.toLowerCase().includes(q) ||
    issue.title.toLowerCase().includes(q) ||
    (issue.description?.toLowerCase().includes(q) ?? false) ||
    issue.state_name.toLowerCase().includes(q) ||
    (issue.project_name?.toLowerCase().includes(q) ?? false) ||
    (issue.assignee_name?.toLowerCase().includes(q) ?? false) ||
    issue.labels.some((l) => l.toLowerCase().includes(q)) ||
    issue.comments.some((c) => c.body.toLowerCase().includes(q))
  );
}

export function matchesScopeFilter(
  issue: LinearIssue,
  scope: ScopeFilter | string,
  viewerName?: string | null
): boolean {
  const st = issue.state_type.toLowerCase();
  const viewerLower = viewerName?.trim().toLowerCase();
  if (scope === "active") {
    return st !== "completed" && st !== "canceled";
  }
  if (scope === "started") {
    return st === "started";
  }
  if (scope === "backlog") {
    return st === "backlog" || st === "triage";
  }
  if (scope === "completed") {
    return st === "completed";
  }
  if (scope === "mine") {
    return (
      Boolean(viewerLower) &&
      issue.assignee_name?.trim().toLowerCase() === viewerLower
    );
  }
  return true;
}

export function evaluateFilterRule(
  issue: LinearIssue,
  rule: FilterRule,
  viewerName?: string | null
): boolean {
  const op = rule.operator;

  if (rule.field === "text") {
    const query = (rule.values[0] ?? "").trim();
    if (!query) return true;
    const hit = issueMatchesSearchText(issue, query);
    return op === "not_contains" ? !hit : hit;
  }

  if (op === "is_set") {
    switch (rule.field) {
      case "assignee":
        return Boolean(issue.assignee_name?.trim());
      case "project":
        return Boolean(issue.project_name?.trim());
      case "label":
        return issue.labels.length > 0;
      default:
        return true;
    }
  }

  if (op === "is_not_set") {
    switch (rule.field) {
      case "assignee":
        return !issue.assignee_name?.trim();
      case "project":
        return !issue.project_name?.trim();
      case "label":
        return issue.labels.length === 0;
      default:
        return false;
    }
  }

  if (rule.values.length === 0) {
    return true;
  }

  let matched = false;
  switch (rule.field) {
    case "status": {
      matched = rule.values.includes(issue.state_name);
      break;
    }
    case "state_type": {
      const st = issue.state_type.toLowerCase();
      matched = rule.values.includes(st);
      break;
    }
    case "priority": {
      matched = rule.values.includes(String(issue.priority));
      break;
    }
    case "assignee": {
      const name = issue.assignee_name?.trim() || "";
      const viewerLower = viewerName?.trim().toLowerCase();
      matched = rule.values.some((val) => {
        if (val === "__UNASSIGNED__") return name.length === 0;
        if (val === "__VIEWER__") {
          return (
            Boolean(viewerLower) && name.toLowerCase() === viewerLower
          );
        }
        return name === val;
      });
      break;
    }
    case "team": {
      matched = rule.values.includes(issue.team_key);
      break;
    }
    case "project": {
      const p = issue.project_name?.trim() || "";
      matched = rule.values.some((val) =>
        val === "__NONE__" ? p.length === 0 : p === val
      );
      break;
    }
    case "label": {
      if (op === "includes_all") {
        return rule.values.every((val) => issue.labels.includes(val));
      }
      matched = rule.values.some((val) => issue.labels.includes(val));
      break;
    }
    case "unread": {
      const hasUnread = issue.unread_responses > 0;
      matched = rule.values.some((val) =>
        val === "unread" ? hasUnread : !hasUnread
      );
      break;
    }
    default:
      matched = true;
  }

  return op === "is_not" ? !matched : matched;
}

export function matchesFilterRules(
  issue: LinearIssue,
  rules: FilterRule[],
  matchMode: FilterMatchMode,
  viewerName?: string | null
): boolean {
  const activeRules = rules.filter(
    (r) =>
      isUnaryOperator(r.operator) ||
      (r.field === "text"
        ? (r.values[0] ?? "").trim().length > 0
        : r.values.length > 0)
  );
  if (activeRules.length === 0) return true;
  if (matchMode === "any") {
    return activeRules.some((rule) =>
      evaluateFilterRule(issue, rule, viewerName)
    );
  }
  return activeRules.every((rule) =>
    evaluateFilterRule(issue, rule, viewerName)
  );
}

export function parseSavedViewRules(view: SavedView): {
  rules: FilterRule[];
  matchMode: FilterMatchMode;
} {
  const matchMode: FilterMatchMode =
    view.match_mode === "any" ? "any" : "all";

  if (view.filters_json && view.filters_json.trim() !== "") {
    try {
      const parsed = JSON.parse(view.filters_json);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const sanitized: FilterRule[] = parsed
          .filter(
            (r): r is FilterRule =>
              Boolean(r) &&
              typeof r.field === "string" &&
              typeof r.operator === "string" &&
              Array.isArray(r.values)
          )
          .map((r, idx) => ({
            id: r.id || `rule-${idx}-${Date.now()}`,
            field: r.field,
            operator: r.operator,
            values: r.values.map(String),
          }));
        if (sanitized.length > 0) {
          return { rules: sanitized, matchMode };
        }
      }
    } catch {
      // Fall back to legacy columns below
    }
  }

  const migrated: FilterRule[] = [];
  if (view.assignee_filter && view.assignee_filter !== "ALL") {
    migrated.push({
      id: `migrated-assignee-${view.id}`,
      field: "assignee",
      operator: "is",
      values: [
        view.assignee_filter === "UNASSIGNED"
          ? "__UNASSIGNED__"
          : view.assignee_filter,
      ],
    });
  }
  if (view.project_filter && view.project_filter !== "ALL") {
    migrated.push({
      id: `migrated-project-${view.id}`,
      field: "project",
      operator: "is",
      values: [
        view.project_filter === "NONE" ? "__NONE__" : view.project_filter,
      ],
    });
  }
  if (view.label_filter && view.label_filter !== "ALL") {
    migrated.push({
      id: `migrated-label-${view.id}`,
      field: "label",
      operator: "is",
      values: [view.label_filter],
    });
  }
  return { rules: migrated, matchMode };
}

export function matchesSavedView(
  issue: LinearIssue,
  view: SavedView,
  viewerName?: string | null
): boolean {
  if (
    view.team_filter &&
    view.team_filter !== "ALL" &&
    issue.team_key !== view.team_filter
  ) {
    return false;
  }
  if (!matchesScopeFilter(issue, view.scope_filter || "all", viewerName)) {
    return false;
  }
  if (!issueMatchesSearchText(issue, view.search_query || "")) {
    return false;
  }
  const { rules, matchMode } = parseSavedViewRules(view);
  return matchesFilterRules(issue, rules, matchMode, viewerName);
}

export function serializeRulesForView(rules: FilterRule[]): string {
  return JSON.stringify(
    rules.map((r) => ({
      id: r.id,
      field: r.field,
      operator: r.operator,
      values: r.values,
    }))
  );
}

export function toggleHiddenBoardColumn(
  cfg: BoardColumnConfig,
  colNormId: string
): BoardColumnConfig {
  const norm = normalizeColumnId(colNormId);
  const exists = cfg.hiddenColumns.some((c) => normalizeColumnId(c) === norm);
  return {
    ...cfg,
    hiddenColumns: exists
      ? cfg.hiddenColumns.filter((c) => normalizeColumnId(c) !== norm)
      : [...cfg.hiddenColumns, norm],
  };
}

export function moveBoardColumnByStep(
  orderedAllNormIds: string[],
  cfg: BoardColumnConfig,
  colNormId: string,
  delta: -1 | 1
): BoardColumnConfig {
  const norm = normalizeColumnId(colNormId);
  const list = [...orderedAllNormIds];
  const idx = list.indexOf(norm);
  if (idx === -1) return cfg;
  const targetIdx = idx + delta;
  if (targetIdx < 0 || targetIdx >= list.length) return cfg;
  const [moved] = list.splice(idx, 1);
  list.splice(targetIdx, 0, moved);
  return {
    ...cfg,
    columnOrder: list,
  };
}

export function moveBoardColumnToTarget(
  orderedAllNormIds: string[],
  cfg: BoardColumnConfig,
  sourceNormId: string,
  targetNormId: string
): BoardColumnConfig {
  const src = normalizeColumnId(sourceNormId);
  const dst = normalizeColumnId(targetNormId);
  if (src === dst) return cfg;
  const list = [...orderedAllNormIds];
  const srcIdx = list.indexOf(src);
  const dstIdx = list.indexOf(dst);
  if (srcIdx === -1 || dstIdx === -1) return cfg;
  const [moved] = list.splice(srcIdx, 1);
  list.splice(dstIdx, 0, moved);
  return {
    ...cfg,
    columnOrder: list,
  };
}
