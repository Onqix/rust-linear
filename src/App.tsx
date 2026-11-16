import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  AlertCircle,
  ArrowUpRight,
  CheckCheck,
  Download,
  Inbox,
  Layers,
  MessageSquare,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  X,
} from "lucide-react";
import type {
  ActiveTab,
  AiTriageResult,
  AppSettings,
  ClaudeModelOption,
  LinearIssue,
} from "./types";

const DEFAULT_CLAUDE_MODELS: ClaudeModelOption[] = [
  { id: "claude-haiku-4-5", display_name: "Claude Haiku 4.5" },
  { id: "claude-sonnet-4-6", display_name: "Claude Sonnet 4.6" },
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

function priorityBadge(priority: number, label: string) {
  switch (priority) {
    case 1:
      return { text: label || "Urgent", cls: "text-rose-400 bg-rose-500/10 border-rose-500/20" };
    case 2:
      return { text: label || "High", cls: "text-amber-400 bg-amber-500/10 border-amber-500/20" };
    case 3:
      return { text: label || "Medium", cls: "text-sky-400 bg-sky-500/10 border-sky-500/20" };
    case 4:
      return { text: label || "Low", cls: "text-zinc-400 bg-zinc-500/10 border-zinc-500/20" };
    default:
      return { text: label || "None", cls: "text-zinc-500 bg-zinc-800/60 border-zinc-700/40" };
  }
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

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("latest");
  const [issues, setIssues] = useState<LinearIssue[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [teamFilter, setTeamFilter] = useState<string>("ALL");
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

  const [appVersion, setAppVersion] = useState("0.1.1");
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null);
  const [updateStatus, setUpdateStatus] = useState<
    "idle" | "checking" | "available" | "installing" | "up-to-date" | "error"
  >("idle");
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);

  const [claudeModels, setClaudeModels] =
    useState<ClaudeModelOption[]>(DEFAULT_CLAUDE_MODELS);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);
  const appVersionRef = useRef(appVersion);
  appVersionRef.current = appVersion;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

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

  const unreadCount = useMemo(
    () => issues.filter((i) => i.unread_responses > 0).length,
    [issues]
  );

  const teams = useMemo(() => {
    const keys = new Set(issues.map((i) => i.team_key));
    return ["ALL", ...Array.from(keys).sort()];
  }, [issues]);

  const filteredIssues = useMemo(() => {
    const q = search.trim().toLowerCase();
    return issues.filter((issue) => {
      if (activeTab === "responses" && issue.unread_responses === 0) return false;
      if (teamFilter !== "ALL" && issue.team_key !== teamFilter) return false;
      if (!q) return true;
      return (
        issue.identifier.toLowerCase().includes(q) ||
        issue.title.toLowerCase().includes(q) ||
        issue.state_name.toLowerCase().includes(q) ||
        (issue.assignee_name?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [issues, activeTab, teamFilter, search]);

  const selectedIssue = useMemo(
    () => issues.find((i) => i.id === selectedId) ?? null,
    [issues, selectedId]
  );

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
    try {
      const res = await invoke<AiTriageResult>("run_ai_triage");
      setTriage(res);
      setActiveTab("triage");
    } catch (err) {
      setError(String(err));
    } finally {
      setTriaging(false);
    }
  }

  async function handleMarkSeen(issueId: string) {
    try {
      const updated = await invoke<LinearIssue[]>("mark_issue_seen", { issueId });
      setIssues(updated);
    } catch (err) {
      setError(String(err));
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
    const match = issues.find(
      (i) => i.identifier.toLowerCase() === identifier.toLowerCase()
    );
    if (match) {
      setSelectedId(match.id);
      setActiveTab("latest");
    }
  }

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#0B0D11] text-zinc-100">
      {/* Sidebar */}
      <aside className="flex w-60 shrink-0 flex-col border-r bg-[#111318] p-3">
        <div className="mb-4 flex items-center justify-between px-2 pt-1">
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-indigo-500/20 text-indigo-400">
              <Layers className="h-3.5 w-3.5" />
            </div>
            <span className="text-sm font-semibold tracking-tight">Linear Pulse</span>
          </div>
          <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
            v{appVersion}
          </span>
        </div>

        <button
          onClick={handleSync}
          disabled={syncing}
          className="mb-4 flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white shadow-sm transition hover:bg-indigo-500 disabled:opacity-60"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
          {syncing ? "Syncing Linear..." : "Sync Linear"}
        </button>

        <nav className="space-y-1">
          <button
            onClick={() => setActiveTab("latest")}
            className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs font-medium transition ${
              activeTab === "latest"
                ? "bg-white/10 text-white"
                : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
            }`}
          >
            <span className="flex items-center gap-2">
              <Inbox className="h-3.5 w-3.5" />
              Latest Items
            </span>
            <span className="text-[11px] text-zinc-500">{issues.length}</span>
          </button>

          <button
            onClick={() => setActiveTab("responses")}
            className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs font-medium transition ${
              activeTab === "responses"
                ? "bg-white/10 text-white"
                : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
            }`}
          >
            <span className="flex items-center gap-2">
              <MessageSquare className="h-3.5 w-3.5" />
              Responses
            </span>
            {unreadCount > 0 && (
              <span className="rounded-full bg-indigo-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                {unreadCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab("triage")}
            className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs font-medium transition ${
              activeTab === "triage"
                ? "bg-indigo-500/20 text-indigo-200 border border-indigo-500/30"
                : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
            }`}
          >
            <span className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-indigo-400" />
              AI Triage
            </span>
          </button>
        </nav>

        <div className="mt-6 px-2">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
            Teams
          </div>
          <div className="flex flex-wrap gap-1.5">
            {teams.map((t) => (
              <button
                key={t}
                onClick={() => setTeamFilter(t)}
                className={`rounded-md px-2 py-1 text-[11px] font-medium transition ${
                  teamFilter === t
                    ? "bg-zinc-200 text-zinc-900"
                    : "bg-zinc-800/80 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-auto space-y-2 border-t pt-3">
          {pendingUpdate && (
            <button
              onClick={handleInstallUpdate}
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

          <button
            onClick={handleOpenSettings}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-zinc-400 transition hover:bg-white/5 hover:text-zinc-200"
          >
            <Settings className="h-3.5 w-3.5" />
            Settings & API Keys
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {error && (
          <div className="flex items-center justify-between border-b border-rose-500/30 bg-rose-500/10 px-4 py-2 text-xs text-rose-200">
            <span className="flex items-center gap-2">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 text-rose-400" />
              {error}
            </span>
            <button onClick={() => setError(null)} className="text-rose-300 hover:text-white">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {activeTab === "triage" ? (
          <main className="flex-1 overflow-y-auto p-6">
            <div className="mx-auto max-w-5xl space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h1 className="flex items-center gap-2 text-lg font-semibold">
                    <Sparkles className="h-5 w-5 text-indigo-400" />
                    AI Triage & Next Work
                  </h1>
                  <p className="mt-1 text-xs text-zinc-400">
                    Prioritizes your active Linear tickets into actionable work buckets and
                    suggests what to grab next.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    aria-label="Claude model"
                    value={settings.claude_model}
                    onChange={(e) => void handleModelQuickChange(e.target.value)}
                    className="rounded-lg border bg-[#161920] px-2.5 py-2 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-none"
                  >
                    {modelSelectOptions.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.display_name}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={handleRunTriage}
                    disabled={triaging}
                    className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white transition hover:bg-indigo-500 disabled:opacity-60"
                  >
                    <Sparkles className={`h-3.5 w-3.5 ${triaging ? "animate-spin" : ""}`} />
                    {triaging ? "Analyzing..." : "Run AI Triage"}
                  </button>
                </div>
              </div>

              {!triage ? (
                <div className="rounded-xl border bg-[#111318] p-10 text-center">
                  <Sparkles className="mx-auto mb-3 h-8 w-8 text-indigo-400/70" />
                  <p className="text-sm font-medium text-zinc-200">No AI triage generated yet</p>
                  <p className="mt-1 text-xs text-zinc-400">
                    Sync Linear first, add your Anthropic API key in Settings, and click{" "}
                    <span className="text-zinc-200">Run AI Triage</span>.
                  </p>
                </div>
              ) : (
                <>
                  <div className="rounded-xl border bg-[#111318] p-4">
                    <div className="mb-1 flex items-center justify-between text-[11px] text-zinc-400">
                      <span>Model: {triage.model}</span>
                      <span>Generated {timeAgo(triage.generated_at)}</span>
                    </div>
                    <p className="text-sm leading-relaxed text-zinc-200">{triage.summary}</p>
                  </div>

                  <section>
                    <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                      Suggested Next Tickets to Grab
                    </h2>
                    <div className="grid gap-3 md:grid-cols-2">
                      {triage.next_to_grab.map((item) => (
                        <button
                          key={item.identifier}
                          onClick={() => jumpToIdentifier(item.identifier)}
                          className="group rounded-xl border bg-[#111318] p-4 text-left transition hover:border-indigo-500/40 hover:bg-[#161920]"
                        >
                          <div className="mb-2 flex items-center justify-between">
                            <span className="font-mono text-xs font-semibold text-indigo-400">
                              {item.identifier}
                            </span>
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase ${urgencyClass(
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
                      ))}
                    </div>
                  </section>

                  <section className="space-y-4">
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                      Work Buckets
                    </h2>
                    <div className="grid gap-4 md:grid-cols-2">
                      {triage.work_buckets.map((bucket) => (
                        <div key={bucket.name} className="rounded-xl border bg-[#111318] p-4">
                          <div className="mb-1 text-sm font-semibold text-zinc-100">
                            {bucket.name}
                          </div>
                          <p className="mb-3 text-xs text-zinc-400">{bucket.description}</p>
                          <div className="space-y-2">
                            {bucket.tickets.map((t) => (
                              <button
                                key={t.identifier}
                                onClick={() => jumpToIdentifier(t.identifier)}
                                className="flex w-full items-start justify-between gap-2 rounded-lg border bg-[#0B0D11] p-2.5 text-left transition hover:border-indigo-500/40"
                              >
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono text-[11px] font-semibold text-indigo-400">
                                      {t.identifier}
                                    </span>
                                    <span className="text-xs font-medium text-zinc-200">
                                      {t.title}
                                    </span>
                                  </div>
                                  <p className="mt-1 text-[11px] text-zinc-400">{t.reason}</p>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                </>
              )}
            </div>
          </main>
        ) : (
          <div className="flex flex-1 overflow-hidden">
            {/* Issue List */}
            <section className="flex w-[420px] shrink-0 flex-col border-r bg-[#0E1015]">
              <div className="border-b p-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-500" />
                  <input
                    ref={searchRef}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search tickets... (Ctrl+K)"
                    className="w-full rounded-lg border bg-[#161920] py-1.5 pl-8 pr-3 text-xs text-zinc-100 placeholder:text-zinc-500 focus:border-indigo-500/60 focus:outline-none"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto divide-y">
                {filteredIssues.length === 0 ? (
                  <div className="p-8 text-center text-xs text-zinc-500">
                    {issues.length === 0
                      ? "No tickets synced yet. Add your Linear API key in Settings and click Sync Linear."
                      : "No matching tickets."}
                  </div>
                ) : (
                  filteredIssues.map((issue) => {
                    const p = priorityBadge(issue.priority, issue.priority_label);
                    const isSelected = issue.id === selectedId;
                    return (
                      <button
                        key={issue.id}
                        onClick={() => setSelectedId(issue.id)}
                        className={`flex w-full flex-col gap-1.5 px-3.5 py-3 text-left transition ${
                          isSelected ? "bg-indigo-500/10" : "hover:bg-white/[0.03]"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[11px] font-medium text-zinc-400">
                              {issue.identifier}
                            </span>
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{ backgroundColor: issue.state_color || "#6366f1" }}
                            />
                            <span className="text-[11px] text-zinc-400">{issue.state_name}</span>
                          </div>
                          <span className="text-[10px] text-zinc-500">
                            {timeAgo(issue.updated_at)}
                          </span>
                        </div>

                        <div className="line-clamp-2 text-xs font-medium text-zinc-100">
                          {issue.title}
                        </div>

                        <div className="flex items-center justify-between gap-2 pt-0.5">
                          <div className="flex items-center gap-1.5">
                            <span className={`rounded border px-1.5 py-0.5 text-[10px] ${p.cls}`}>
                              {p.text}
                            </span>
                            {issue.assignee_name && (
                              <span className="text-[10px] text-zinc-500">
                                {issue.assignee_name}
                              </span>
                            )}
                          </div>
                          {issue.unread_responses > 0 && (
                            <span className="flex items-center gap-1 rounded-full bg-indigo-500/20 px-2 py-0.5 text-[10px] font-semibold text-indigo-300">
                              <MessageSquare className="h-2.5 w-2.5" />
                              {issue.unread_responses} new
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </section>

            {/* Detail Pane */}
            <main className="flex-1 overflow-y-auto p-6">
              {!selectedIssue ? (
                <div className="flex h-full items-center justify-center text-xs text-zinc-500">
                  Select a ticket to view details and responses.
                </div>
              ) : (
                <div className="mx-auto max-w-3xl space-y-6">
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
                    <div>
                      <div className="mb-1.5 flex items-center gap-2 text-xs text-zinc-400">
                        <span className="font-mono font-semibold text-indigo-400">
                          {selectedIssue.identifier}
                        </span>
                        <span>•</span>
                        <span>{selectedIssue.team_name}</span>
                        <span>•</span>
                        <span>{selectedIssue.state_name}</span>
                      </div>
                      <h1 className="text-lg font-semibold text-white">{selectedIssue.title}</h1>
                    </div>

                    <div className="flex items-center gap-2">
                      {selectedIssue.unread_responses > 0 && (
                        <button
                          onClick={() => handleMarkSeen(selectedIssue.id)}
                          className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300 transition hover:bg-emerald-500/20"
                        >
                          <CheckCheck className="h-3.5 w-3.5" />
                          Mark Responses Seen
                        </button>
                      )}
                      <button
                        onClick={() => openExternal(selectedIssue.url)}
                        className="flex items-center gap-1.5 rounded-lg border bg-[#161920] px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-zinc-800"
                      >
                        Open in Linear
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {selectedIssue.labels.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {selectedIssue.labels.map((label) => (
                        <span
                          key={label}
                          className="rounded-md border bg-[#161920] px-2 py-0.5 text-[11px] text-zinc-300"
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="rounded-xl border bg-[#111318] p-4">
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                      Description
                    </div>
                    <div className="whitespace-pre-wrap text-xs leading-relaxed text-zinc-300">
                      {selectedIssue.description?.trim() || "No description provided."}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                      Responses & Comments ({selectedIssue.comments.length})
                    </div>
                    {selectedIssue.comments.length === 0 ? (
                      <div className="rounded-xl border bg-[#111318] p-4 text-xs text-zinc-500">
                        No comments on this ticket yet.
                      </div>
                    ) : (
                      selectedIssue.comments.map((c) => (
                        <div
                          key={c.id}
                          className={`rounded-xl border p-4 ${
                            c.is_unread
                              ? "border-indigo-500/40 bg-indigo-500/[0.07]"
                              : "bg-[#111318]"
                          }`}
                        >
                          <div className="mb-2 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-semibold text-zinc-200">
                                {c.author_name}
                              </span>
                              {c.is_unread && (
                                <span className="rounded-full bg-indigo-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                                  New
                                </span>
                              )}
                            </div>
                            <span className="text-[11px] text-zinc-500">
                              {timeAgo(c.created_at)}
                            </span>
                          </div>
                          <div className="whitespace-pre-wrap text-xs leading-relaxed text-zinc-300">
                            {c.body}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </main>
          </div>
        )}
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <form
            onSubmit={handleSaveSettings}
            className="w-full max-w-md space-y-4 rounded-2xl border bg-[#111318] p-6 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">Settings & API Keys</h2>
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                className="text-zinc-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-300">Linear Personal API Key</label>
              <input
                type="password"
                value={settings.linear_api_key}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, linear_api_key: e.target.value }))
                }
                placeholder="lin_api_..."
                className="w-full rounded-lg border bg-[#0B0D11] px-3 py-2 text-xs text-zinc-100 focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-300">Anthropic API Key</label>
              <input
                type="password"
                value={settings.anthropic_api_key}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, anthropic_api_key: e.target.value }))
                }
                placeholder="sk-ant-..."
                className="w-full rounded-lg border bg-[#0B0D11] px-3 py-2 text-xs text-zinc-100 focus:border-indigo-500 focus:outline-none"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-zinc-300">Claude Model</label>
                <button
                  type="button"
                  onClick={() => void loadClaudeModels(settings.anthropic_api_key)}
                  disabled={loadingModels || !settings.anthropic_api_key.trim()}
                  className="text-[11px] font-medium text-indigo-400 transition hover:text-indigo-300 disabled:opacity-50"
                >
                  {loadingModels ? "Loading models..." : "Refresh models"}
                </button>
              </div>
              <select
                value={settings.claude_model}
                onChange={(e) =>
                  setSettings((s) => ({ ...s, claude_model: e.target.value }))
                }
                className="w-full rounded-lg border bg-[#0B0D11] px-3 py-2 text-xs text-zinc-100 focus:border-indigo-500 focus:outline-none"
              >
                {modelSelectOptions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.display_name} ({m.id})
                  </option>
                ))}
              </select>
              {modelsError && (
                <p className="text-[11px] text-rose-400">{modelsError}</p>
              )}
            </div>

            <div className="space-y-2 rounded-xl border bg-[#0B0D11] p-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-medium text-zinc-200">App Updates</div>
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
                    className="rounded-lg border bg-[#161920] px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:border-indigo-500/40 hover:bg-[#1B1F28] disabled:opacity-60"
                  >
                    {updateStatus === "checking" ? "Checking..." : "Check for updates"}
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
                className="rounded-lg border px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-white/5"
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
