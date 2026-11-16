import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { openExternalUrl } from "./lib/openExternal";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  AlertCircle,
  Bell,
  Bookmark,
  CheckCheck,
  Clock,
  Columns3,
  Download,
  Flame,
  FolderKanban,
  Globe,
  Hand,
  Inbox,
  Layers,
  List as ListIcon,
  MessageSquare,
  Monitor,
  Plus,
  RefreshCw,
  Reply,
  Search,
  Settings,
  Sparkles,
  Tag,
  User,
  X,
  Zap,
} from "lucide-react";
import type {
  ActiveTab,
  AiTriageResult,
  AppSettings,
  ClaudeModelOption,
  CreateIssueInput,
  CreateIssueResponse,
  LayoutMode,
  LinearIssue,
  SavedView,
  ScopeFilter,
  UpdateIssuePatch,
  WorkspaceMetadata,
} from "./types";
import {
  AuthorAvatar,
  BrandLogo,
  PriorityIcon,
  StateIcon,
} from "./components/Icons";
import { MarkdownBody } from "./components/MarkdownBody";
import { IssueDetail } from "./components/IssueDetail";
import { ModelSelect } from "./components/ModelSelect";
import { DarkSelect, type DarkSelectOption } from "./components/DarkSelect";
import { CreateIssueModal } from "./components/CreateIssueModal";
import { KanbanBoard } from "./components/KanbanBoard";

const DEFAULT_CLAUDE_MODELS: ClaudeModelOption[] = [
  { id: "claude-haiku-4-5", display_name: "Claude Haiku 4.5" },
  { id: "claude-sonnet-4-6", display_name: "Claude Sonnet 4.6" },
];

const AUTO_SYNC_OPTIONS: DarkSelectOption[] = [
  { value: "30", label: "Every 30s" },
  { value: "60", label: "Every 1 min" },
  { value: "120", label: "Every 2 min" },
  { value: "300", label: "Every 5 min" },
  { value: "0", label: "Manual only" },
];

function formatSyncInterval(seconds: number): string {
  if (seconds <= 0) return "Manual sync";
  if (seconds < 60) return `Auto ${seconds}s`;
  return `Auto ${Math.round(seconds / 60)}m`;
}

const EMPTY_META: WorkspaceMetadata = {
  teams: [],
  users: [],
  projects: [],
  labels: [],
};

const SCOPE_OPTIONS: { id: ScopeFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "started", label: "In Progress" },
  { id: "backlog", label: "Backlog" },
  { id: "completed", label: "Done" },
  { id: "mine", label: "Mine" },
];

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function urgencyClass(urgency: string) {
  switch (urgency.toLowerCase()) {
    case "high":
      return "text-rose-300 bg-rose-500/15 border-rose-500/30";
    case "medium":
      return "text-amber-300 bg-amber-500/15 border-amber-500/30";
    default:
      return "text-emerald-300 bg-emerald-500/15 border-emerald-500/30";
  }
}

function bucketTheme(name: string) {
  const lower = name.toLowerCase();
  if (lower.includes("reply")) {
    return {
      icon: Reply,
      accent: "text-indigo-300 bg-indigo-500/15 border-indigo-500/30",
      border: "border-indigo-500/25",
    };
  }
  if (lower.includes("quick")) {
    return {
      icon: Zap,
      accent: "text-emerald-300 bg-emerald-500/15 border-emerald-500/30",
      border: "border-emerald-500/25",
    };
  }
  if (lower.includes("block") || lower.includes("wait")) {
    return {
      icon: Clock,
      accent: "text-amber-300 bg-amber-500/15 border-amber-500/30",
      border: "border-amber-500/25",
    };
  }
  return {
    icon: Flame,
    accent: "text-violet-300 bg-violet-500/15 border-violet-500/30",
    border: "border-violet-500/25",
  };
}

