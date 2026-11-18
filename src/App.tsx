import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { openExternalUrl } from "./lib/openExternal";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  AlertCircle,
  BarChart3,
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
  ListOrdered,
  MessageSquare,
  Monitor,
  Moon,
  Pencil,
  Plus,
  RefreshCw,
  Reply,
  Search,
  Settings,
  Sparkles,
  Sun,
  X,
  Zap,
} from "lucide-react";
import type {
  ActiveTab,
  AiTriageResult,
  AppSettings,
  BacklogEntry,
  BacklogGroup,
  BoardColumnConfig,
  BridgeSettings as BridgeSettingsData,
  BridgeStatus,
  ClaudeModelOption,
  CreateIssueInput,
  CreateIssueResponse,
  CreateProjectInput,
  DevSessionView,
  FilterMatchMode,
  FilterRule,
  LauncherStatus,
  LayoutMode,
  LinearIssue,
  LinearProjectDetail,
  ProjectsOverview,
  RerankRun,
  SavedView,
  ScopeFilter,
  ThemeMode,
  UpdateIssuePatch,
  UpdateProjectPatch,
  WorkspaceMetadata,
} from "./types";
import {
  AuthorAvatar,
  BrandLogo,
  IssueLabelBadge,
  PriorityIcon,
  StateIcon,
  buildLabelLookup,
  resolveIssueLabels,
} from "./components/Icons";
import { MarkdownBody } from "./components/MarkdownBody";
import { IssueDetail } from "./components/IssueDetail";
import { ModelSelect } from "./components/ModelSelect";
import { DarkSelect, type DarkSelectOption } from "./components/DarkSelect";
import { CreateIssueModal } from "./components/CreateIssueModal";
import { KanbanBoard } from "./components/KanbanBoard";
import { LinearFilterBar } from "./components/LinearFilterBar";
import { CustomViewModal } from "./components/CustomViewModal";
import { ProjectsView } from "./components/ProjectsView";
import { InsightsView } from "./components/InsightsView";
import { BacklogView } from "./components/BacklogView";
import { BridgeSettings } from "./components/BridgeSettings";
import {
  getViewColorDot,
  issueMatchesSearchText,
  matchesFilterRules,
  matchesSavedView,
  matchesScopeFilter,
  parseBoardColumnConfig,
  parseSavedViewRules,
  serializeBoardColumnConfig,
  serializeRulesForView,
} from "./lib/viewFilters";

const DEFAULT_BOARD_CONFIG_KEY = "linear_pulse_default_board_config";
const THEME_STORAGE_KEY = "linear_pulse_theme";

function loadInitialTheme(): ThemeMode {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === "light"
      ? "light"
      : "dark";
  } catch {
    return "dark";
  }
}

function loadDefaultBoardConfig(): BoardColumnConfig {
  try {
    return parseBoardColumnConfig(
      localStorage.getItem(DEFAULT_BOARD_CONFIG_KEY)
    );
  } catch {
    return { hiddenColumns: [], columnOrder: [] };
  }
}

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
      return "text-rose-700 bg-rose-50 border-rose-200 dark:text-rose-300 dark:bg-rose-500/15 dark:border-rose-500/30";
    case "medium":
      return "text-amber-800 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-500/15 dark:border-amber-500/30";
    default:
      return "text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-500/15 dark:border-emerald-500/30";
  }
}

