import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  AlertCircle,
  CheckCheck,
  Clock,
  Download,
  Flame,
  FolderKanban,
  Inbox,
  Layers,
  MessageSquare,
  Monitor,
  RefreshCw,
  Reply,
  Search,
  Settings,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import type {
  ActiveTab,
  AiTriageResult,
  AppSettings,
  ClaudeModelOption,
  LinearIssue,
  ScopeFilter,
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

const DEFAULT_CLAUDE_MODELS: ClaudeModelOption[] = [
  { id: "claude-haiku-4-5", display_name: "Claude Haiku 4.5" },
  { id: "claude-sonnet-4-6", display_name: "Claude Sonnet 4.6" },
];

const SCOPE_OPTIONS: { id: ScopeFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "started", label: "In Progress" },
  { id: "backlog", label: "Backlog" },
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
  const [issues, setIssues] = useState<LinearIssue[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [triageDrawerId, setTriageDrawerId] = useState<string | null>(null);
  const [teamFilter, setTeamFilter] = useState<string>("ALL");
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [search, setSearch] = useState("");
  const [settings, setSettings] = useState<AppSettings>({
    linear_api_key: "",
    anthropic_api_key: "",
    claude_model: "claude-haiku-4-5",
    viewer_id: null,
    viewer_name: null,
  });
  const [triage, setTriage] = useState<AiTriageResult | null>(null);

  const [syncing, setSyncing] = useState(false);
  const [triaging, setTriaging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const [appVersion, setAppVersion] = useState("0.2.2");
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null);
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
    if (!silent) {
      setUpdateMessage(null);
    }
    try {
      setUpdateStatus("checking");
      const update = await check();
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
        const loadedSettings = await invoke<AppSettings>("get_settings");
        setSettings(loadedSettings);
        if (loadedSettings.anthropic_api_key.trim()) {
          void loadClaudeModels(
            loadedSettings.anthropic_api_key,
            loadedSettings
          );
        }
        const cachedIssues = await invoke<LinearIssue[]>("get_issues");
        setIssues(cachedIssues);
        if (cachedIssues.length > 0) {
          setSelectedId(cachedIssues[0].id);
        }
        const cachedTriage = await invoke<AiTriageResult | null>(
          "get_cached_triage"
        );
        if (cachedTriage) setTriage(cachedTriage);
      } catch (err) {
        console.warn("Initial load skipped or failed:", err);
      }

      void checkForUpdates(true);
    })();

    const interval = setInterval(() => {
      void checkForUpdates(true);
    }, 15 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

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
    return [
      { key: "ALL", count: issues.length },
      ...Array.from(counts.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([key, count]) => ({ key, count })),
    ];
  }, [issues]);

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
      if (scopeFilter === "active" && (st === "completed" || st === "canceled")) {
        return false;
      }
      if (scopeFilter === "started" && st !== "started") {
        return false;
      }
      if (scopeFilter === "backlog" && st !== "backlog" && st !== "triage") {
        return false;
      }
      if (
        scopeFilter === "mine" &&
        (!viewerNameLower ||
          issue.assignee_name?.trim().toLowerCase() !== viewerNameLower)
      ) {
        return false;
      }

      if (!q) return true;
      return (
        issue.identifier.toLowerCase().includes(q) ||
        issue.title.toLowerCase().includes(q) ||
        issue.state_name.toLowerCase().includes(q) ||
        (issue.project_name?.toLowerCase().includes(q) ?? false) ||
        (issue.assignee_name?.toLowerCase().includes(q) ?? false) ||
        issue.labels.some((l) => l.toLowerCase().includes(q))
      );
    });
  }, [issues, activeTab, teamFilter, scopeFilter, search, settings.viewer_name]);

  const selectedIssue = useMemo(
    () => issues.find((i) => i.id === selectedId) ?? null,
    [issues, selectedId]
  );

  const triageDrawerIssue = useMemo(
    () => issues.find((i) => i.id === triageDrawerId) ?? null,
    [issues, triageDrawerId]
  );

  const activeIssue =
    activeTab === "triage" ? triageDrawerIssue : selectedIssue;

  const modelSelectOptions = useMemo(() => {
    const current = settings.claude_model.trim();
    if (!current || claudeModels.some((m) => m.id === current)) {
      return claudeModels;
    }
    return [{ id: current, display_name: current }, ...claudeModels];
  }, [claudeModels, settings.claude_model]);

  async function handleSync() {
    setError(null);
    setSyncing(true);
    try {
      const fresh = await invoke<LinearIssue[]>("sync_linear");
      setIssues(fresh);
      if (!selectedId && fresh.length > 0) {
        setSelectedId(fresh[0].id);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setSyncing(false);
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

  async function handleInstallDesktopIcon() {
    setDesktopInstallMsg(null);
    try {
      const msg = await invoke<string>("install_desktop_entry");
      setDesktopInstallMsg(msg);
    } catch (err) {
      setDesktopInstallMsg(String(err));
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
    setShowSettings(true);
    if (settings.anthropic_api_key.trim()) {
      void loadClaudeModels(settings.anthropic_api_key);
    }
  }

  async function handleInstallUpdate() {
    if (!pendingUpdate) return;
    setUpdateMessage(null);
    try {
      setUpdateStatus("installing");
      setUpdateMessage(`Installing v${pendingUpdate.version}...`);
      await pendingUpdate.downloadAndInstall();
      await relaunch();
    } catch (err) {
      setUpdateStatus("error");
      setUpdateMessage(String(err));
    }
  }

  function jumpToIdentifier(identifier: string) {
    const match = issuesByIdentifier.get(identifier.toUpperCase());
    if (!match) return;
    if (activeTab === "triage") {
      setTriageDrawerId(match.id);
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
        if (showSettings) {
          setShowSettings(false);
          return;
        }
        if (triageDrawerId) {
          setTriageDrawerId(null);
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

      if (e.key.toLowerCase() === "r") {
        e.preventDefault();
        void handleSync();
        return;
      }

      if (e.key.toLowerCase() === "o" && activeIssue) {
        e.preventDefault();
        void openExternal(activeIssue.url);
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
          <span className="rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] font-medium text-zinc-400">
            v{appVersion}
          </span>
        </div>

        <button
          onClick={() => void handleSync()}
          disabled={syncing}
          className="mb-4 flex w-full items-center justify-between rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white shadow-sm shadow-indigo-950/50 transition hover:bg-indigo-500 disabled:opacity-60"
        >
          <span className="flex items-center gap-2">
            <RefreshCw
              className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`}
            />
            {syncing ? "Syncing Linear..." : "Sync Linear"}
          </span>
          <kbd className="rounded border border-white/20 bg-black/20 px-1.5 py-0.5 font-mono text-[9px] text-indigo-100">
            R
          </kbd>
        </button>

        <nav className="space-y-1">
          <button
            onClick={() => {
              setActiveTab("latest");
              setTriageDrawerId(null);
            }}
            className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs font-medium transition ${
              activeTab === "latest"
                ? "border border-white/10 bg-white/[0.08] text-white shadow-xs"
                : "border border-transparent text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200"
            }`}
          >
            <span className="flex items-center gap-2.5">
              <Inbox className="h-3.5 w-3.5 text-zinc-300" />
              Latest Activity
            </span>
            <span className="font-mono text-[11px] text-zinc-500">
              {issues.length}
            </span>
          </button>

          <button
            onClick={() => {
              setActiveTab("responses");
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
            onClick={() => setActiveTab("triage")}
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

        <div className="mt-6 px-1.5">
          <div className="mb-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            <span>Teams</span>
            <Layers className="h-3 w-3 text-zinc-600" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {teamCounts.map((t) => (
              <button
                key={t.key}
                onClick={() => setTeamFilter(t.key)}
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
                O
              </kbd>{" "}
              open
            </span>
            <span>
              <kbd className="rounded border border-white/10 bg-white/[0.04] px-1 font-mono text-zinc-400">
                M
              </kbd>{" "}
              seen
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
                            <button
                              key={`${item.identifier}-${idx}`}
                              type="button"
                              onClick={() => jumpToIdentifier(item.identifier)}
                              className={`group rounded-xl border p-4 text-left transition ${
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
                                <span
                                  className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${urgencyClass(
                                    item.urgency
                                  )}`}
                                >
                                  {item.urgency}
                                </span>
                              </div>
                              <div className="text-sm font-medium text-zinc-100 group-hover:text-white">
                                {item.title}
                              </div>
                              <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">
                                {item.reason}
                              </p>
                            </button>
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

            {/* Right-side Slide-Over Ticket Drawer */}
            {triageDrawerIssue && (
              <aside className="w-[540px] shrink-0 border-l border-white/10 shadow-2xl shadow-black/70">
                <IssueDetail
                  issue={triageDrawerIssue}
                  viewerId={settings.viewer_id}
                  knownIdentifiers={knownIdentifiers}
                  onSelectIdentifier={jumpToIdentifier}
                  onMarkSeen={handleMarkSeen}
                  onMarkUnread={handleMarkUnread}
                  onClose={() => setTriageDrawerId(null)}
                  timeAgo={timeAgo}
                />
              </aside>
            )}
          </div>
        ) : (
          <div className="flex flex-1 overflow-hidden">
            {/* Issue List */}
            <section className="flex w-[430px] shrink-0 flex-col border-r border-white/8 bg-[#0C0E14]">
              <div className="space-y-2.5 border-b border-white/8 p-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-zinc-500" />
                  <input
                    ref={searchRef}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search title, ID, project, label... (Ctrl+K)"
                    className="w-full rounded-lg border border-white/10 bg-[#141720] py-1.5 pl-8 pr-8 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-indigo-500/60 focus:outline-none"
                  />
                  {search && (
                    <button
                      type="button"
                      onClick={() => setSearch("")}
                      className="absolute right-2 top-2 text-zinc-500 hover:text-zinc-200"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1">
                    {SCOPE_OPTIONS.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setScopeFilter(opt.id)}
                        className={`rounded-md px-2 py-1 text-[11px] font-medium transition ${
                          scopeFilter === opt.id
                            ? "bg-white/12 text-white"
                            : "text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-300"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>

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

              <div className="flex-1 divide-y divide-white/[0.06] overflow-y-auto">
                {filteredIssues.length === 0 ? (
                  <div className="p-8 text-center text-xs text-zinc-500">
                    {issues.length === 0
                      ? "No tickets synced yet. Add your Linear API key in Settings and click Sync Linear."
                      : "No matching tickets for the current filter."}
                  </div>
                ) : (
                  filteredIssues.map((issue) => {
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
                  })
                )}
              </div>
            </section>

            {/* Detail Pane */}
            <main className="flex-1 overflow-hidden">
              {!selectedIssue ? (
                <div className="flex h-full items-center justify-center bg-[#0D1017] text-xs text-zinc-500">
                  Select a ticket to view details and Markdown responses.
                </div>
              ) : (
                <IssueDetail
                  issue={selectedIssue}
                  viewerId={settings.viewer_id}
                  knownIdentifiers={knownIdentifiers}
                  onSelectIdentifier={jumpToIdentifier}
                  onMarkSeen={handleMarkSeen}
                  onMarkUnread={handleMarkUnread}
                  timeAgo={timeAgo}
                />
              )}
            </main>
          </div>
        )}
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <form
            onSubmit={handleSaveSettings}
            className="w-full max-w-md space-y-4 rounded-2xl border border-white/12 bg-[#10131B] p-6 shadow-2xl"
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