function stripMarkdownPreview(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, "[code]")
    .replace(/[#>*_`]/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("latest");
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("list");
  const [issues, setIssues] = useState<LinearIssue[]>([]);
  const [workspaceMeta, setWorkspaceMeta] =
    useState<WorkspaceMetadata>(EMPTY_META);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [triageDrawerId, setTriageDrawerId] = useState<string | null>(null);
  const [boardDrawerId, setBoardDrawerId] = useState<string | null>(null);

  const [teamFilter, setTeamFilter] = useState<string>("ALL");
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("ALL");
  const [projectFilter, setProjectFilter] = useState<string>("ALL");
  const [labelFilter, setLabelFilter] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [visibleLimit, setVisibleLimit] = useState(100);

  const [settings, setSettings] = useState<AppSettings>({
    linear_api_key: "",
    anthropic_api_key: "",
    claude_model: "claude-haiku-4-5",
    viewer_id: null,
    viewer_name: null,
    auto_sync_seconds: 60,
    notifications_enabled: true,
  });
  const [triage, setTriage] = useState<AiTriageResult | null>(null);

  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [searchingRemote, setSearchingRemote] = useState(false);
  const [triaging, setTriaging] = useState(false);
  const [grabbingId, setGrabbingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notifyTestMsg, setNotifyTestMsg] = useState<string | null>(null);

  const [showSettings, setShowSettings] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showSaveView, setShowSaveView] = useState(false);
  const [newViewName, setNewViewName] = useState("");

  const [appVersion, setAppVersion] = useState("0.3.5");
  const [pendingUpdate, setPendingUpdate] = useState<{
    version: string;
    body?: string | null;
  } | null>(null);
  const [updateStatus, setUpdateStatus] = useState<
    "idle" | "checking" | "available" | "installing" | "up-to-date" | "error"
  >("idle");
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);

  const [claudeModels, setClaudeModels] = useState<ClaudeModelOption[]>(
    DEFAULT_CLAUDE_MODELS
  );
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [desktopInstallMsg, setDesktopInstallMsg] = useState<string | null>(
    null
  );

  const searchRef = useRef<HTMLInputElement>(null);
  const appVersionRef = useRef(appVersion);
  appVersionRef.current = appVersion;
  const checkingUpdateRef = useRef(false);
  const updateStatusRef = useRef(updateStatus);
  updateStatusRef.current = updateStatus;
  const syncInFlightRef = useRef(false);
  const lastSyncedAtRef = useRef(0);

  async function loadClaudeModels(
    keyOverride?: string,
    settingsSnapshot?: AppSettings
  ) {
    setLoadingModels(true);
    setModelsError(null);
    try {
      const models = await invoke<ClaudeModelOption[]>("list_claude_models", {
        apiKey: keyOverride?.trim() ? keyOverride.trim() : null,
      });
      if (models.length > 0) {
        setClaudeModels(models);
        const target = settingsSnapshot ?? settings;
        const currentExists = models.some((m) => m.id === target.claude_model);
        if (!currentExists) {
          const fallbackId =
            models.find((m) => m.id.toLowerCase().includes("haiku"))?.id ??
            models[0].id;
          setSettings((prev) => ({ ...prev, claude_model: fallbackId }));
          if (target.anthropic_api_key.trim()) {
            try {
              await invoke<AppSettings>("save_settings", {
                linearApiKey: target.linear_api_key,
                anthropicApiKey: target.anthropic_api_key,
                claudeModel: fallbackId,
              });
            } catch {
              // Ignore persistence error if user hasn't saved yet
            }
          }
        }
      }
    } catch (err) {
      setModelsError(String(err));
    } finally {
      setLoadingModels(false);
    }
  }

  async function checkForUpdates(silent: boolean) {
    if (checkingUpdateRef.current || updateStatusRef.current === "installing") {
      return;
    }
    checkingUpdateRef.current = true;
    if (!silent) {
      setUpdateMessage(null);
    }
    try {
      setUpdateStatus("checking");
      let update: { version: string; body?: string | null } | null = null;
      try {
        update = await invoke<{ version: string; body?: string | null } | null>(
          "check_app_update"
        );
      } catch {
        const fallback = await check();
        update = fallback
          ? { version: fallback.version, body: fallback.body }
          : null;
      }
      if (update) {
        setPendingUpdate(update);
        setUpdateStatus("available");
        if (!silent) {
          setUpdateMessage(`v${update.version} is ready to install`);
        }
      } else {
        setPendingUpdate(null);
        setUpdateStatus("up-to-date");
        if (!silent) {
          setUpdateMessage(
            `You're on the latest version (v${appVersionRef.current})`
          );
        }
      }
    } catch (err) {
      if (silent) {
        setUpdateStatus("idle");
      } else {
        setUpdateStatus("error");
        setUpdateMessage(String(err));
      }
    } finally {
      checkingUpdateRef.current = false;
    }
  }

  useEffect(() => {
    (async () => {
      try {
        const ver = await getVersion();
        setAppVersion(ver);
        appVersionRef.current = ver;
      } catch {
        // Running outside Tauri (e.g. vite dev in browser)
      }

      try {
        const [
          loadedSettings,
          cachedIssues,
          cachedMeta,
          loadedViews,
          cachedTriage,
        ] = await Promise.all([
          invoke<AppSettings>("get_settings"),
          invoke<LinearIssue[]>("get_issues"),
          invoke<WorkspaceMetadata>("get_workspace_meta"),
          invoke<SavedView[]>("get_saved_views"),
          invoke<AiTriageResult | null>("get_cached_triage"),
        ]);

        setSettings(loadedSettings);
        if (loadedSettings.anthropic_api_key.trim()) {
          void loadClaudeModels(
            loadedSettings.anthropic_api_key,
            loadedSettings
          );
        }
        setIssues(cachedIssues);
        if (cachedIssues.length > 0) {
          setSelectedId(cachedIssues[0].id);
        }
        setWorkspaceMeta(cachedMeta);
        setSavedViews(loadedViews);
        if (cachedTriage) setTriage(cachedTriage);

        if (loadedSettings.linear_api_key.trim()) {
          void handleSyncRef.current(false, cachedIssues.length > 0);
        }
      } catch (err) {
        console.warn("Initial load skipped or failed:", err);
      }

      void checkForUpdates(true);
    })();

    const interval = setInterval(() => {
      void checkForUpdates(true);
    }, 45 * 1000);
    const onWindowFocus = () => {
      void checkForUpdates(true);
    };
    window.addEventListener("focus", onWindowFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", onWindowFocus);
    };
  }, []);

  useEffect(() => {
    const secs = settings.auto_sync_seconds;
    if (!settings.linear_api_key.trim() || secs <= 0) return;

    const timer = setInterval(() => {
      void handleSyncRef.current(false, true);
    }, secs * 1000);

    const onFocus = () => {
      if (Date.now() - lastSyncedAtRef.current > 25_000) {
        void handleSyncRef.current(false, true);
      }
    };
    window.addEventListener("focus", onFocus);

    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [settings.auto_sync_seconds, settings.linear_api_key]);

  useEffect(() => {
    setVisibleLimit(100);
  }, [
    activeTab,
    teamFilter,
    scopeFilter,
    assigneeFilter,
    projectFilter,
    labelFilter,
    search,
  ]);

  const unreadIssuesCount = useMemo(
    () => issues.filter((i) => i.unread_responses > 0).length,
    [issues]
  );

  const stats = useMemo(() => {
    let active = 0;
    let started = 0;
    for (const issue of issues) {
      const t = issue.state_type.toLowerCase();
      if (t !== "completed" && t !== "canceled") {
        active += 1;
      }
      if (t === "started") {
        started += 1;
      }
    }
    return { active, started };
  }, [issues]);

  const teamCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of issues) {
      counts.set(i.team_key, (counts.get(i.team_key) ?? 0) + 1);
    }
    for (const t of workspaceMeta.teams) {
      if (!counts.has(t.key)) counts.set(t.key, 0);
    }
    return [
      { key: "ALL", count: issues.length },
      ...Array.from(counts.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([key, count]) => ({ key, count })),
    ];
  }, [issues, workspaceMeta.teams]);

  const assigneeFilterOptions: DarkSelectOption[] = useMemo(() => {
    const names = new Set<string>();
    for (const u of workspaceMeta.users) names.add(u.name);
    for (const i of issues) {
      if (i.assignee_name) names.add(i.assignee_name);
    }
    return [
      {
        value: "ALL",
        label: "All assignees",
        icon: <User className="h-3 w-3 text-zinc-500" />,
      },
      { value: "UNASSIGNED", label: "Unassigned" },
      ...Array.from(names)
        .sort((a, b) => a.localeCompare(b))
        .map((n) => ({
          value: n,
          label: n,
          icon: <AuthorAvatar name={n} size="sm" />,
        })),
    ];
  }, [workspaceMeta.users, issues]);

  const projectFilterOptions: DarkSelectOption[] = useMemo(() => {
    const names = new Set<string>();
    for (const p of workspaceMeta.projects) names.add(p.name);
    for (const i of issues) {
      if (i.project_name) names.add(i.project_name);
    }
    return [
      {
        value: "ALL",
        label: "All projects",
        icon: <FolderKanban className="h-3 w-3 text-zinc-500" />,
      },
      { value: "NONE", label: "No project" },
      ...Array.from(names)
        .sort((a, b) => a.localeCompare(b))
        .map((n) => ({ value: n, label: n })),
    ];
  }, [workspaceMeta.projects, issues]);

  const labelFilterOptions: DarkSelectOption[] = useMemo(() => {
    const map = new Map<string, string>();
    for (const l of workspaceMeta.labels) map.set(l.name, l.color);
    for (const i of issues) {
      for (const l of i.labels) {
        if (!map.has(l)) map.set(l, "#6366f1");
      }
    }
    return [
      {
        value: "ALL",
        label: "All labels",
        icon: <Tag className="h-3 w-3 text-zinc-500" />,
      },
      ...Array.from(map.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([name, color]) => ({
          value: name,
          label: name,
          colorDot: color,
        })),
    ];
  }, [workspaceMeta.labels, issues]);

  const issuesByIdentifier = useMemo(() => {
    const map = new Map<string, LinearIssue>();
    for (const issue of issues) {
      map.set(issue.identifier.toUpperCase(), issue);
    }
    return map;
  }, [issues]);

  const knownIdentifiers = useMemo(
    () => new Set(issuesByIdentifier.keys()),
    [issuesByIdentifier]
  );

  const filteredIssues = useMemo(() => {
    const q = search.trim().toLowerCase();
    const viewerNameLower = settings.viewer_name?.trim().toLowerCase();
    return issues.filter((issue) => {
      if (activeTab === "responses" && issue.unread_responses === 0) {
        return false;
      }
      if (teamFilter !== "ALL" && issue.team_key !== teamFilter) {
        return false;
      }

      const st = issue.state_type.toLowerCase();
      if (
        scopeFilter === "active" &&
        (st === "completed" || st === "canceled")
      ) {
        return false;
      }
      if (scopeFilter === "started" && st !== "started") {
        return false;
      }
      if (scopeFilter === "backlog" && st !== "backlog" && st !== "triage") {
        return false;
      }
      if (scopeFilter === "completed" && st !== "completed") {
        return false;
      }
      if (
        scopeFilter === "mine" &&
        (!viewerNameLower ||
          issue.assignee_name?.trim().toLowerCase() !== viewerNameLower)
      ) {
        return false;
      }

      if (assigneeFilter === "UNASSIGNED" && issue.assignee_name) {
        return false;
      }
      if (
        assigneeFilter !== "ALL" &&
        assigneeFilter !== "UNASSIGNED" &&
        issue.assignee_name !== assigneeFilter
      ) {
        return false;
      }

      if (projectFilter === "NONE" && issue.project_name) {
        return false;
      }
      if (
        projectFilter !== "ALL" &&
        projectFilter !== "NONE" &&
        issue.project_name !== projectFilter
      ) {
        return false;
      }

      if (labelFilter !== "ALL" && !issue.labels.includes(labelFilter)) {
        return false;
      }

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
    });
  }, [
    issues,
    activeTab,
    teamFilter,
    scopeFilter,
    assigneeFilter,
    projectFilter,
    labelFilter,
    search,
    settings.viewer_name,
  ]);

  const visibleListIssues = useMemo(
    () => filteredIssues.slice(0, visibleLimit),
    [filteredIssues, visibleLimit]
  );

  const selectedIssue = useMemo(
    () => issues.find((i) => i.id === selectedId) ?? null,
    [issues, selectedId]
  );

  const triageDrawerIssue = useMemo(
    () => issues.find((i) => i.id === triageDrawerId) ?? null,
    [issues, triageDrawerId]
  );

  const boardDrawerIssue = useMemo(
    () => issues.find((i) => i.id === boardDrawerId) ?? null,
    [issues, boardDrawerId]
  );

  const activeIssue =
    activeTab === "triage"
      ? triageDrawerIssue
      : layoutMode === "board"
      ? boardDrawerIssue
      : selectedIssue;

  const modelSelectOptions = useMemo(() => {
    const current = settings.claude_model.trim();
    if (!current || claudeModels.some((m) => m.id === current)) {
      return claudeModels;
    }
    return [{ id: current, display_name: current }, ...claudeModels];
  }, [claudeModels, settings.claude_model]);

  async function handleSync(fullResync = false, background = false) {
    if (syncInFlightRef.current) return;
    syncInFlightRef.current = true;
    if (!background) {
      setError(null);
      setSyncing(true);
    }
    try {
      const fresh = await invoke<LinearIssue[]>("sync_linear", {
        fullResync,
        background,
      });
      setIssues(fresh);
      const now = Date.now();
      lastSyncedAtRef.current = now;
      setLastSyncedAt(now);

      if (!background || workspaceMeta.teams.length === 0) {
        const freshMeta = await invoke<WorkspaceMetadata>("get_workspace_meta");
        setWorkspaceMeta(freshMeta);
        const freshSettings = await invoke<AppSettings>("get_settings");
        setSettings(freshSettings);
      }
      if (!selectedId && fresh.length > 0) {
        setSelectedId(fresh[0].id);
      }
    } catch (err) {
      if (!background) {
        setError(String(err));
      }
    } finally {
      syncInFlightRef.current = false;
      if (!background) {
        setSyncing(false);
      }
    }
  }

  const handleSyncRef = useRef(handleSync);
  handleSyncRef.current = handleSync;

  async function handleRemoteSearch() {
    const q = search.trim();
    if (q.length < 2 || searchingRemote) return;
    setError(null);
    setSearchingRemote(true);
    try {
      const updated = await invoke<LinearIssue[]>("search_linear_remote", {
        term: q,
      });
      setIssues(updated);
    } catch (err) {
      setError(String(err));
    } finally {
      setSearchingRemote(false);
    }
  }

  async function handleCreateIssue(input: CreateIssueInput) {
    const res = await invoke<CreateIssueResponse>("create_issue", { input });
    setIssues(res.issues);
    setSelectedId(res.created_id);
    if (activeTab === "triage") {
      setTriageDrawerId(res.created_id);
    } else if (layoutMode === "board") {
      setBoardDrawerId(res.created_id);
    }
    setShowCreateModal(false);
  }

  async function handleUpdateIssue(issueId: string, patch: UpdateIssuePatch) {
    setError(null);
    try {
      const updated = await invoke<LinearIssue[]>("update_issue", {
        issueId,
        patch,
      });
      setIssues(updated);
    } catch (err) {
      setError(String(err));
      throw err;
    }
  }

  async function handleMoveBoardIssueState(
    issue: LinearIssue,
    targetStateId: string
  ) {
    const team = workspaceMeta.teams.find(
      (t) => t.id === issue.team_id || t.key === issue.team_key
    );
    const targetState = team?.states.find((s) => s.id === targetStateId);
    const snapshot = issues;

    if (targetState) {
      setIssues((prev) =>
        prev.map((i) =>
          i.id === issue.id
            ? {
                ...i,
                state_id: targetState.id,
                state_name: targetState.name,
                state_type: targetState.state_type,
                state_color: targetState.color,
              }
            : i
        )
      );
    }

    try {
      const updated = await invoke<LinearIssue[]>("update_issue", {
        issueId: issue.id,
        patch: { state_id: targetStateId },
      });
      setIssues(updated);
    } catch (err) {
      setIssues(snapshot);
      setError(String(err));
    }
  }

  async function handleGrabTicket(issue: LinearIssue) {
    setError(null);
    setGrabbingId(issue.id);
    try {
      const team = workspaceMeta.teams.find(
        (t) => t.id === issue.team_id || t.key === issue.team_key
      );
      const startedState = team?.states.find(
        (s) => s.state_type.toLowerCase() === "started"
      );
      const patch: UpdateIssuePatch = {};
      if (settings.viewer_id) {
        patch.assignee_id = settings.viewer_id;
      }
      if (startedState && startedState.id !== issue.state_id) {
        patch.state_id = startedState.id;
      }
      if (Object.keys(patch).length === 0) {
        setTriageDrawerId(issue.id);
        return;
      }
      const updated = await invoke<LinearIssue[]>("update_issue", {
        issueId: issue.id,
        patch,
      });
      setIssues(updated);
    } catch (err) {
      setError(String(err));
    } finally {
      setGrabbingId(null);
    }
  }

  async function handleAddComment(issueId: string, body: string) {
    setError(null);
    try {
      const updated = await invoke<LinearIssue[]>("add_comment", {
        issueId,
        body,
      });
      setIssues(updated);
    } catch (err) {
      setError(String(err));
      throw err;
    }
  }

  async function handleRefreshIssue(issueId: string) {
    setError(null);
    try {
      const updated = await invoke<LinearIssue[]>("refresh_issue_detail", {
        issueId,
      });
      setIssues(updated);
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleRunTriage() {
    setError(null);
    setTriaging(true);
    setActiveTab("triage");
    try {
      const res = await invoke<AiTriageResult>("run_ai_triage");
      setTriage(res);
    } catch (err) {
      setError(String(err));
    } finally {
      setTriaging(false);
    }
  }

  async function handleMarkSeen(issueId: string) {
    try {
      const updated = await invoke<LinearIssue[]>("mark_issue_seen", {
        issueId,
      });
      setIssues(updated);
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleMarkAllSeen() {
    try {
      const updated = await invoke<LinearIssue[]>("mark_all_seen");
      setIssues(updated);
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleMarkUnread(issueId: string) {
    try {
      const updated = await invoke<LinearIssue[]>("mark_issue_unread", {
        issueId,
      });
      setIssues(updated);
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleSaveCustomView(e: React.FormEvent) {
    e.preventDefault();
    const name = newViewName.trim();
    if (!name) return;
    setError(null);
    try {
      const id = `view-${Date.now()}`;
      const view: SavedView = {
        id,
        name,
        team_filter: teamFilter,
        scope_filter: scopeFilter,
        assignee_filter: assigneeFilter,
        project_filter: projectFilter,
        label_filter: labelFilter,
        search_query: search,
        layout_mode: layoutMode,
      };
      const updated = await invoke<SavedView[]>("save_custom_view", { view });
      setSavedViews(updated);
      setActiveViewId(id);
      setNewViewName("");
      setShowSaveView(false);
    } catch (err) {
      setError(String(err));
    }
  }

  function applySavedView(view: SavedView) {
    setActiveTab("latest");
    setActiveViewId(view.id);
    setTeamFilter(view.team_filter || "ALL");
    setScopeFilter((view.scope_filter as ScopeFilter) || "all");
    setAssigneeFilter(view.assignee_filter || "ALL");
    setProjectFilter(view.project_filter || "ALL");
    setLabelFilter(view.label_filter || "ALL");
    setSearch(view.search_query || "");
    setLayoutMode(view.layout_mode === "board" ? "board" : "list");
    setTriageDrawerId(null);
    setBoardDrawerId(null);
  }

  async function handleDeleteSavedView(viewId: string) {
    try {
      const updated = await invoke<SavedView[]>("delete_saved_view", {
        viewId,
      });
      setSavedViews(updated);
      if (activeViewId === viewId) setActiveViewId(null);
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleInstallDesktopIcon() {
    setDesktopInstallMsg(null);
    try {
      const msg = await invoke<string>("install_desktop_entry");
      setDesktopInstallMsg(msg);
    } catch (err) {
      setDesktopInstallMsg(String(err));
    }
  }

  async function handleTestNotification() {
    setNotifyTestMsg(null);
    try {
      await invoke("test_notification");
      setNotifyTestMsg("Sent test notification to Ubuntu desktop.");
    } catch (err) {
      setNotifyTestMsg(String(err));
    }
  }

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const saved = await invoke<AppSettings>("save_settings", {
        linearApiKey: settings.linear_api_key,
        anthropicApiKey: settings.anthropic_api_key,
        claudeModel: settings.claude_model,
        autoSyncSeconds: settings.auto_sync_seconds,
        notificationsEnabled: settings.notifications_enabled,
      });
      setSettings(saved);
      setShowSettings(false);
      if (saved.anthropic_api_key.trim()) {
        void loadClaudeModels(saved.anthropic_api_key, saved);
      }
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleModelQuickChange(nextModel: string) {
    setSettings((s) => ({ ...s, claude_model: nextModel }));
    try {
      const saved = await invoke<AppSettings>("save_settings", {
        linearApiKey: settings.linear_api_key,
        anthropicApiKey: settings.anthropic_api_key,
        claudeModel: nextModel,
      });
      setSettings(saved);
    } catch (err) {
      setError(String(err));
    }
  }

  function handleOpenSettings() {
    setDesktopInstallMsg(null);
    setNotifyTestMsg(null);
    setShowSettings(true);
    if (settings.anthropic_api_key.trim()) {
      void loadClaudeModels(settings.anthropic_api_key);
    }
  }

  async function handleInstallUpdate() {
    if (!pendingUpdate || updateStatusRef.current === "installing") return;
    setUpdateMessage(null);
    setError(null);
    try {
      setUpdateStatus("installing");
      setUpdateMessage(`Installing latest release (v${pendingUpdate.version})...`);
      let installedVersion = pendingUpdate.version;
      try {
        installedVersion = await invoke<string>("install_app_update");
      } catch (invokeErr) {
        const msg = String(invokeErr);
        if (msg.includes("not found") || msg.includes("Command")) {
          const latest = await check();
          if (!latest) {
            throw new Error("No update is currently available.");
          }
          installedVersion = latest.version;
          await latest.downloadAndInstall();
        } else {
          throw invokeErr;
        }
      }
      setUpdateMessage(`Restarting into v${installedVersion}...`);
      try {
        await invoke("relaunch_application");
      } catch {
        await relaunch();
      }
    } catch (err) {
      const msg = String(err);
      setUpdateStatus("error");
      setUpdateMessage(msg);
      setError(`Update failed: ${msg}`);
    }
  }

  function jumpToIdentifier(identifier: string) {
    const match = issuesByIdentifier.get(identifier.toUpperCase());
    if (!match) return;
    if (activeTab === "triage") {
      setTriageDrawerId(match.id);
    } else if (layoutMode === "board") {
      setSelectedId(match.id);
      setBoardDrawerId(match.id);
    } else {
      setSelectedId(match.id);
    }
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (activeTab === "triage") {
          setActiveTab("latest");
        }
        setTimeout(() => searchRef.current?.focus(), 0);
        return;
      }

      const target = e.target as HTMLElement | null;
      const isTyping =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);

      if (e.key === "Escape") {
        if (showSaveView) {
          setShowSaveView(false);
          return;
        }
        if (showCreateModal) {
          setShowCreateModal(false);
          return;
        }
        if (showSettings) {
          setShowSettings(false);
          return;
        }
        if (triageDrawerId) {
          setTriageDrawerId(null);
          return;
        }
        if (boardDrawerId) {
          setBoardDrawerId(null);
          return;
        }
        if (isTyping) {
          target.blur();
        }
        return;
      }

      if (isTyping || e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === "/") {
        e.preventDefault();
        if (activeTab === "triage") {
          setActiveTab("latest");
        }
        setTimeout(() => searchRef.current?.focus(), 0);
        return;
      }

      if (e.key.toLowerCase() === "c") {
        e.preventDefault();
        setShowCreateModal(true);
        return;
      }

      if (e.key.toLowerCase() === "b" && activeTab !== "triage") {
        e.preventDefault();
        setLayoutMode((m) => (m === "list" ? "board" : "list"));
        return;
      }

      if (e.key.toLowerCase() === "r") {
        e.preventDefault();
        void handleSync(false);
        return;
      }

      if (e.key.toLowerCase() === "o" && activeIssue) {
        e.preventDefault();
        void openExternalUrl(activeIssue.url);
        return;
      }

      if (
        e.key.toLowerCase() === "m" &&
        activeIssue &&
        activeIssue.unread_responses > 0
      ) {
        e.preventDefault();
        void handleMarkSeen(activeIssue.id);
        return;
      }

      if (
        activeTab !== "triage" &&
        layoutMode === "list" &&
        filteredIssues.length > 0 &&
        (e.key === "j" ||
          e.key === "ArrowDown" ||
          e.key === "k" ||
          e.key === "ArrowUp")
      ) {
        e.preventDefault();
        const delta = e.key === "j" || e.key === "ArrowDown" ? 1 : -1;
        const idx = filteredIssues.findIndex((i) => i.id === selectedId);
        const nextIdx =
          idx === -1
            ? 0
            : Math.max(0, Math.min(filteredIssues.length - 1, idx + delta));
        setSelectedId(filteredIssues[nextIdx].id);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const hasExtraFilters =
    teamFilter !== "ALL" ||
    scopeFilter !== "all" ||
    assigneeFilter !== "ALL" ||
    projectFilter !== "ALL" ||
    labelFilter !== "ALL" ||
    search.trim().length > 0;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#090B10] text-zinc-100">
      {/* Sidebar */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-white/8 bg-[#0B0D13] p-3">
        <div className="mb-3 flex items-center justify-between px-1.5 pt-1">
          <div className="flex items-center gap-2.5">
            <BrandLogo className="h-7 w-7 rounded-lg shadow-md shadow-indigo-950/60" />
            <div>
              <div className="text-sm font-semibold tracking-tight text-white">
                Linear Pulse
              </div>
              {settings.viewer_name && (
                <div className="flex items-center gap-1.5 text-[10px] text-zinc-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  <span className="max-w-[125px] truncate">
                    {settings.viewer_name}
                  </span>
                </div>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void checkForUpdates(false)}
            disabled={
              updateStatus === "checking" || updateStatus === "installing"
            }
            title={
              updateStatus === "checking"
                ? "Checking for updates..."
                : updateMessage || "Click to check for updates"
            }
            className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] font-medium text-zinc-400 transition hover:border-indigo-500/40 hover:text-zinc-200 disabled:opacity-60"
          >
            {updateStatus === "checking" && (
              <RefreshCw className="h-2.5 w-2.5 animate-spin text-indigo-400" />
            )}
            <span>v{appVersion}</span>
          </button>
        </div>

        {/* Sync + New Issue Actions */}
        <div className="mb-2 flex items-center gap-1.5">
          <button
            onClick={() => void handleSync(false)}
            disabled={syncing}
            className="flex flex-1 items-center justify-between rounded-lg bg-indigo-600 px-2.5 py-2 text-xs font-medium text-white shadow-sm shadow-indigo-950/50 transition hover:bg-indigo-500 disabled:opacity-60"
          >
            <span className="flex items-center gap-1.5">
              <RefreshCw
                className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`}
              />
              {syncing ? "Syncing..." : "Sync"}
            </span>
            <kbd className="rounded border border-white/20 bg-black/20 px-1 font-mono text-[9px] text-indigo-100">
              R
            </kbd>
          </button>

          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            title="Create new Linear issue (C)"
            className="flex items-center gap-1.5 rounded-lg border border-white/12 bg-[#141824] px-2.5 py-2 text-xs font-medium text-zinc-100 transition hover:border-indigo-500/40 hover:bg-[#1A2030]"
          >
            <Plus className="h-3.5 w-3.5 text-indigo-400" />
            New
            <kbd className="rounded border border-white/10 bg-black/30 px-1 font-mono text-[9px] text-zinc-400">
              C
            </kbd>
          </button>
        </div>

        <div className="mb-3 flex items-center justify-between px-1.5 text-[10px] text-zinc-500">
          <span>{issues.length} tickets</span>
          <span
            className="inline-flex items-center gap-1"
            title={
              lastSyncedAt
                ? `Last synced ${timeAgo(new Date(lastSyncedAt).toISOString())}`
                : "Not synced this session"
            }
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                settings.auto_sync_seconds > 0 && settings.linear_api_key.trim()
                  ? "bg-emerald-400/80"
                  : "bg-zinc-600"
              }`}
            />
            {formatSyncInterval(settings.auto_sync_seconds)}
          </span>
        </div>

        <nav className="space-y-1">
          <button
            onClick={() => {
              setActiveTab("latest");
              setActiveViewId(null);
              setTriageDrawerId(null);
            }}
            className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs font-medium transition ${
              activeTab === "latest" && !activeViewId
                ? "border border-white/10 bg-white/[0.08] text-white shadow-xs"
                : "border border-transparent text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200"
            }`}
          >
            <span className="flex items-center gap-2.5">
              <Inbox className="h-3.5 w-3.5 text-zinc-300" />
              All Issues
            </span>
            <span className="font-mono text-[11px] text-zinc-500">
              {issues.length}
            </span>
          </button>

          <button
            onClick={() => {
              setActiveTab("responses");
              setActiveViewId(null);
              setTriageDrawerId(null);
            }}
            className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs font-medium transition ${
              activeTab === "responses"
                ? "border border-white/10 bg-white/[0.08] text-white shadow-xs"
                : "border border-transparent text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200"
            }`}
          >
            <span className="flex items-center gap-2.5">
              <MessageSquare className="h-3.5 w-3.5 text-indigo-400" />
              Responses
            </span>
            {unreadIssuesCount > 0 && (
              <span className="rounded-full bg-indigo-500 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white shadow-sm shadow-indigo-500/40">
                {unreadIssuesCount}
              </span>
            )}
          </button>

          <button
            onClick={() => {
              setActiveTab("triage");
              setActiveViewId(null);
              setBoardDrawerId(null);
            }}
            className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs font-medium transition ${
              activeTab === "triage"
                ? "border border-indigo-500/35 bg-indigo-500/18 text-indigo-100"
                : "border border-transparent text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200"
            }`}
          >
            <span className="flex items-center gap-2.5">
              <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
              AI Triage
            </span>
            {triage && (
              <span className="rounded-md border border-indigo-500/30 bg-indigo-500/15 px-1.5 py-0.5 font-mono text-[10px] text-indigo-300">
                {triage.next_to_grab.length}
              </span>
            )}
          </button>
        </nav>

        {/* Saved Views */}
        {savedViews.length > 0 && (
          <div className="mt-5 px-1.5">
            <div className="mb-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              <span>Saved Views</span>
              <Bookmark className="h-3 w-3 text-zinc-600" />
            </div>
            <div className="max-h-32 space-y-0.5 overflow-y-auto">
              {savedViews.map((v) => {
                const isActive = activeViewId === v.id && activeTab === "latest";
                return (
                  <div
                    key={v.id}
                    className={`group flex items-center justify-between rounded-lg px-2 py-1.5 text-xs transition ${
                      isActive
                        ? "bg-indigo-500/15 text-indigo-200"
                        : "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => applySavedView(v)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <Bookmark className="h-3 w-3 shrink-0 text-indigo-400/80" />
                      <span className="truncate font-medium">{v.name}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteSavedView(v.id)}
                      title="Delete saved view"
                      className="ml-1 shrink-0 rounded p-0.5 text-zinc-500 opacity-0 transition hover:bg-white/10 hover:text-rose-300 group-hover:opacity-100"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Teams */}
        <div className="mt-5 px-1.5">
          <div className="mb-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            <span>Teams</span>
            <Layers className="h-3 w-3 text-zinc-600" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {teamCounts.map((t) => (
              <button
                key={t.key}
                onClick={() => {
                  setTeamFilter(t.key);
                  setActiveViewId(null);
                }}
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition ${
                  teamFilter === t.key
                    ? "border-white/20 bg-zinc-200 text-zinc-900"
                    : "border-white/8 bg-white/[0.03] text-zinc-400 hover:border-white/15 hover:text-zinc-200"
                }`}
              >
                <span>{t.key}</span>
                <span
                  className={`font-mono text-[9px] ${
                    teamFilter === t.key ? "text-zinc-600" : "text-zinc-500"
                  }`}
                >
                  {t.count}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-auto space-y-2 border-t border-white/8 pt-3">
          {pendingUpdate && (
            <button
              onClick={() => void handleInstallUpdate()}
              disabled={updateStatus === "installing"}
              className="flex w-full items-center justify-between rounded-lg border border-indigo-500/40 bg-indigo-500/15 px-2.5 py-2 text-xs font-medium text-indigo-200 transition hover:bg-indigo-500/25 disabled:opacity-60"
            >
              <span className="flex items-center gap-2">
                <Download
                  className={`h-3.5 w-3.5 text-indigo-400 ${
                    updateStatus === "installing" ? "animate-pulse" : ""
                  }`}
                />
                {updateStatus === "installing"
                  ? `Updating to v${pendingUpdate.version}...`
                  : `Update to v${pendingUpdate.version}`}
              </span>
            </button>
          )}

          <div className="flex items-center justify-between px-1.5 py-1 text-[10px] text-zinc-500">
            <span>
              <kbd className="rounded border border-white/10 bg-white/[0.04] px-1 font-mono text-zinc-400">
                J/K
              </kbd>{" "}
              nav
            </span>
            <span>
              <kbd className="rounded border border-white/10 bg-white/[0.04] px-1 font-mono text-zinc-400">
                B
              </kbd>{" "}
              board
            </span>
            <span>
              <kbd className="rounded border border-white/10 bg-white/[0.04] px-1 font-mono text-zinc-400">
                O
              </kbd>{" "}
              open
            </span>
            <span>
              <kbd className="rounded border border-white/10 bg-white/[0.04] px-1 font-mono text-zinc-400">
                /
              </kbd>{" "}
              find
            </span>
          </div>

          <button
            onClick={handleOpenSettings}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-zinc-400 transition hover:bg-white/[0.05] hover:text-zinc-200"
          >
            <Settings className="h-3.5 w-3.5" />
            Settings & API Keys
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="relative flex flex-1 flex-col overflow-hidden">
        {error && (
          <div className="flex items-center justify-between border-b border-rose-500/30 bg-rose-500/12 px-4 py-2 text-xs text-rose-200">
            <span className="flex items-center gap-2">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 text-rose-400" />
              <span className="line-clamp-2">{error}</span>
            </span>
            <button
              onClick={() => setError(null)}
              className="ml-3 shrink-0 text-rose-300 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {activeTab === "triage" ? (
          <div className="relative flex flex-1 overflow-hidden">
            <main className="surface-glow flex-1 overflow-y-auto px-6 py-6">
              <div className="mx-auto max-w-5xl space-y-6">
                {/* Header */}
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-white">
                      <Sparkles className="h-5 w-5 text-indigo-400" />
                      AI Triage & Next Work
                    </h1>
                    <p className="mt-1 text-xs text-zinc-400">
                      Prioritizes active tickets into actionable work buckets
                      with unread reply awareness.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <ModelSelect
                      value={settings.claude_model}
                      options={modelSelectOptions}
                      onChange={(id) => void handleModelQuickChange(id)}
                      align="right"
                    />
                    <button
                      onClick={() => void handleRunTriage()}
                      disabled={triaging}
                      className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white shadow-sm shadow-indigo-950/60 transition hover:bg-indigo-500 disabled:opacity-60"
                    >
                      <Sparkles
                        className={`h-3.5 w-3.5 ${
                          triaging ? "animate-spin" : ""
                        }`}
                      />
                      {triaging ? "Analyzing..." : "Run AI Triage"}
                    </button>
                  </div>
                </div>

                {/* Quick Stats */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-xl border border-white/8 bg-[#10131B] px-4 py-3">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                      Unread Replies
                    </div>
                    <div className="mt-1 flex items-baseline gap-2">
                      <span className="font-mono text-xl font-semibold text-indigo-300">
                        {unreadIssuesCount}
                      </span>
                      <span className="text-[11px] text-zinc-500">tickets</span>
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/8 bg-[#10131B] px-4 py-3">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                      In Progress
                    </div>
                    <div className="mt-1 flex items-baseline gap-2">
                      <span className="font-mono text-xl font-semibold text-amber-300">
                        {stats.started}
                      </span>
                      <span className="text-[11px] text-zinc-500">started</span>
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/8 bg-[#10131B] px-4 py-3">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                      Active Queue
                    </div>
                    <div className="mt-1 flex items-baseline gap-2">
                      <span className="font-mono text-xl font-semibold text-zinc-100">
                        {stats.active}
                      </span>
                      <span className="text-[11px] text-zinc-500">open</span>
                    </div>
                  </div>
                </div>

                {triaging ? (
                  <div className="space-y-4">
                    <div className="h-24 animate-pulse rounded-xl border border-indigo-500/20 bg-indigo-500/[0.05]" />
                    <div className="grid gap-3 md:grid-cols-2">
                      {[1, 2, 3, 4].map((n) => (
                        <div
                          key={n}
                          className="h-32 animate-pulse rounded-xl border border-white/8 bg-[#10131B]"
                        />
                      ))}
                    </div>
                  </div>
                ) : !triage ? (
                  <div className="rounded-xl border border-dashed border-white/12 bg-[#10131B]/70 p-12 text-center">
                    <Sparkles className="mx-auto mb-3 h-8 w-8 text-indigo-400/75" />
                    <p className="text-sm font-medium text-zinc-200">
                      No AI triage generated yet
                    </p>
                    <p className="mt-1 text-xs text-zinc-400">
                      Sync Linear first, add your Anthropic API key in Settings,
                      and click{" "}
                      <span className="font-medium text-zinc-200">
                        Run AI Triage
                      </span>
                      .
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Executive Summary */}
                    <div className="rounded-xl border border-indigo-500/25 bg-gradient-to-br from-indigo-500/[0.08] via-[#10131B] to-[#10131B] p-5">
                      <div className="mb-2 flex items-center justify-between text-[11px] text-zinc-400">
                        <span className="font-mono text-indigo-300">
                          {triage.model}
                        </span>
                        <span>Generated {timeAgo(triage.generated_at)}</span>
                      </div>
                      <MarkdownBody
                        content={triage.summary}
                        knownIdentifiers={knownIdentifiers}
                        onSelectIdentifier={jumpToIdentifier}
                      />
                    </div>

                    {/* Grab Next */}
                    <section>
                      <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                        Suggested Next Tickets to Grab
                      </h2>
                      <div className="grid gap-3 md:grid-cols-2">
                        {triage.next_to_grab.map((item, idx) => {
                          const live = issuesByIdentifier.get(
                            item.identifier.toUpperCase()
                          );
                          const isSelectedDrawer =
                            live && triageDrawerId === live.id;
                          return (
                            <div
                              key={`${item.identifier}-${idx}`}
                              onClick={() => jumpToIdentifier(item.identifier)}
                              className={`group cursor-pointer rounded-xl border p-4 text-left transition ${
                                isSelectedDrawer
                                  ? "border-indigo-500/50 bg-indigo-500/12"
                                  : "border-white/8 bg-[#10131B] hover:border-indigo-500/40 hover:bg-[#141824]"
                              }`}
                            >
                              <div className="mb-2 flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <span className="flex h-5 w-5 items-center justify-center rounded-md bg-white/[0.06] font-mono text-[10px] font-semibold text-zinc-300">
                                    #{idx + 1}
                                  </span>
                                  {live && (
                                    <>
                                      <PriorityIcon priority={live.priority} />
                                      <StateIcon
                                        stateType={live.state_type}
                                        color={live.state_color}
                                      />
                                    </>
                                  )}
                                  <span className="font-mono text-xs font-semibold text-indigo-400">
                                    {item.identifier}
                                  </span>
                                  {live && live.unread_responses > 0 && (
                                    <span className="rounded-full bg-indigo-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-300">
                                      {live.unread_responses} new
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center gap-1.5">
                                  {live && (
                                    <button
                                      type="button"
                                      disabled={grabbingId === live.id}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        void handleGrabTicket(live);
                                      }}
                                      title="Assign to me & move to In Progress"
                                      className="inline-flex items-center gap-1 rounded-md border border-indigo-500/35 bg-indigo-500/15 px-2 py-0.5 text-[10px] font-semibold text-indigo-200 transition hover:bg-indigo-500/30 disabled:opacity-50"
                                    >
                                      <Hand className="h-2.5 w-2.5" />
                                      {grabbingId === live.id
                                        ? "Grabbing..."
                                        : "Grab"}
                                    </button>
                                  )}
                                  <span
                                    className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${urgencyClass(
                                      item.urgency
                                    )}`}
                                  >
                                    {item.urgency}
                                  </span>
                                </div>
                              </div>
                              <div className="text-sm font-medium text-zinc-100 group-hover:text-white">
                                {item.title}
                              </div>
                              <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">
                                {item.reason}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    </section>

                    {/* Work Buckets */}
                    <section className="space-y-3">
                      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                        Work Buckets
                      </h2>
                      <div className="grid gap-4 md:grid-cols-2">
                        {triage.work_buckets.map((bucket) => {
                          const theme = bucketTheme(bucket.name);
                          const BucketIcon = theme.icon;
                          return (
                            <div
                              key={bucket.name}
                              className={`rounded-xl border ${theme.border} bg-[#10131B] p-4`}
                            >
                              <div className="mb-1 flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <span
                                    className={`inline-flex h-6 w-6 items-center justify-center rounded-lg border ${theme.accent}`}
                                  >
                                    <BucketIcon className="h-3.5 w-3.5" />
                                  </span>
                                  <span className="text-sm font-semibold text-zinc-100">
                                    {bucket.name}
                                  </span>
                                </div>
                                <span className="font-mono text-[11px] text-zinc-500">
                                  {bucket.tickets.length}
                                </span>
                              </div>
                              <p className="mb-3 text-xs text-zinc-400">
                                {bucket.description}
                              </p>
                              <div className="space-y-2">
                                {bucket.tickets.map((t) => {
                                  const live = issuesByIdentifier.get(
                                    t.identifier.toUpperCase()
                                  );
                                  return (
                                    <button
                                      key={t.identifier}
                                      type="button"
                                      onClick={() =>
                                        jumpToIdentifier(t.identifier)
                                      }
                                      className="flex w-full items-start justify-between gap-2 rounded-lg border border-white/8 bg-[#0A0C12] p-2.5 text-left transition hover:border-indigo-500/40 hover:bg-[#111520]"
                                    >
                                      <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-1.5">
                                          {live && (
                                            <StateIcon
                                              stateType={live.state_type}
                                              color={live.state_color}
                                              className="h-3 w-3"
                                            />
                                          )}
                                          <span className="font-mono text-[11px] font-semibold text-indigo-400">
                                            {t.identifier}
                                          </span>
                                          <span className="truncate text-xs font-medium text-zinc-200">
                                            {t.title}
                                          </span>
                                          {live && live.unread_responses > 0 && (
                                            <span className="ml-auto rounded-full bg-indigo-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-indigo-300">
                                              {live.unread_responses} new
                                            </span>
                                          )}
                                        </div>
                                        <p className="mt-1 text-[11px] leading-relaxed text-zinc-400">
                                          {t.reason}
                                        </p>
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  </>
                )}
              </div>
            </main>

            {triageDrawerIssue && (
              <aside className="w-[560px] shrink-0 border-l border-white/10 shadow-2xl shadow-black/70">
                <IssueDetail
                  issue={triageDrawerIssue}
                  meta={workspaceMeta}
                  viewerId={settings.viewer_id}
                  knownIdentifiers={knownIdentifiers}
                  onSelectIdentifier={jumpToIdentifier}
                  onMarkSeen={handleMarkSeen}
                  onMarkUnread={handleMarkUnread}
                  onUpdateIssue={handleUpdateIssue}
                  onAddComment={handleAddComment}
                  onRefreshIssue={handleRefreshIssue}
                  onClose={() => setTriageDrawerId(null)}
                  timeAgo={timeAgo}
                />
              </aside>
            )}
          </div>
        ) : (
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* Global Search & Filter Header */}
            <header className="shrink-0 space-y-2.5 border-b border-white/8 bg-[#0C0E14] px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="relative min-w-[260px] flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-500" />
                  <input
                    ref={searchRef}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && search.trim().length >= 2) {
                        e.preventDefault();
                        void handleRemoteSearch();
                      }
                    }}
                    placeholder="Search all tickets, descriptions, comments, projects... (Ctrl+K, Enter for API)"
                    className="w-full rounded-lg border border-white/10 bg-[#141720] py-1.5 pl-8 pr-32 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-indigo-500/60 focus:outline-none"
                  />
                  <div className="absolute right-1.5 top-1 flex items-center gap-1">
                    {search.trim().length >= 2 && (
                      <button
                        type="button"
                        disabled={searchingRemote}
                        onClick={() => void handleRemoteSearch()}
                        title="Search Linear API directly & cache results"
                        className="inline-flex items-center gap-1 rounded-md border border-indigo-500/30 bg-indigo-500/15 px-2 py-1 text-[10px] font-medium text-indigo-300 transition hover:bg-indigo-500/25 disabled:opacity-50"
                      >
                        <Globe className="h-2.5 w-2.5" />
                        {searchingRemote ? "Searching..." : "Search API"}
                      </button>
                    )}
                    {search && (
                      <button
                        type="button"
                        onClick={() => setSearch("")}
                        className="rounded p-1 text-zinc-500 hover:text-zinc-200"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Layout Toggle + Save View */}
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setShowSaveView((p) => !p)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#141720] px-2.5 py-1.5 text-xs font-medium text-zinc-300 transition hover:border-indigo-500/40 hover:text-white"
                    >
                      <Bookmark className="h-3.5 w-3.5 text-indigo-400" />
                      Save View
                    </button>

                    {showSaveView && (
                      <form
                        onSubmit={handleSaveCustomView}
                        className="absolute right-0 z-50 mt-1.5 w-64 space-y-2 rounded-xl border border-white/12 bg-[#11141E] p-3 shadow-2xl shadow-black/80"
                      >
                        <div className="text-xs font-semibold text-zinc-200">
                          Save current filters as view
                        </div>
                        <input
                          autoFocus
                          value={newViewName}
                          onChange={(e) => setNewViewName(e.target.value)}
                          placeholder="e.g. Marketing Copy"
                          className="w-full rounded-lg border border-white/10 bg-[#090B10] px-2.5 py-1.5 text-xs text-white placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none"
                        />
                        <div className="flex justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setShowSaveView(false)}
                            className="rounded-md border border-white/10 px-2.5 py-1 text-[11px] text-zinc-400 hover:text-white"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={!newViewName.trim()}
                            className="rounded-md bg-indigo-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                          >
                            Save
                          </button>
                        </div>
                      </form>
                    )}
                  </div>

                  <div className="flex items-center rounded-lg border border-white/10 bg-[#141720] p-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        setLayoutMode("list");
                        setBoardDrawerId(null);
                      }}
                      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition ${
                        layoutMode === "list"
                          ? "bg-white/12 text-white"
                          : "text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      <ListIcon className="h-3.5 w-3.5" />
                      List
                    </button>
                    <button
                      type="button"
                      onClick={() => setLayoutMode("board")}
                      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition ${
                        layoutMode === "board"
                          ? "bg-white/12 text-white"
                          : "text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      <Columns3 className="h-3.5 w-3.5" />
                      Board
                    </button>
                  </div>
                </div>
              </div>

              {/* Filter Row */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  {SCOPE_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        setScopeFilter(opt.id);
                        setActiveViewId(null);
                      }}
                      className={`rounded-md px-2 py-1 text-[11px] font-medium transition ${
                        scopeFilter === opt.id
                          ? "bg-white/12 text-white"
                          : "text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-300"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}

                  <span className="mx-1 h-3.5 w-px bg-white/10" />

                  <DarkSelect
                    value={assigneeFilter}
                    options={assigneeFilterOptions}
                    onChange={(val) => {
                      setAssigneeFilter(val);
                      setActiveViewId(null);
                    }}
                    compact
                  />
                  <DarkSelect
                    value={projectFilter}
                    options={projectFilterOptions}
                    onChange={(val) => {
                      setProjectFilter(val);
                      setActiveViewId(null);
                    }}
                    compact
                  />
                  <DarkSelect
                    value={labelFilter}
                    options={labelFilterOptions}
                    onChange={(val) => {
                      setLabelFilter(val);
                      setActiveViewId(null);
                    }}
                    compact
                  />

                  {hasExtraFilters && (
                    <button
                      type="button"
                      onClick={() => {
                        setTeamFilter("ALL");
                        setScopeFilter("all");
                        setAssigneeFilter("ALL");
                        setProjectFilter("ALL");
                        setLabelFilter("ALL");
                        setSearch("");
                        setActiveViewId(null);
                      }}
                      className="rounded-md px-2 py-1 text-[11px] text-zinc-400 transition hover:bg-white/[0.05] hover:text-white"
                    >
                      Reset
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-zinc-500">
                    {filteredIssues.length} matching
                  </span>
                  {activeTab === "responses" && unreadIssuesCount > 0 && (
                    <button
                      type="button"
                      onClick={() => void handleMarkAllSeen()}
                      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] font-medium text-emerald-300 transition hover:bg-emerald-500/20"
                    >
                      <CheckCheck className="h-3 w-3" />
                      Mark all seen
                    </button>
                  )}
                </div>
              </div>
            </header>

            {layoutMode === "board" ? (
              <div className="relative flex flex-1 overflow-hidden">
                <KanbanBoard
                  issues={filteredIssues}
                  meta={workspaceMeta}
                  teamFilter={teamFilter}
                  selectedId={boardDrawerId}
                  onSelectIssue={(issue) => {
                    setSelectedId(issue.id);
                    setBoardDrawerId(issue.id);
                  }}
                  onMoveIssueState={handleMoveBoardIssueState}
                  timeAgo={timeAgo}
                />

                {boardDrawerIssue && (
                  <aside className="w-[560px] shrink-0 border-l border-white/10 shadow-2xl shadow-black/70">
                    <IssueDetail
                      issue={boardDrawerIssue}
                      meta={workspaceMeta}
                      viewerId={settings.viewer_id}
                      knownIdentifiers={knownIdentifiers}
                      onSelectIdentifier={jumpToIdentifier}
                      onMarkSeen={handleMarkSeen}
                      onMarkUnread={handleMarkUnread}
                      onUpdateIssue={handleUpdateIssue}
                      onAddComment={handleAddComment}
                      onRefreshIssue={handleRefreshIssue}
                      onClose={() => setBoardDrawerId(null)}
                      timeAgo={timeAgo}
                    />
                  </aside>
                )}
              </div>
            ) : (
              <div className="flex flex-1 overflow-hidden">
                {/* Issue List */}
                <section className="flex w-[430px] shrink-0 flex-col border-r border-white/8 bg-[#0C0E14]">
                  <div className="flex-1 divide-y divide-white/[0.06] overflow-y-auto">
                    {visibleListIssues.length === 0 ? (
                      <div className="p-8 text-center text-xs text-zinc-500">
                        {issues.length === 0
                          ? "No tickets synced yet. Add your Linear API key in Settings and click Sync."
                          : "No matching tickets. Try resetting filters or pressing Enter to search Linear API."}
                      </div>
                    ) : (
                      <>
                        {visibleListIssues.map((issue) => {
                          const isSelected = issue.id === selectedId;
                          const latestComment =
                            issue.comments.length > 0
                              ? issue.comments[issue.comments.length - 1]
                              : null;
                          return (
                            <button
                              key={issue.id}
                              onClick={() => setSelectedId(issue.id)}
                              className={`flex w-full flex-col gap-1.5 border-l-2 px-3.5 py-3 text-left transition ${
                                isSelected
                                  ? "border-l-indigo-500 bg-indigo-500/[0.09]"
                                  : issue.unread_responses > 0
                                  ? "border-l-indigo-500/40 bg-indigo-500/[0.02] hover:bg-white/[0.03]"
                                  : "border-l-transparent hover:bg-white/[0.03]"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex min-w-0 items-center gap-1.5">
                                  <PriorityIcon
                                    priority={issue.priority}
                                    className="h-3.5 w-3.5 shrink-0"
                                  />
                                  <span className="font-mono text-[11px] font-medium text-zinc-400">
                                    {issue.identifier}
                                  </span>
                                  <StateIcon
                                    stateType={issue.state_type}
                                    color={issue.state_color}
                                    className="h-3.5 w-3.5 shrink-0"
                                  />
                                  <span className="truncate text-[11px] text-zinc-400">
                                    {issue.state_name}
                                  </span>
                                </div>
                                <span className="shrink-0 text-[10px] text-zinc-500">
                                  {timeAgo(issue.updated_at)}
                                </span>
                              </div>

                              <div className="line-clamp-2 text-[13px] font-medium leading-snug text-zinc-100">
                                {issue.title}
                              </div>

                              {latestComment && (
                                <div
                                  className={`truncate rounded-md px-2 py-1 text-[11px] ${
                                    latestComment.is_unread
                                      ? "border border-indigo-500/25 bg-indigo-500/[0.08] text-indigo-200"
                                      : "bg-white/[0.025] text-zinc-400"
                                  }`}
                                >
                                  <span className="font-medium">
                                    {latestComment.author_name}:
                                  </span>{" "}
                                  {stripMarkdownPreview(latestComment.body)}
                                </div>
                              )}

                              <div className="flex items-center justify-between gap-2 pt-0.5">
                                <div className="flex min-w-0 items-center gap-1.5">
                                  {issue.project_name && (
                                    <span className="inline-flex max-w-[140px] items-center gap-1 truncate rounded border border-white/8 bg-white/[0.03] px-1.5 py-0.5 text-[10px] text-zinc-400">
                                      <FolderKanban className="h-2.5 w-2.5 shrink-0 text-zinc-500" />
                                      <span className="truncate">
                                        {issue.project_name}
                                      </span>
                                    </span>
                                  )}
                                  {issue.labels.slice(0, 2).map((label) => (
                                    <span
                                      key={label}
                                      className="max-w-[90px] truncate rounded border border-white/8 bg-white/[0.03] px-1.5 py-0.5 text-[10px] text-zinc-400"
                                    >
                                      {label}
                                    </span>
                                  ))}
                                </div>

                                <div className="flex shrink-0 items-center gap-1.5">
                                  {issue.unread_responses > 0 && (
                                    <span className="flex items-center gap-1 rounded-full bg-indigo-500/25 px-2 py-0.5 text-[10px] font-semibold text-indigo-200">
                                      <MessageSquare className="h-2.5 w-2.5" />
                                      {issue.unread_responses} new
                                    </span>
                                  )}
                                  {issue.assignee_name && (
                                    <AuthorAvatar
                                      name={issue.assignee_name}
                                      size="sm"
                                    />
                                  )}
                                </div>
                              </div>
                            </button>
                          );
                        })}

                        {filteredIssues.length > visibleListIssues.length && (
                          <div className="p-3">
                            <button
                              type="button"
                              onClick={() =>
                                setVisibleLimit((prev) => prev + 100)
                              }
                              className="w-full rounded-lg border border-white/10 bg-[#141720] py-2 text-xs font-medium text-zinc-300 transition hover:border-indigo-500/40 hover:text-white"
                            >
                              Show 100 more ({filteredIssues.length - visibleListIssues.length}{" "}
                              remaining)
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </section>

                {/* Detail Pane */}
                <main className="flex-1 overflow-hidden">
                  {!selectedIssue ? (
                    <div className="flex h-full items-center justify-center bg-[#0D1017] text-xs text-zinc-500">
                      Select a ticket to view, edit, or reply.
                    </div>
                  ) : (
                    <IssueDetail
                      issue={selectedIssue}
                      meta={workspaceMeta}
                      viewerId={settings.viewer_id}
                      knownIdentifiers={knownIdentifiers}
                      onSelectIdentifier={jumpToIdentifier}
                      onMarkSeen={handleMarkSeen}
                      onMarkUnread={handleMarkUnread}
                      onUpdateIssue={handleUpdateIssue}
                      onAddComment={handleAddComment}
                      onRefreshIssue={handleRefreshIssue}
                      timeAgo={timeAgo}
                    />
                  )}
                </main>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Create Issue Modal */}
      {showCreateModal && (
        <CreateIssueModal
          meta={workspaceMeta}
          defaultTeamKey={teamFilter}
          viewerId={settings.viewer_id}
          knownIdentifiers={knownIdentifiers}
          onSelectIdentifier={jumpToIdentifier}
          onCreate={handleCreateIssue}
          onClose={() => setShowCreateModal(false)}
        />
      )}

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <form
            onSubmit={handleSaveSettings}
            className="max-h-[90vh] w-full max-w-md space-y-4 overflow-y-auto rounded-2xl border border-white/12 bg-[#10131B] p-6 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">
                Settings & API Keys
              </h2>
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                className="text-zinc-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-300">
                Linear Personal API Key
              </label>
              <input
                type="password"
                value={settings.linear_api_key}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, linear_api_key: e.target.value }))
                }
                placeholder="lin_api_..."
                className="w-full rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 text-xs text-zinc-100 focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-300">
                Anthropic API Key
              </label>
              <input
                type="password"
                value={settings.anthropic_api_key}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    anthropic_api_key: e.target.value,
                  }))
                }
                placeholder="sk-ant-..."
                className="w-full rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 text-xs text-zinc-100 focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-zinc-300">
                  Claude Model
                </label>
                <button
                  type="button"
                  onClick={() =>
                    void loadClaudeModels(settings.anthropic_api_key)
                  }
                  disabled={loadingModels || !settings.anthropic_api_key.trim()}
                  className="text-[11px] font-medium text-indigo-400 transition hover:text-indigo-300 disabled:opacity-50"
                >
                  {loadingModels ? "Loading models..." : "Refresh models"}
                </button>
              </div>
              <ModelSelect
                value={settings.claude_model}
                options={modelSelectOptions}
                onChange={(id) =>
                  setSettings((s) => ({ ...s, claude_model: id }))
                }
                showId
                fullWidth
              />
              {modelsError && (
                <p className="text-[11px] text-rose-400">{modelsError}</p>
              )}
            </div>

            {/* Auto-Sync & Desktop Notifications */}
            <div className="space-y-3 rounded-xl border border-white/10 bg-[#090B10] p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-medium text-zinc-200">
                    Background Auto-Sync
                  </div>
                  <div className="text-[11px] text-zinc-400">
                    Polls Linear deltas + syncs on window focus
                  </div>
                </div>
                <DarkSelect
                  value={String(settings.auto_sync_seconds)}
                  options={AUTO_SYNC_OPTIONS}
                  onChange={(val) =>
                    setSettings((s) => ({
                      ...s,
                      auto_sync_seconds: Number(val),
                    }))
                  }
                  align="right"
                  compact
                />
              </div>

              <div className="h-px bg-white/8" />

              <div className="flex items-center justify-between gap-2">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={settings.notifications_enabled}
                    onChange={(e) =>
                      setSettings((s) => ({
                        ...s,
                        notifications_enabled: e.target.checked,
                      }))
                    }
                    className="h-3.5 w-3.5 rounded border-zinc-600 bg-zinc-900 accent-indigo-500"
                  />
                  <span>
                    <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-200">
                      <Bell className="h-3 w-3 text-indigo-400" />
                      Desktop Notifications
                    </span>
                    <span className="block text-[11px] text-zinc-400">
                      Alert when new teammate replies arrive
                    </span>
                  </span>
                </label>

                <button
                  type="button"
                  onClick={() => void handleTestNotification()}
                  className="shrink-0 rounded-lg border border-white/10 bg-[#151923] px-2.5 py-1 text-[11px] font-medium text-zinc-200 transition hover:border-indigo-500/40 hover:bg-[#1B202D]"
                >
                  Test
                </button>
              </div>
              {notifyTestMsg && (
                <p className="text-[11px] text-emerald-400">{notifyTestMsg}</p>
              )}
            </div>

            {/* Full Workspace Re-sync */}
            <div className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-[#090B10] p-3">
              <div>
                <div className="text-xs font-medium text-zinc-200">
                  Workspace Sync ({issues.length} tickets cached)
                </div>
                <div className="text-[11px] text-zinc-400">
                  Re-download all non-archived Linear tickets
                </div>
              </div>
              <button
                type="button"
                disabled={syncing}
                onClick={() => {
                  setShowSettings(false);
                  void handleSync(true);
                }}
                className="shrink-0 rounded-lg border border-white/10 bg-[#151923] px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:border-indigo-500/40 hover:bg-[#1B202D] disabled:opacity-50"
              >
                Full Re-sync
              </button>
            </div>

            {/* Ubuntu Desktop Integration */}
            <div className="space-y-2 rounded-xl border border-white/10 bg-[#090B10] p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-200">
                    <Monitor className="h-3.5 w-3.5 text-indigo-400" />
                    Ubuntu Desktop Icon
                  </div>
                  <div className="text-[11px] text-zinc-400">
                    Register launcher & dock icon in GNOME
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleInstallDesktopIcon()}
                  className="shrink-0 rounded-lg border border-white/10 bg-[#151923] px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:border-indigo-500/40 hover:bg-[#1B202D]"
                >
                  Install Icon
                </button>
              </div>
              {desktopInstallMsg && (
                <p className="text-[11px] text-emerald-400">
                  {desktopInstallMsg}
                </p>
              )}
            </div>

            {/* App Updates */}
            <div className="space-y-2 rounded-xl border border-white/10 bg-[#090B10] p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-medium text-zinc-200">
                    App Updates
                  </div>
                  <div className="text-[11px] text-zinc-400">
                    Current version: v{appVersion}
                  </div>
                </div>
                {pendingUpdate ? (
                  <button
                    type="button"
                    onClick={() => void handleInstallUpdate()}
                    disabled={updateStatus === "installing"}
                    className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-500 disabled:opacity-60"
                  >
                    {updateStatus === "installing"
                      ? `Installing v${pendingUpdate.version}...`
                      : `Install v${pendingUpdate.version}`}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void checkForUpdates(false)}
                    disabled={updateStatus === "checking"}
                    className="rounded-lg border border-white/10 bg-[#151923] px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:border-indigo-500/40 hover:bg-[#1B202D] disabled:opacity-60"
                  >
                    {updateStatus === "checking"
                      ? "Checking..."
                      : "Check for updates"}
                  </button>
                )}
              </div>
              {updateMessage && (
                <p className="text-[11px] text-zinc-400">{updateMessage}</p>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-indigo-500"
              >
                Save Keys
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