function bucketTheme(name: string) {
  const lower = name.toLowerCase();
  if (lower.includes("reply")) {
    return {
      icon: Reply,
      accent:
        "text-indigo-700 bg-indigo-50 border-indigo-200 dark:text-indigo-300 dark:bg-indigo-500/15 dark:border-indigo-500/30",
      border: "border-indigo-200 dark:border-indigo-500/25",
    };
  }
  if (lower.includes("quick")) {
    return {
      icon: Zap,
      accent:
        "text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-500/15 dark:border-emerald-500/30",
      border: "border-emerald-200 dark:border-emerald-500/25",
    };
  }
  if (lower.includes("block") || lower.includes("wait")) {
    return {
      icon: Clock,
      accent:
        "text-amber-800 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-500/15 dark:border-amber-500/30",
      border: "border-amber-200 dark:border-amber-500/25",
    };
  }
  return {
    icon: Flame,
    accent:
      "text-violet-700 bg-violet-50 border-violet-200 dark:text-violet-300 dark:bg-violet-500/15 dark:border-violet-500/30",
    border: "border-violet-200 dark:border-violet-500/25",
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
  const [filterRules, setFilterRules] = useState<FilterRule[]>([]);
  const [filterMatchMode, setFilterMatchMode] =
    useState<FilterMatchMode>("all");
  const [boardConfig, setBoardConfig] = useState<BoardColumnConfig>(
    loadDefaultBoardConfig
  );
  const [viewSaveState, setViewSaveState] = useState<
    "idle" | "saving" | "saved"
  >("idle");
  const [filterOpenSignal, setFilterOpenSignal] = useState(0);
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
  const [backlog, setBacklog] = useState<BacklogEntry[]>([]);
  const [backlogGroups, setBacklogGroups] = useState<BacklogGroup[]>([]);
  const [rerankRuns, setRerankRuns] = useState<RerankRun[]>([]);
  const [devSessions, setDevSessions] = useState<DevSessionView[]>([]);
  const [launcherStatus, setLauncherStatus] =
    useState<LauncherStatus | null>(null);
  const [bridgeSettings, setBridgeSettings] =
    useState<BridgeSettingsData | null>(null);
  const [bridgeStatus, setBridgeStatus] = useState<BridgeStatus | null>(null);
  const [projectsOverview, setProjectsOverview] =
    useState<ProjectsOverview | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState<string | null>(null);

  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [searchingRemote, setSearchingRemote] = useState(false);
  const [triaging, setTriaging] = useState(false);
  const [grabbingId, setGrabbingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notifyTestMsg, setNotifyTestMsg] = useState<string | null>(null);

  const [showSettings, setShowSettings] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showViewModal, setShowViewModal] = useState(false);
  const [editingView, setEditingView] = useState<SavedView | null>(null);
  const [theme, setTheme] = useState<ThemeMode>(loadInitialTheme);

  const [appVersion, setAppVersion] = useState("0.3.12");
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
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark");
    root.classList.toggle("light", theme === "light");
    root.style.colorScheme = theme;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore storage errors
    }
  }, [theme]);

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
          loadedBacklog,
          loadedBacklogGroups,
          loadedRerankRuns,
          loadedDevSessions,
          loadedBridgeSettings,
          initialBridgeStatus,
        ] = await Promise.all([
          invoke<AppSettings>("get_settings"),
          invoke<LinearIssue[]>("get_issues"),
          invoke<WorkspaceMetadata>("get_workspace_meta"),
          invoke<SavedView[]>("get_saved_views"),
          invoke<AiTriageResult | null>("get_cached_triage"),
          invoke<BacklogEntry[]>("get_backlog"),
          invoke<BacklogGroup[]>("get_backlog_groups"),
          invoke<RerankRun[]>("list_rerank_runs"),
          invoke<DevSessionView[]>("list_dev_sessions"),
          invoke<BridgeSettingsData>("get_bridge_settings"),
          invoke<BridgeStatus>("get_bridge_status"),
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
        setBacklog(loadedBacklog);
        setBacklogGroups(loadedBacklogGroups);
        setRerankRuns(loadedRerankRuns);
        setDevSessions(loadedDevSessions);
        setBridgeSettings(loadedBridgeSettings);
        setBridgeStatus(initialBridgeStatus);

        if (loadedSettings.linear_api_key.trim()) {
          void handleSyncRef.current(false, cachedIssues.length > 0);
        }
      } catch (err) {
        console.warn("Initial load skipped or failed:", err);
      }

      void checkForUpdates(true);
      void loadLauncherStatus();
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
    let active = true;
    const unlisteners: UnlistenFn[] = [];

    (async () => {
      try {
        const u1 = await listen("backlog-changed", async () => {
          try {
            const [nextBacklog, nextGroups] = await Promise.all([
              invoke<BacklogEntry[]>("get_backlog"),
              invoke<BacklogGroup[]>("get_backlog_groups"),
            ]);
            if (active) {
              setBacklog(nextBacklog);
              setBacklogGroups(nextGroups);
            }
          } catch {
            // Ignore reload errors
          }
        });
        if (!active) {
          u1();
          return;
        }
        unlisteners.push(u1);

        const u2 = await listen("issues-changed", async () => {
          try {
            const [nextIssues, nextBacklog, nextGroups] = await Promise.all([
              invoke<LinearIssue[]>("get_issues"),
              invoke<BacklogEntry[]>("get_backlog"),
              invoke<BacklogGroup[]>("get_backlog_groups"),
            ]);
            if (active) {
              setIssues(nextIssues);
              setBacklog(nextBacklog);
              setBacklogGroups(nextGroups);
            }
          } catch {
            // Ignore reload errors
          }
        });
        if (!active) {
          u2();
          return;
        }
        unlisteners.push(u2);

        const u3 = await listen("rerank-changed", async () => {
          try {
            const nextRuns = await invoke<RerankRun[]>("list_rerank_runs");
            if (active) setRerankRuns(nextRuns);
          } catch {
            // Ignore reload errors
          }
        });
        if (!active) {
          u3();
          return;
        }
        unlisteners.push(u3);

        const u4 = await listen("dev-sessions-changed", async () => {
          try {
            const [nextSessions, nextBridgeSettings] = await Promise.all([
              invoke<DevSessionView[]>("list_dev_sessions"),
              invoke<BridgeSettingsData>("get_bridge_settings"),
            ]);
            if (active) {
              setDevSessions(nextSessions);
              setBridgeSettings(nextBridgeSettings);
            }
          } catch {
            // Ignore reload errors
          }
        });
        if (!active) {
          u4();
          return;
        }
        unlisteners.push(u4);
      } catch {
        // Running outside Tauri
      }
    })();

    return () => {
      active = false;
      for (const unlisten of unlisteners) {
        unlisten();
      }
    };
  }, []);

  useEffect(() => {
    let active = true;
    const poll = setInterval(async () => {
      try {
        const st = await invoke<BridgeStatus>("get_bridge_status");
        if (active) setBridgeStatus(st);
      } catch {
        // Ignore outside Tauri
      }
    }, 10_000);
    const launcherPoll = setInterval(async () => {
      try {
        const st = await invoke<LauncherStatus>("get_launcher_status");
        if (active) setLauncherStatus(st);
      } catch {
        // Ignore errors; null means unknown
      }
    }, 60_000);
    return () => {
      active = false;
      clearInterval(poll);
      clearInterval(launcherPoll);
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
    filterRules,
    filterMatchMode,
    search,
  ]);

  const unreadIssuesCount = useMemo(
    () => issues.filter((i) => i.unread_responses > 0).length,
    [issues]
  );

  const backlogRankById = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of backlog) {
      map.set(entry.issue_id, entry.position);
    }
    return map;
  }, [backlog]);

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

  const savedViewCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const view of savedViews) {
      let count = 0;
      for (const issue of issues) {
        if (matchesSavedView(issue, view, settings.viewer_name)) {
          count += 1;
        }
      }
      map.set(view.id, count);
    }
    return map;
  }, [savedViews, issues, settings.viewer_name]);

  const activeSavedView = useMemo(
    () => savedViews.find((v) => v.id === activeViewId) ?? null,
    [savedViews, activeViewId]
  );

  const isActiveViewDirty = useMemo(() => {
    if (!activeSavedView) return false;
    const parsed = parseSavedViewRules(activeSavedView);
    const savedBoard = parseBoardColumnConfig(
      activeSavedView.board_columns_json
    );
    return (
      (activeSavedView.team_filter || "ALL") !== teamFilter ||
      (activeSavedView.scope_filter || "all") !== scopeFilter ||
      (activeSavedView.search_query || "") !== search ||
      (activeSavedView.layout_mode === "board" ? "board" : "list") !==
        layoutMode ||
      parsed.matchMode !== filterMatchMode ||
      serializeRulesForView(parsed.rules) !==
        serializeRulesForView(filterRules) ||
      serializeBoardColumnConfig(savedBoard) !==
        serializeBoardColumnConfig(boardConfig)
    );
  }, [
    activeSavedView,
    teamFilter,
    scopeFilter,
    search,
    layoutMode,
    filterMatchMode,
    filterRules,
    boardConfig,
  ]);

  useEffect(() => {
    if (!activeSavedView || !isActiveViewDirty) {
      return;
    }
    setViewSaveState("saving");
    const updatedView: SavedView = {
      ...activeSavedView,
      match_mode: filterMatchMode,
      filters_json: serializeRulesForView(filterRules),
      board_columns_json: serializeBoardColumnConfig(boardConfig),
      team_filter: teamFilter,
      scope_filter: scopeFilter,
      search_query: search,
      layout_mode: layoutMode,
    };

    const timer = window.setTimeout(async () => {
      try {
        const updated = await invoke<SavedView[]>("save_custom_view", {
          view: updatedView,
        });
        setSavedViews(updated);
        setViewSaveState("saved");
      } catch (err) {
        setViewSaveState("idle");
        setError(String(err));
      }
    }, 200);

    return () => window.clearTimeout(timer);
  }, [
    activeSavedView,
    isActiveViewDirty,
    teamFilter,
    scopeFilter,
    search,
    layoutMode,
    filterMatchMode,
    filterRules,
    boardConfig,
  ]);

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

  const labelLookup = useMemo(
    () => buildLabelLookup(workspaceMeta.labels),
    [workspaceMeta.labels]
  );

  const filteredIssues = useMemo(() => {
    return issues.filter((issue) => {
      if (activeTab === "responses" && issue.unread_responses === 0) {
        return false;
      }
      if (teamFilter !== "ALL" && issue.team_key !== teamFilter) {
        return false;
      }
      if (!matchesScopeFilter(issue, scopeFilter, settings.viewer_name)) {
        return false;
      }
      if (
        !matchesFilterRules(
          issue,
          filterRules,
          filterMatchMode,
          settings.viewer_name
        )
      ) {
        return false;
      }
      return issueMatchesSearchText(issue, search);
    });
  }, [
    issues,
    activeTab,
    teamFilter,
    scopeFilter,
    filterRules,
    filterMatchMode,
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

  const isIssueTab = activeTab === "latest" || activeTab === "responses";

  const activeIssue =
    activeTab === "triage"
      ? triageDrawerIssue
      : isIssueTab
      ? layoutMode === "board"
        ? boardDrawerIssue
        : selectedIssue
      : null;

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

  async function loadProjects() {
    if (projectsLoading) return;
    setProjectsLoading(true);
    setProjectsError(null);
    try {
      const overview = await invoke<ProjectsOverview>("list_projects");
      setProjectsOverview(overview);
    } catch (err) {
      setProjectsError(String(err));
    } finally {
      setProjectsLoading(false);
    }
  }

  useEffect(() => {
    if (
      activeTab === "projects" &&
      projectsOverview === null &&
      !projectsLoading &&
      !projectsError &&
      settings.linear_api_key.trim()
    ) {
      void loadProjects();
    }
  }, [
    activeTab,
    projectsOverview,
    projectsLoading,
    projectsError,
    settings.linear_api_key,
  ]);

  async function handleCreateProject(input: CreateProjectInput) {
    const created = await invoke<LinearProjectDetail>("create_project", {
      input,
    });
    setProjectsOverview((prev) => {
      if (!prev) {
        return { projects: [created], statuses: [] };
      }
      const nextProjects = [created, ...prev.projects];
      return { ...prev, projects: nextProjects };
    });
    setWorkspaceMeta((prev) => {
      const filtered = prev.projects.filter((p) => p.id !== created.id);
      const next = [...filtered, { id: created.id, name: created.name }].sort(
        (a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())
      );
      return { ...prev, projects: next };
    });
  }

  async function handleUpdateProject(
    projectId: string,
    patch: UpdateProjectPatch
  ) {
    const updated = await invoke<LinearProjectDetail>("update_project", {
      projectId,
      patch,
    });
    setProjectsOverview((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        projects: prev.projects.map((p) =>
          p.id === updated.id ? updated : p
        ),
      };
    });
    setWorkspaceMeta((prev) => {
      const exists = prev.projects.some((p) => p.id === updated.id);
      const next = (
        exists
          ? prev.projects.map((p) =>
              p.id === updated.id ? { id: updated.id, name: updated.name } : p
            )
          : [...prev.projects, { id: updated.id, name: updated.name }]
      ).sort((a, b) =>
        a.name.toLowerCase().localeCompare(b.name.toLowerCase())
      );
      return { ...prev, projects: next };
    });
  }

  function handleViewProjectIssues(project: LinearProjectDetail) {
    exitActiveView();
    setTriageDrawerId(null);
    setBoardDrawerId(null);
    setTeamFilter("ALL");
    setScopeFilter("all");
    setSearch("");
    setFilterMatchMode("all");
    setFilterRules([
      {
        id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        field: "project",
        operator: "is",
        values: [project.name],
      },
    ]);
    setActiveTab("latest");
  }

  async function handleCreateIssue(input: CreateIssueInput) {
    const res = await invoke<CreateIssueResponse>("create_issue", { input });
    setIssues(res.issues);
    setSelectedId(res.created_id);
    if (activeTab === "triage") {
      setTriageDrawerId(res.created_id);
    } else if (isIssueTab && layoutMode === "board") {
      setBoardDrawerId(res.created_id);
    } else if (!isIssueTab) {
      setActiveTab("latest");
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

  async function handleToggleBacklog(issueId: string) {
    try {
      const next = backlogRankById.has(issueId)
        ? await invoke<BacklogEntry[]>("remove_issue_from_backlog", { issueId })
        : await invoke<BacklogEntry[]>("add_issue_to_backlog", { issueId });
      const nextGroups = await invoke<BacklogGroup[]>("get_backlog_groups");
      setBacklog(next);
      setBacklogGroups(nextGroups);
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleReorderBacklog(issueIds: string[]) {
    try {
      const [next, nextGroups] = await Promise.all([
        invoke<BacklogEntry[]>("set_backlog_order", {
          issueIds,
        }),
        invoke<BacklogGroup[]>("get_backlog_groups"),
      ]);
      setBacklog(next);
      setBacklogGroups(nextGroups);
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleRemoveFromBacklog(issueId: string) {
    try {
      const [next, nextGroups] = await Promise.all([
        invoke<BacklogEntry[]>("remove_issue_from_backlog", {
          issueId,
        }),
        invoke<BacklogGroup[]>("get_backlog_groups"),
      ]);
      setBacklog(next);
      setBacklogGroups(nextGroups);
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleClearDoneFromBacklog() {
    try {
      const [next, nextGroups] = await Promise.all([
        invoke<BacklogEntry[]>("clear_done_from_backlog"),
        invoke<BacklogGroup[]>("get_backlog_groups"),
      ]);
      setBacklog(next);
      setBacklogGroups(nextGroups);
    } catch (err) {
      setError(String(err));
    }
  }

  async function handleStartRerank(comment: string) {
    setError(null);
    try {
      const run = await invoke<RerankRun>("start_rerank", { comment });
      setRerankRuns((prev) => {
        const filtered = prev.filter((r) => r.id !== run.id);
        return [run, ...filtered].slice(0, 10);
      });
    } catch (err) {
      setError(String(err));
      throw err;
    }
  }

  async function loadLauncherStatus() {
    try {
      const status = await invoke<LauncherStatus>("get_launcher_status");
      setLauncherStatus(status);
    } catch {
      // Ignore errors; null means unknown
    }
  }

  function upsertDevSessionView(view: DevSessionView) {
    setDevSessions((prev) => {
      const filtered = prev.filter((s) => s.session.id !== view.session.id);
      return [view, ...filtered].slice(0, 20);
    });
  }

  async function handleStartDevSession(
    issueIds: string[],
    name: string,
    note: string,
    delivery: string,
    model: string,
    effort: string
  ) {
    setError(null);
    try {
      const created = await invoke<DevSessionView>("start_dev_session", {
        issueIds,
        name,
        note,
        delivery,
        model,
        effort,
      });
      upsertDevSessionView(created);
      try {
        const nextBridgeSettings = await invoke<BridgeSettingsData>(
          "get_bridge_settings"
        );
        setBridgeSettings(nextBridgeSettings);
      } catch {
        // Ignore bridge settings reload failure
      }
      void loadLauncherStatus();
    } catch (err) {
      setError(String(err));
      throw err;
    }
  }

  async function handleAddToDevSession(sessionId: string, issueIds: string[]) {
    setError(null);
    try {
      const updated = await invoke<DevSessionView>("add_to_dev_session", {
        sessionId,
        issueIds,
      });
      setDevSessions((prev) =>
        prev.map((s) => (s.session.id === updated.session.id ? updated : s))
      );
    } catch (err) {
      setError(String(err));
      throw err;
    }
  }

  async function handleRemoveFromDevSession(
    sessionId: string,
    issueId: string
  ) {
    setError(null);
    try {
      const updated = await invoke<DevSessionView>(
        "remove_from_dev_session",
        {
          sessionId,
          issueId,
        }
      );
      setDevSessions((prev) =>
        prev.map((s) => (s.session.id === updated.session.id ? updated : s))
      );
    } catch (err) {
      setError(String(err));
      throw err;
    }
  }

  async function handleStopDevSession(id: string) {
    setError(null);
    try {
      const updated = await invoke<DevSessionView>("stop_dev_session", { id });
      setDevSessions((prev) =>
        prev.map((s) => (s.session.id === updated.session.id ? updated : s))
      );
    } catch (err) {
      setError(String(err));
      throw err;
    }
  }

  async function handleRefreshDevSessions() {
    setError(null);
    try {
      const next = await invoke<DevSessionView[]>("refresh_dev_sessions");
      setDevSessions(next);
      void loadLauncherStatus();
    } catch (err) {
      setError(String(err));
      throw err;
    }
  }

  async function handleSaveCustomView(view: SavedView) {
    setError(null);
    const updated = await invoke<SavedView[]>("save_custom_view", { view });
    setSavedViews(updated);
    applySavedView(view);
    setShowViewModal(false);
    setEditingView(null);
  }

  function handleBoardConfigChange(next: BoardColumnConfig) {
    setBoardConfig(next);
    if (!activeViewId) {
      try {
        localStorage.setItem(
          DEFAULT_BOARD_CONFIG_KEY,
          serializeBoardColumnConfig(next)
        );
      } catch {
        // Ignore storage errors
      }
    }
  }

  function exitActiveView() {
    setActiveViewId(null);
    setViewSaveState("idle");
    setBoardConfig(loadDefaultBoardConfig());
  }

  function applySavedView(view: SavedView) {
    const parsed = parseSavedViewRules(view);
    const parsedBoard = parseBoardColumnConfig(view.board_columns_json);
    setActiveTab("latest");
    setActiveViewId(view.id);
    setTeamFilter(view.team_filter || "ALL");
    setScopeFilter((view.scope_filter as ScopeFilter) || "all");
    setFilterRules(parsed.rules);
    setFilterMatchMode(parsed.matchMode);
    setBoardConfig(parsedBoard);
    setSearch(view.search_query || "");
    setLayoutMode(view.layout_mode === "board" ? "board" : "list");
    setViewSaveState("saved");
    setTriageDrawerId(null);
    setBoardDrawerId(null);
  }

  async function handleDeleteSavedView(viewId: string) {
    try {
      const updated = await invoke<SavedView[]>("delete_saved_view", {
        viewId,
      });
      setSavedViews(updated);
      if (activeViewId === viewId) exitActiveView();
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
    } else if (!isIssueTab) {
      setActiveTab("latest");
      setSelectedId(match.id);
      if (layoutMode === "board") {
        setBoardDrawerId(match.id);
      }
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
        if (!isIssueTab) {
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
        if (showViewModal) {
          setShowViewModal(false);
          setEditingView(null);
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

      if (e.key.toLowerCase() === "f" && isIssueTab) {
        e.preventDefault();
        setFilterOpenSignal((n) => n + 1);
        return;
      }

      if (e.key === "/") {
        e.preventDefault();
        if (!isIssueTab) {
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

      if (e.key.toLowerCase() === "b" && isIssueTab) {
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
        isIssueTab &&
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
    filterRules.length > 0 ||
    search.trim().length > 0;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#F4F5F7] text-zinc-900 dark:bg-[#090B10] dark:text-zinc-100">
      {/* Sidebar */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-200 bg-[#F9FAFB] p-3 dark:border-white/8 dark:bg-[#0B0D13]">
        <div className="mb-3 flex items-center justify-between px-1.5 pt-1">
          <div className="flex items-center gap-2.5">
            <BrandLogo className="h-7 w-7 rounded-lg shadow-sm shadow-indigo-500/20 dark:shadow-md dark:shadow-indigo-950/60" />
            <div>
              <div className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-white">
                Linear Pulse
              </div>
              {settings.viewer_name && (
                <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 dark:text-zinc-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 dark:bg-emerald-400" />
                  <span className="max-w-[115px] truncate">
                    {settings.viewer_name}
                  </span>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() =>
                setTheme((t) => (t === "dark" ? "light" : "dark"))
              }
              title={
                theme === "dark"
                  ? "Switch to Light Mode"
                  : "Switch to Dark Mode"
              }
              aria-label="Toggle Light/Dark theme"
              className="inline-flex items-center justify-center rounded-md border border-zinc-200 bg-white p-1 text-zinc-600 transition hover:border-indigo-400 hover:text-zinc-900 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-400 dark:hover:border-indigo-500/40 dark:hover:text-zinc-200"
            >
              {theme === "dark" ? (
                <Sun className="h-3 w-3 text-amber-400" />
              ) : (
                <Moon className="h-3 w-3 text-indigo-600" />
              )}
            </button>
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
              className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 font-mono text-[10px] font-medium text-zinc-600 transition hover:border-indigo-400 hover:text-zinc-900 disabled:opacity-60 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-400 dark:hover:border-indigo-500/40 dark:hover:text-zinc-200"
            >
              {updateStatus === "checking" && (
                <RefreshCw className="h-2.5 w-2.5 animate-spin text-indigo-600 dark:text-indigo-400" />
              )}
              <span>v{appVersion}</span>
            </button>
          </div>
        </div>

        {/* Sync + New Issue Actions */}
        <div className="mb-2 flex items-center gap-1.5">
          <button
            onClick={() => void handleSync(false)}
            disabled={syncing}
            className="flex flex-1 items-center justify-between rounded-lg bg-indigo-600 px-2.5 py-2 text-xs font-medium text-white shadow-sm shadow-indigo-950/30 transition hover:bg-indigo-500 disabled:opacity-60 dark:shadow-indigo-950/50"
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
            className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-xs font-medium text-zinc-800 transition hover:border-indigo-400 hover:bg-zinc-50 dark:border-white/12 dark:bg-[#141824] dark:text-zinc-100 dark:hover:border-indigo-500/40 dark:hover:bg-[#1A2030]"
          >
            <Plus className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
            New
            <kbd className="rounded border border-zinc-200 bg-zinc-100 px-1 font-mono text-[9px] text-zinc-500 dark:border-white/10 dark:bg-black/30 dark:text-zinc-400">
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
                  ? "bg-emerald-500 dark:bg-emerald-400/80"
                  : "bg-zinc-400 dark:bg-zinc-600"
              }`}
            />
            {formatSyncInterval(settings.auto_sync_seconds)}
          </span>
        </div>

        <nav className="space-y-1">
          <button
            onClick={() => {
              setActiveTab("latest");
              exitActiveView();
              setTriageDrawerId(null);
            }}
            className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs font-medium transition ${
              activeTab === "latest" && !activeViewId
                ? "border border-zinc-200 bg-white text-zinc-900 shadow-xs dark:border-white/10 dark:bg-white/[0.08] dark:text-white"
                : "border border-transparent text-zinc-600 hover:bg-zinc-200/60 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/[0.04] dark:hover:text-zinc-200"
            }`}
          >
            <span className="flex items-center gap-2.5">
              <Inbox className="h-3.5 w-3.5 text-zinc-500 dark:text-zinc-300" />
              All Issues
            </span>
            <span className="font-mono text-[11px] text-zinc-500">
              {issues.length}
            </span>
          </button>

          <button
            onClick={() => {
              setActiveTab("responses");
              exitActiveView();
              setTriageDrawerId(null);
            }}
            className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs font-medium transition ${
              activeTab === "responses"
                ? "border border-zinc-200 bg-white text-zinc-900 shadow-xs dark:border-white/10 dark:bg-white/[0.08] dark:text-white"
                : "border border-transparent text-zinc-600 hover:bg-zinc-200/60 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/[0.04] dark:hover:text-zinc-200"
            }`}
          >
            <span className="flex items-center gap-2.5">
              <MessageSquare className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
              Responses
            </span>
            {unreadIssuesCount > 0 && (
              <span className="rounded-full bg-indigo-600 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white shadow-sm shadow-indigo-500/30 dark:bg-indigo-500 dark:shadow-indigo-500/40">
                {unreadIssuesCount}
              </span>
            )}
          </button>

          <button
            onClick={() => {
              setActiveTab("triage");
              exitActiveView();
              setBoardDrawerId(null);
            }}
            className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs font-medium transition ${
              activeTab === "triage"
                ? "border border-indigo-200 bg-indigo-50 text-indigo-900 dark:border-indigo-500/35 dark:bg-indigo-500/18 dark:text-indigo-100"
                : "border border-transparent text-zinc-600 hover:bg-zinc-200/60 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/[0.04] dark:hover:text-zinc-200"
            }`}
          >
            <span className="flex items-center gap-2.5">
              <Sparkles className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
              AI Triage
            </span>
            {triage && (
              <span className="rounded-md border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 font-mono text-[10px] text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/15 dark:text-indigo-300">
                {triage.next_to_grab.length}
              </span>
            )}
          </button>

          <button
            onClick={() => {
              setActiveTab("backlog");
              exitActiveView();
              setTriageDrawerId(null);
              setBoardDrawerId(null);
            }}
            className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs font-medium transition ${
              activeTab === "backlog"
                ? "border border-zinc-200 bg-white text-zinc-900 shadow-xs dark:border-white/10 dark:bg-white/[0.08] dark:text-white"
                : "border border-transparent text-zinc-600 hover:bg-zinc-200/60 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/[0.04] dark:hover:text-zinc-200"
            }`}
          >
            <span className="flex items-center gap-2.5">
              <ListOrdered className="h-3.5 w-3.5 text-zinc-500 dark:text-zinc-300" />
              Backlog
            </span>
            {backlog.length > 0 && (
              <span className="font-mono text-[11px] text-zinc-500">
                {backlog.length}
              </span>
            )}
          </button>

          <button
            onClick={() => {
              setActiveTab("projects");
              exitActiveView();
              setTriageDrawerId(null);
              setBoardDrawerId(null);
            }}
            className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs font-medium transition ${
              activeTab === "projects"
                ? "border border-zinc-200 bg-white text-zinc-900 shadow-xs dark:border-white/10 dark:bg-white/[0.08] dark:text-white"
                : "border border-transparent text-zinc-600 hover:bg-zinc-200/60 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/[0.04] dark:hover:text-zinc-200"
            }`}
          >
            <span className="flex items-center gap-2.5">
              <FolderKanban className="h-3.5 w-3.5 text-zinc-500 dark:text-zinc-300" />
              Projects
            </span>
            {projectsOverview && (
              <span className="font-mono text-[11px] text-zinc-500">
                {projectsOverview.projects.length}
              </span>
            )}
          </button>

          <button
            onClick={() => {
              setActiveTab("insights");
              exitActiveView();
              setTriageDrawerId(null);
              setBoardDrawerId(null);
            }}
            className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs font-medium transition ${
              activeTab === "insights"
                ? "border border-zinc-200 bg-white text-zinc-900 shadow-xs dark:border-white/10 dark:bg-white/[0.08] dark:text-white"
                : "border border-transparent text-zinc-600 hover:bg-zinc-200/60 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/[0.04] dark:hover:text-zinc-200"
            }`}
          >
            <span className="flex items-center gap-2.5">
              <BarChart3 className="h-3.5 w-3.5 text-zinc-500 dark:text-zinc-300" />
              Insights
            </span>
          </button>
        </nav>

        {/* Custom Views */}
        <div className="mt-5 px-1.5">
          <div className="mb-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            <span>Custom Views</span>
            <button
              type="button"
              onClick={() => {
                setEditingView(null);
                setShowViewModal(true);
              }}
              title="Create new custom view with is / is not filters"
              className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-medium text-indigo-600 transition hover:bg-indigo-50 hover:text-indigo-800 dark:text-indigo-400 dark:hover:bg-indigo-500/15 dark:hover:text-indigo-200"
            >
              <Plus className="h-3 w-3" />
              New
            </button>
          </div>
          {savedViews.length === 0 ? (
            <button
              type="button"
              onClick={() => {
                setEditingView(null);
                setShowViewModal(true);
              }}
              className="flex w-full items-center gap-2 rounded-lg border border-dashed border-zinc-300 px-2 py-1.5 text-[11px] text-zinc-500 transition hover:border-indigo-400 hover:text-zinc-800 dark:border-white/10 dark:hover:border-indigo-500/40 dark:hover:text-zinc-300"
            >
              <Bookmark className="h-3 w-3 text-indigo-500/70 dark:text-indigo-400/70" />
              <span>Create custom view...</span>
            </button>
          ) : (
            <div className="max-h-36 space-y-0.5 overflow-y-auto">
              {savedViews.map((v) => {
                const isActive = activeViewId === v.id && activeTab === "latest";
                const count = savedViewCounts.get(v.id) ?? 0;
                return (
                  <div
                    key={v.id}
                    className={`group flex items-center justify-between rounded-lg px-2 py-1.5 text-xs transition ${
                      isActive
                        ? "bg-indigo-50 text-indigo-900 dark:bg-indigo-500/15 dark:text-indigo-200"
                        : "text-zinc-600 hover:bg-zinc-200/60 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/[0.04] dark:hover:text-zinc-200"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => applySavedView(v)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${getViewColorDot(
                          v.icon
                        )}`}
                      />
                      <span className="truncate font-medium">{v.name}</span>
                    </button>
                    <div className="ml-1 flex shrink-0 items-center gap-0.5">
                      <span className="px-1 font-mono text-[10px] text-zinc-500 group-hover:hidden">
                        {count}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingView(v);
                          setShowViewModal(true);
                        }}
                        title="Edit view filters"
                        className="hidden rounded p-0.5 text-zinc-500 transition hover:bg-zinc-200 hover:text-indigo-700 group-hover:inline-flex dark:hover:bg-white/10 dark:hover:text-indigo-300"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteSavedView(v.id)}
                        title="Delete custom view"
                        className="hidden rounded p-0.5 text-zinc-500 transition hover:bg-zinc-200 hover:text-rose-600 group-hover:inline-flex dark:hover:bg-white/10 dark:hover:text-rose-300"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Teams */}
        <div className="mt-5 px-1.5">
          <div className="mb-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            <span>Teams</span>
            <Layers className="h-3 w-3 text-zinc-400 dark:text-zinc-600" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {teamCounts.map((t) => (
              <button
                key={t.key}
                onClick={() => {
                  setTeamFilter(t.key);
                  exitActiveView();
                }}
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition ${
                  teamFilter === t.key
                    ? "border-zinc-800 bg-zinc-900 text-white dark:border-white/20 dark:bg-zinc-200 dark:text-zinc-900"
                    : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:text-zinc-900 dark:border-white/8 dark:bg-white/[0.03] dark:text-zinc-400 dark:hover:border-white/15 dark:hover:text-zinc-200"
                }`}
              >
                <span>{t.key}</span>
                <span
                  className={`font-mono text-[9px] ${
                    teamFilter === t.key
                      ? "text-zinc-300 dark:text-zinc-600"
                      : "text-zinc-500"
                  }`}
                >
                  {t.count}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-auto space-y-2 border-t border-zinc-200 pt-3 dark:border-white/8">
          {pendingUpdate && (
            <button
              onClick={() => void handleInstallUpdate()}
              disabled={updateStatus === "installing"}
              className="flex w-full items-center justify-between rounded-lg border border-indigo-300 bg-indigo-50 px-2.5 py-2 text-xs font-medium text-indigo-800 transition hover:bg-indigo-100 disabled:opacity-60 dark:border-indigo-500/40 dark:bg-indigo-500/15 dark:text-indigo-200 dark:hover:bg-indigo-500/25"
            >
              <span className="flex items-center gap-2">
                <Download
                  className={`h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400 ${
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
              <kbd className="rounded border border-zinc-200 bg-white px-1 font-mono text-zinc-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-400">
                J/K
              </kbd>{" "}
              nav
            </span>
            <span>
              <kbd className="rounded border border-zinc-200 bg-white px-1 font-mono text-zinc-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-400">
                B
              </kbd>{" "}
              board
            </span>
            <span>
              <kbd className="rounded border border-zinc-200 bg-white px-1 font-mono text-zinc-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-400">
                O
              </kbd>{" "}
              open
            </span>
            <span>
              <kbd className="rounded border border-zinc-200 bg-white px-1 font-mono text-zinc-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-400">
                /
              </kbd>{" "}
              find
            </span>
          </div>

          <button
            type="button"
            onClick={handleOpenSettings}
            title={
              bridgeStatus?.tunnel_error ||
              bridgeStatus?.server_error ||
              "Configure Claude Code MCP & SSH bridge"
            }
            className="flex w-full items-center justify-between rounded-lg border border-zinc-200/80 bg-white px-2.5 py-1.5 text-[11px] transition hover:border-indigo-400 dark:border-white/8 dark:bg-white/[0.02] dark:hover:border-indigo-500/40"
          >
            <span className="flex items-center gap-1.5 font-medium text-zinc-700 dark:text-zinc-300">
              <span
                className={`h-2 w-2 rounded-full ${
                  bridgeStatus?.tunnel_state === "error" ||
                  Boolean(bridgeStatus?.server_error)
                    ? "bg-rose-500"
                    : bridgeStatus?.tunnel_state === "connected"
                    ? "bg-emerald-500"
                    : bridgeStatus?.server_running
                    ? "bg-indigo-500"
                    : "bg-zinc-400 dark:bg-zinc-600"
                }`}
              />
              <span>Claude Code</span>
            </span>
            <span className="truncate pl-2 text-[10px] text-zinc-500 dark:text-zinc-400">
              {bridgeStatus?.tunnel_state === "error" ||
              Boolean(bridgeStatus?.server_error)
                ? "Error"
                : bridgeStatus?.tunnel_state === "connected"
                ? "Connected"
                : bridgeStatus?.server_running
                ? "Listening"
                : "Off"}
              {bridgeStatus?.last_request_at
                ? ` · last call ${timeAgo(bridgeStatus.last_request_at)}`
                : ""}
            </span>
          </button>

          <button
            onClick={handleOpenSettings}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-zinc-600 transition hover:bg-zinc-200/60 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/[0.05] dark:hover:text-zinc-200"
          >
            <Settings className="h-3.5 w-3.5" />
            Settings & API Keys
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="relative flex flex-1 flex-col overflow-hidden">
        {error && (
          <div className="flex items-center justify-between border-b border-rose-300 bg-rose-50 px-4 py-2 text-xs text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/12 dark:text-rose-200">
            <span className="flex items-center gap-2">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 text-rose-600 dark:text-rose-400" />
              <span className="line-clamp-2">{error}</span>
            </span>
            <button
              onClick={() => setError(null)}
              className="ml-3 shrink-0 text-rose-600 hover:text-rose-900 dark:text-rose-300 dark:hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {activeTab === "backlog" ? (
          <BacklogView
            backlog={backlog}
            backlogGroups={backlogGroups}
            issues={issues}
            onReorder={handleReorderBacklog}
            onRemove={handleRemoveFromBacklog}
            onClearDone={handleClearDoneFromBacklog}
            onSelectIdentifier={jumpToIdentifier}
            timeAgo={timeAgo}
            bridgeStatus={bridgeStatus}
            rerankRuns={rerankRuns}
            onStartRerank={handleStartRerank}
            devSessions={devSessions}
            devDefaults={{
              model: bridgeSettings?.dev_model ?? "opus",
              effort: bridgeSettings?.dev_effort ?? "high",
            }}
            launcherStatus={launcherStatus}
            devLaunchMode={bridgeSettings?.dev_launch_mode ?? "launcher"}
            onStartDevSession={handleStartDevSession}
            onAddToDevSession={handleAddToDevSession}
            onRemoveFromDevSession={handleRemoveFromDevSession}
            onStopDevSession={handleStopDevSession}
            onRefreshDevSessions={handleRefreshDevSessions}
          />
        ) : activeTab === "projects" ? (
          <ProjectsView
            overview={projectsOverview}
            loading={projectsLoading}
            error={projectsError}
            hasApiKey={Boolean(settings.linear_api_key.trim())}
            issues={issues}
            workspaceMeta={workspaceMeta}
            onRefresh={loadProjects}
            onCreateProject={handleCreateProject}
            onUpdateProject={handleUpdateProject}
            onViewProjectIssues={handleViewProjectIssues}
            onSelectIdentifier={jumpToIdentifier}
            timeAgo={timeAgo}
          />
        ) : activeTab === "insights" ? (
          <InsightsView
            issues={issues}
            workspaceMeta={workspaceMeta}
            onSelectIdentifier={jumpToIdentifier}
          />
        ) : activeTab === "triage" ? (
          <div className="relative flex flex-1 overflow-hidden">
            <main className="surface-glow flex-1 overflow-y-auto px-6 py-6">
              <div className="mx-auto max-w-5xl space-y-6">
                {/* Header */}
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-zinc-900 dark:text-white">
                      <Sparkles className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
                      AI Triage & Next Work
                    </h1>
                    <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
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
                      className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white shadow-sm shadow-indigo-950/30 transition hover:bg-indigo-500 disabled:opacity-60 dark:shadow-indigo-950/60"
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
                  <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-white/8 dark:bg-[#10131B]">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                      Unread Replies
                    </div>
                    <div className="mt-1 flex items-baseline gap-2">
                      <span className="font-mono text-xl font-semibold text-indigo-600 dark:text-indigo-300">
                        {unreadIssuesCount}
                      </span>
                      <span className="text-[11px] text-zinc-500">tickets</span>
                    </div>
                  </div>
                  <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-white/8 dark:bg-[#10131B]">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                      In Progress
                    </div>
                    <div className="mt-1 flex items-baseline gap-2">
                      <span className="font-mono text-xl font-semibold text-amber-600 dark:text-amber-300">
                        {stats.started}
                      </span>
                      <span className="text-[11px] text-zinc-500">started</span>
                    </div>
                  </div>
                  <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-white/8 dark:bg-[#10131B]">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                      Active Queue
                    </div>
                    <div className="mt-1 flex items-baseline gap-2">
                      <span className="font-mono text-xl font-semibold text-zinc-900 dark:text-zinc-100">
                        {stats.active}
                      </span>
                      <span className="text-[11px] text-zinc-500">open</span>
                    </div>
                  </div>
                </div>

                {triaging ? (
                  <div className="space-y-4">
                    <div className="h-24 animate-pulse rounded-xl border border-indigo-200 bg-indigo-50 dark:border-indigo-500/20 dark:bg-indigo-500/[0.05]" />
                    <div className="grid gap-3 md:grid-cols-2">
                      {[1, 2, 3, 4].map((n) => (
                        <div
                          key={n}
                          className="h-32 animate-pulse rounded-xl border border-zinc-200 bg-white dark:border-white/8 dark:bg-[#10131B]"
                        />
                      ))}
                    </div>
                  </div>
                ) : !triage ? (
                  <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-12 text-center dark:border-white/12 dark:bg-[#10131B]/70">
                    <Sparkles className="mx-auto mb-3 h-8 w-8 text-indigo-500/75 dark:text-indigo-400/75" />
                    <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                      No AI triage generated yet
                    </p>
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      Sync Linear first, add your Anthropic API key in Settings,
                      and click{" "}
                      <span className="font-medium text-zinc-800 dark:text-zinc-200">
                        Run AI Triage
                      </span>
                      .
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Executive Summary */}
                    <div className="rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-white p-5 dark:border-indigo-500/25 dark:from-indigo-500/[0.08] dark:via-[#10131B] dark:to-[#10131B]">
                      <div className="mb-2 flex items-center justify-between text-[11px] text-zinc-500 dark:text-zinc-400">
                        <span className="font-mono text-indigo-600 dark:text-indigo-300">
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
                      <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
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
                                  ? "border-indigo-400 bg-indigo-50 dark:border-indigo-500/50 dark:bg-indigo-500/12"
                                  : "border-zinc-200 bg-white hover:border-indigo-300 hover:bg-zinc-50 dark:border-white/8 dark:bg-[#10131B] dark:hover:border-indigo-500/40 dark:hover:bg-[#141824]"
                              }`}
                            >
                              <div className="mb-2 flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <span className="flex h-5 w-5 items-center justify-center rounded-md bg-zinc-100 font-mono text-[10px] font-semibold text-zinc-700 dark:bg-white/[0.06] dark:text-zinc-300">
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
                                  <span className="font-mono text-xs font-semibold text-indigo-600 dark:text-indigo-400">
                                    {item.identifier}
                                  </span>
                                  {live && live.unread_responses > 0 && (
                                    <span className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
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
                                      className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-50 dark:border-indigo-500/35 dark:bg-indigo-500/15 dark:text-indigo-200 dark:hover:bg-indigo-500/30"
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
                              <div className="text-sm font-medium text-zinc-900 group-hover:text-zinc-950 dark:text-zinc-100 dark:group-hover:text-white">
                                {item.title}
                              </div>
                              <p className="mt-1.5 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                                {item.reason}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    </section>

                    {/* Work Buckets */}
                    <section className="space-y-3">
                      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                        Work Buckets
                      </h2>
                      <div className="grid gap-4 md:grid-cols-2">
                        {triage.work_buckets.map((bucket) => {
                          const theme = bucketTheme(bucket.name);
                          const BucketIcon = theme.icon;
                          return (
                            <div
                              key={bucket.name}
                              className={`rounded-xl border ${theme.border} bg-white p-4 dark:bg-[#10131B]`}
                            >
                              <div className="mb-1 flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2">
                                  <span
                                    className={`inline-flex h-6 w-6 items-center justify-center rounded-lg border ${theme.accent}`}
                                  >
                                    <BucketIcon className="h-3.5 w-3.5" />
                                  </span>
                                  <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                                    {bucket.name}
                                  </span>
                                </div>
                                <span className="font-mono text-[11px] text-zinc-500">
                                  {bucket.tickets.length}
                                </span>
                              </div>
                              <p className="mb-3 text-xs text-zinc-600 dark:text-zinc-400">
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
                                      className="flex w-full items-start justify-between gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-2.5 text-left transition hover:border-indigo-300 hover:bg-indigo-50/40 dark:border-white/8 dark:bg-[#0A0C12] dark:hover:border-indigo-500/40 dark:hover:bg-[#111520]"
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
                                          <span className="font-mono text-[11px] font-semibold text-indigo-600 dark:text-indigo-400">
                                            {t.identifier}
                                          </span>
                                          <span className="truncate text-xs font-medium text-zinc-800 dark:text-zinc-200">
                                            {t.title}
                                          </span>
                                          {live && live.unread_responses > 0 && (
                                            <span className="ml-auto rounded-full bg-indigo-100 px-1.5 py-0.5 text-[9px] font-semibold text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
                                              {live.unread_responses} new
                                            </span>
                                          )}
                                        </div>
                                        <p className="mt-1 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">
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
              <aside className="w-[560px] shrink-0 border-l border-zinc-200 shadow-2xl shadow-black/15 dark:border-white/10 dark:shadow-black/70">
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
                  inBacklogRank={backlogRankById.get(triageDrawerIssue.id) ?? null}
                  onToggleBacklog={handleToggleBacklog}
                  onClose={() => setTriageDrawerId(null)}
                  timeAgo={timeAgo}
                />
              </aside>
            )}
          </div>
        ) : (
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* Global Search & Filter Header */}
            <header className="shrink-0 space-y-2.5 border-b border-zinc-200 bg-white px-4 py-3 dark:border-white/8 dark:bg-[#0C0E14]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="relative min-w-[260px] flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-400 dark:text-zinc-500" />
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
                    className="w-full rounded-lg border border-zinc-200 bg-zinc-50 py-1.5 pl-8 pr-32 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-white/10 dark:bg-[#141720] dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-indigo-500/60"
                  />
                  <div className="absolute right-1.5 top-1 flex items-center gap-1">
                    {search.trim().length >= 2 && (
                      <button
                        type="button"
                        disabled={searchingRemote}
                        onClick={() => void handleRemoteSearch()}
                        title="Search Linear API directly & cache results"
                        className="inline-flex items-center gap-1 rounded-md border border-indigo-200 bg-indigo-50 px-2 py-1 text-[10px] font-medium text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-50 dark:border-indigo-500/30 dark:bg-indigo-500/15 dark:text-indigo-300 dark:hover:bg-indigo-500/25"
                      >
                        <Globe className="h-2.5 w-2.5" />
                        {searchingRemote ? "Searching..." : "Search API"}
                      </button>
                    )}
                    {search && (
                      <button
                        type="button"
                        onClick={() => setSearch("")}
                        className="rounded p-1 text-zinc-400 hover:text-zinc-800 dark:text-zinc-500 dark:hover:text-zinc-200"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Layout Toggle + Custom View Actions */}
                <div className="flex items-center gap-2">
                  {activeSavedView && (
                    <div className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs dark:border-indigo-500/35 dark:bg-indigo-500/12">
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${getViewColorDot(
                          activeSavedView.icon
                        )}`}
                      />
                      <span className="max-w-[140px] truncate font-medium text-indigo-900 dark:text-indigo-100">
                        {activeSavedView.name}
                      </span>
                      <span className="text-[10px] text-indigo-600/80 dark:text-indigo-300/80">
                        {viewSaveState === "saving"
                          ? "· Saving..."
                          : "· Auto-saved"}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingView(activeSavedView);
                          setShowViewModal(true);
                        }}
                        title="Edit view name, color & rules"
                        className="rounded p-0.5 text-indigo-600 hover:bg-indigo-100 hover:text-indigo-900 dark:text-indigo-300 dark:hover:bg-white/10 dark:hover:text-white"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={exitActiveView}
                        title="Exit custom view"
                        className="rounded p-0.5 text-indigo-600 hover:bg-indigo-100 hover:text-indigo-900 dark:text-indigo-300 dark:hover:bg-white/10 dark:hover:text-white"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setEditingView(null);
                      setShowViewModal(true);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-xs font-medium text-zinc-700 transition hover:border-indigo-400 hover:text-zinc-900 dark:border-white/10 dark:bg-[#141720] dark:text-zinc-300 dark:hover:border-indigo-500/40 dark:hover:text-white"
                  >
                    <Bookmark className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                    {activeSavedView ? "Save as New" : "Save View"}
                  </button>

                  <div className="flex items-center rounded-lg border border-zinc-200 bg-zinc-100 p-0.5 dark:border-white/10 dark:bg-[#141720]">
                    <button
                      type="button"
                      onClick={() => {
                        setLayoutMode("list");
                        setBoardDrawerId(null);
                      }}
                      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition ${
                        layoutMode === "list"
                          ? "bg-white text-zinc-900 shadow-xs dark:bg-white/12 dark:text-white dark:shadow-none"
                          : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"
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
                          ? "bg-white text-zinc-900 shadow-xs dark:bg-white/12 dark:text-white dark:shadow-none"
                          : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"
                      }`}
                    >
                      <Columns3 className="h-3.5 w-3.5" />
                      Board
                    </button>
                  </div>
                </div>
              </div>

              {/* Composable Linear Filter Row */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <LinearFilterBar
                  issues={issues}
                  meta={workspaceMeta}
                  viewerName={settings.viewer_name}
                  scopeFilter={scopeFilter}
                  onChangeScope={setScopeFilter}
                  teamFilter={teamFilter}
                  onClearTeamFilter={() => setTeamFilter("ALL")}
                  rules={filterRules}
                  onChangeRules={setFilterRules}
                  matchMode={filterMatchMode}
                  onChangeMatchMode={setFilterMatchMode}
                  hasAnyFilters={hasExtraFilters}
                  onResetAll={() => {
                    setTeamFilter("ALL");
                    setScopeFilter("all");
                    setFilterRules([]);
                    setFilterMatchMode("all");
                    setSearch("");
                  }}
                  openSignal={filterOpenSignal}
                />

                <div className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-zinc-500">
                    {filteredIssues.length} matching
                  </span>
                  {activeTab === "responses" && unreadIssuesCount > 0 && (
                    <button
                      type="button"
                      onClick={() => void handleMarkAllSeen()}
                      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2 py-1 text-[10px] font-medium text-emerald-700 transition hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300 dark:hover:bg-emerald-500/20"
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
                  boardConfig={boardConfig}
                  onChangeBoardConfig={handleBoardConfigChange}
                  selectedId={boardDrawerId}
                  onSelectIssue={(issue) => {
                    setSelectedId(issue.id);
                    setBoardDrawerId(issue.id);
                  }}
                  onMoveIssueState={handleMoveBoardIssueState}
                  timeAgo={timeAgo}
                />

                {boardDrawerIssue && (
                  <aside className="w-[560px] shrink-0 border-l border-zinc-200 shadow-2xl shadow-black/15 dark:border-white/10 dark:shadow-black/70">
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
                      inBacklogRank={backlogRankById.get(boardDrawerIssue.id) ?? null}
                      onToggleBacklog={handleToggleBacklog}
                      onClose={() => setBoardDrawerId(null)}
                      timeAgo={timeAgo}
                    />
                  </aside>
                )}
              </div>
            ) : (
              <div className="flex flex-1 overflow-hidden">
                {/* Issue List */}
                <section className="flex w-[430px] shrink-0 flex-col border-r border-zinc-200 bg-white dark:border-white/8 dark:bg-[#0C0E14]">
                  <div className="flex-1 divide-y divide-zinc-200/80 overflow-y-auto dark:divide-white/[0.06]">
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
                                  ? "border-l-indigo-600 bg-indigo-50/90 dark:border-l-indigo-500 dark:bg-indigo-500/[0.09]"
                                  : issue.unread_responses > 0
                                  ? "border-l-indigo-400 bg-indigo-50/40 hover:bg-zinc-50 dark:border-l-indigo-500/40 dark:bg-indigo-500/[0.02] dark:hover:bg-white/[0.03]"
                                  : "border-l-transparent hover:bg-zinc-50 dark:hover:bg-white/[0.03]"
                              }`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex min-w-0 items-center gap-1.5">
                                  <PriorityIcon
                                    priority={issue.priority}
                                    className="h-3.5 w-3.5 shrink-0"
                                  />
                                  <span className="font-mono text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                                    {issue.identifier}
                                  </span>
                                  <StateIcon
                                    stateType={issue.state_type}
                                    color={issue.state_color}
                                    className="h-3.5 w-3.5 shrink-0"
                                  />
                                  <span className="truncate text-[11px] text-zinc-600 dark:text-zinc-400">
                                    {issue.state_name}
                                  </span>
                                </div>
                                <span className="shrink-0 text-[10px] text-zinc-500">
                                  {timeAgo(issue.updated_at)}
                                </span>
                              </div>

                              <div className="line-clamp-2 text-[13px] font-medium leading-snug text-zinc-900 dark:text-zinc-100">
                                {issue.title}
                              </div>

                              {latestComment && (
                                <div
                                  className={`truncate rounded-md px-2 py-1 text-[11px] ${
                                    latestComment.is_unread
                                      ? "border border-indigo-200 bg-indigo-50 text-indigo-800 dark:border-indigo-500/25 dark:bg-indigo-500/[0.08] dark:text-indigo-200"
                                      : "bg-zinc-100 text-zinc-600 dark:bg-white/[0.025] dark:text-zinc-400"
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
                                    <span className="inline-flex max-w-[140px] items-center gap-1 truncate rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] text-zinc-600 dark:border-white/8 dark:bg-white/[0.03] dark:text-zinc-400">
                                      <FolderKanban className="h-2.5 w-2.5 shrink-0 text-zinc-400 dark:text-zinc-500" />
                                      <span className="truncate">
                                        {issue.project_name}
                                      </span>
                                    </span>
                                  )}
                                  {resolveIssueLabels(issue, labelLookup)
                                    .slice(0, 2)
                                    .map((lbl) => (
                                      <IssueLabelBadge
                                        key={lbl.key}
                                        name={lbl.name}
                                        color={lbl.color}
                                        variant="list"
                                      />
                                    ))}
                                </div>

                                <div className="flex shrink-0 items-center gap-1.5">
                                  {issue.unread_responses > 0 && (
                                    <span className="flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 dark:bg-indigo-500/25 dark:text-indigo-200">
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
                              className="w-full rounded-lg border border-zinc-200 bg-zinc-50 py-2 text-xs font-medium text-zinc-700 transition hover:border-indigo-400 hover:text-zinc-900 dark:border-white/10 dark:bg-[#141720] dark:text-zinc-300 dark:hover:border-indigo-500/40 dark:hover:text-white"
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
                    <div className="flex h-full items-center justify-center bg-white text-xs text-zinc-500 dark:bg-[#0D1017]">
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
                      inBacklogRank={backlogRankById.get(selectedIssue.id) ?? null}
                      onToggleBacklog={handleToggleBacklog}
                      timeAgo={timeAgo}
                    />
                  )}
                </main>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Custom View Builder / Editor Modal */}
      {showViewModal && (
        <CustomViewModal
          issues={issues}
          meta={workspaceMeta}
          viewerName={settings.viewer_name}
          initialView={editingView}
          seedState={{
            teamFilter,
            scopeFilter,
            search,
            layoutMode,
            rules: filterRules,
            matchMode: filterMatchMode,
            boardConfig,
          }}
          onSave={handleSaveCustomView}
          onClose={() => {
            setShowViewModal(false);
            setEditingView(null);
          }}
        />
      )}

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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm dark:bg-black/75">
          <form
            onSubmit={handleSaveSettings}
            className="max-h-[90vh] w-full max-w-lg space-y-4 overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl dark:border-white/12 dark:bg-[#10131B]"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-white">
                Settings & API Keys
              </h2>
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                className="text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Appearance Theme */}
            <div className="flex items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-white/10 dark:bg-[#090B10]">
              <div>
                <div className="text-xs font-medium text-zinc-900 dark:text-zinc-200">
                  Appearance
                </div>
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  Switch between Light and Dark mode
                </div>
              </div>
              <div className="inline-flex rounded-lg border border-zinc-200 bg-zinc-100 p-0.5 dark:border-white/10 dark:bg-[#141720]">
                <button
                  type="button"
                  onClick={() => setTheme("light")}
                  className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                    theme === "light"
                      ? "bg-white text-zinc-900 shadow-xs"
                      : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
                  }`}
                >
                  <Sun className="h-3 w-3 text-amber-500" />
                  Light
                </button>
                <button
                  type="button"
                  onClick={() => setTheme("dark")}
                  className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition ${
                    theme === "dark"
                      ? "bg-[#1B2030] text-white shadow-xs"
                      : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
                  }`}
                >
                  <Moon className="h-3 w-3 text-indigo-400" />
                  Dark
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Linear Personal API Key
              </label>
              <input
                type="password"
                value={settings.linear_api_key}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, linear_api_key: e.target.value }))
                }
                placeholder="lin_api_..."
                className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-900 focus:border-indigo-500 focus:outline-none dark:border-white/10 dark:bg-[#090B10] dark:text-zinc-100"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
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
                className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-900 focus:border-indigo-500 focus:outline-none dark:border-white/10 dark:bg-[#090B10] dark:text-zinc-100"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Claude Model
                </label>
                <button
                  type="button"
                  onClick={() =>
                    void loadClaudeModels(settings.anthropic_api_key)
                  }
                  disabled={loadingModels || !settings.anthropic_api_key.trim()}
                  className="text-[11px] font-medium text-indigo-600 transition hover:text-indigo-700 disabled:opacity-50 dark:text-indigo-400 dark:hover:text-indigo-300"
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
                <p className="text-[11px] text-rose-600 dark:text-rose-400">
                  {modelsError}
                </p>
              )}
            </div>

            {/* Auto-Sync & Desktop Notifications */}
            <div className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-white/10 dark:bg-[#090B10]">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-medium text-zinc-900 dark:text-zinc-200">
                    Background Auto-Sync
                  </div>
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
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

              <div className="h-px bg-zinc-200 dark:bg-white/8" />

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
                    className="h-3.5 w-3.5 rounded border-zinc-400 bg-white accent-indigo-600 dark:border-zinc-600 dark:bg-zinc-900 dark:accent-indigo-500"
                  />
                  <span>
                    <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-900 dark:text-zinc-200">
                      <Bell className="h-3 w-3 text-indigo-600 dark:text-indigo-400" />
                      Desktop Notifications
                    </span>
                    <span className="block text-[11px] text-zinc-500 dark:text-zinc-400">
                      Alert when new teammate replies arrive
                    </span>
                  </span>
                </label>

                <button
                  type="button"
                  onClick={() => void handleTestNotification()}
                  className="shrink-0 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700 transition hover:border-indigo-400 hover:bg-zinc-100 dark:border-white/10 dark:bg-[#151923] dark:text-zinc-200 dark:hover:border-indigo-500/40 dark:hover:bg-[#1B202D]"
                >
                  Test
                </button>
              </div>
              {notifyTestMsg && (
                <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
                  {notifyTestMsg}
                </p>
              )}
            </div>

            {/* Full Workspace Re-sync */}
            <div className="flex items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-white/10 dark:bg-[#090B10]">
              <div>
                <div className="text-xs font-medium text-zinc-900 dark:text-zinc-200">
                  Workspace Sync ({issues.length} tickets cached)
                </div>
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
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
                className="shrink-0 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:border-indigo-400 hover:bg-zinc-100 disabled:opacity-50 dark:border-white/10 dark:bg-[#151923] dark:text-zinc-200 dark:hover:border-indigo-500/40 dark:hover:bg-[#1B202D]"
              >
                Full Re-sync
              </button>
            </div>

            {/* Claude Code Bridge */}
            <BridgeSettings
              onStatusChange={setBridgeStatus}
              onSettingsSaved={(saved) => {
                setBridgeSettings(saved);
                void loadLauncherStatus();
              }}
            />

            {/* Ubuntu Desktop Integration */}
            <div className="space-y-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-white/10 dark:bg-[#090B10]">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-900 dark:text-zinc-200">
                    <Monitor className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                    Ubuntu Desktop Icon
                  </div>
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Register launcher & dock icon in GNOME
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleInstallDesktopIcon()}
                  className="shrink-0 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:border-indigo-400 hover:bg-zinc-100 dark:border-white/10 dark:bg-[#151923] dark:text-zinc-200 dark:hover:border-indigo-500/40 dark:hover:bg-[#1B202D]"
                >
                  Install Icon
                </button>
              </div>
              {desktopInstallMsg && (
                <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
                  {desktopInstallMsg}
                </p>
              )}
            </div>

            {/* App Updates */}
            <div className="space-y-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-white/10 dark:bg-[#090B10]">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-medium text-zinc-900 dark:text-zinc-200">
                    App Updates
                  </div>
                  <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
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
                    className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:border-indigo-400 hover:bg-zinc-100 disabled:opacity-60 dark:border-white/10 dark:bg-[#151923] dark:text-zinc-200 dark:hover:border-indigo-500/40 dark:hover:bg-[#1B202D]"
                  >
                    {updateStatus === "checking"
                      ? "Checking..."
                      : "Check for updates"}
                  </button>
                )}
              </div>
              {updateMessage && (
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  {updateMessage}
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/5"
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
