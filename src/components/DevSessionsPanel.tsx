import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Hammer,
  Loader2,
  RefreshCw,
  Square,
  X,
} from "lucide-react";
import type { DevSessionView, LauncherStatus } from "../types";
import { openExternalUrl } from "../lib/openExternal";

interface DevSessionsPanelProps {
  devSessions: DevSessionView[];
  launcherStatus: LauncherStatus | null;
  devLaunchMode: string;
  onRefresh: () => Promise<void> | void;
  onStop: (sessionId: string) => Promise<void> | void;
  onRemoveItem: (sessionId: string, issueId: string) => Promise<void> | void;
  onSelectIdentifier?: (identifier: string) => void;
  timeAgo: (iso: string) => string;
}

function itemStatusChipClass(status: string): string {
  switch (status) {
    case "in_progress":
      return "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/15 dark:text-blue-300";
    case "split":
      return "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/15 dark:text-violet-300";
    case "blocked":
      return "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300";
    case "done":
      return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300";
    default:
      return "border-zinc-200 bg-zinc-100 text-zinc-600 dark:border-white/10 dark:bg-white/[0.06] dark:text-zinc-300";
  }
}

function formatModelLabel(model: string | null | undefined): string | null {
  const trimmed = model?.trim();
  if (!trimmed) return null;
  switch (trimmed.toLowerCase()) {
    case "opus":
      return "Opus";
    case "sonnet":
      return "Sonnet";
    case "fable":
      return "Fable";
    default:
      return trimmed;
  }
}

function formatModelEffort(
  model: string | null | undefined,
  effort: string | null | undefined
): string | null {
  const parts = [formatModelLabel(model), effort?.trim() || null].filter(
    (p): p is string => Boolean(p)
  );
  return parts.length > 0 ? parts.join(" · ") : null;
}

function sessionStatusPill(session: DevSessionView["session"]) {
  if (session.status === "starting") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/15 dark:text-indigo-300">
        <Loader2 className="h-2.5 w-2.5 animate-spin" />
        starting
      </span>
    );
  }
  if (session.status === "running") {
    const trimmedAgent = session.agent_status?.trim();
    const label =
      trimmedAgent && trimmedAgent !== "launcher offline"
        ? `running·${trimmedAgent}`
        : "running";
    const isBusy = trimmedAgent === "busy";
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
          isBusy
            ? "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/15 dark:text-blue-300"
            : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300"
        }`}
      >
        {label}
      </span>
    );
  }
  if (session.status === "failed") {
    return (
      <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-300">
        failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full border border-zinc-200 bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-600 dark:border-white/10 dark:bg-white/[0.06] dark:text-zinc-300">
      {session.status}
    </span>
  );
}

export function DevSessionsPanel({
  devSessions,
  launcherStatus,
  devLaunchMode,
  onRefresh,
  onStop,
  onRemoveItem,
  onSelectIdentifier,
  timeAgo,
}: DevSessionsPanelProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [endedOpen, setEndedOpen] = useState(false);

  const hasRunningRef = useRef(
    devSessions.some(
      (s) => s.session.status === "running" || s.session.status === "starting"
    )
  );
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  // A launcher session stays "starting" until the launcher reports back; poll for it.
  const hasLauncherStarting = devSessions.some(
    (s) => s.session.launch_mode === "launcher" && s.session.status === "starting"
  );
  useEffect(() => {
    if (!hasLauncherStarting) return;
    const timer = window.setInterval(() => {
      void Promise.resolve(onRefreshRef.current()).catch(() => {});
    }, 20_000);
    return () => window.clearInterval(timer);
  }, [hasLauncherStarting]);

  useEffect(() => {
    if (!hasRunningRef.current) return;
    let active = true;
    (async () => {
      setRefreshing(true);
      try {
        await onRefreshRef.current();
      } catch {
        // Error surfaced via parent banner
      } finally {
        if (active) setRefreshing(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const activeCards = useMemo(
    () =>
      devSessions.filter(
        (s) =>
          s.session.status === "starting" ||
          s.session.status === "running" ||
          s.session.status === "failed"
      ),
    [devSessions]
  );

  const endedSessions = useMemo(
    () =>
      devSessions
        .filter(
          (s) => s.session.status === "stopped" || s.session.status === "ended"
        )
        .slice(0, 10),
    [devSessions]
  );

  if (devSessions.length === 0) {
    return null;
  }

  async function handleRefreshClick() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } catch {
      // Error surfaced via parent banner
    } finally {
      setRefreshing(false);
    }
  }

  async function handleStopOrDismiss(sessionId: string) {
    if (busyId) return;
    setBusyId(sessionId);
    try {
      await onStop(sessionId);
    } catch {
      // Error surfaced via parent banner
    } finally {
      setBusyId(null);
    }
  }

  async function handleRemoveItemClick(sessionId: string, issueId: string) {
    try {
      await onRemoveItem(sessionId, issueId);
    } catch {
      // Error surfaced via parent banner
    }
  }

  return (
    <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-3.5 dark:border-white/8 dark:bg-[#10131B]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Hammer className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
          <h2 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
            Dev sessions
          </h2>
          {activeCards.length > 0 && (
            <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] text-zinc-600 dark:bg-white/[0.06] dark:text-zinc-300">
              {activeCards.length}
            </span>
          )}
          {devLaunchMode !== "ssh" && launcherStatus !== null && (
            launcherStatus.online ? (
              <span
                title="New sessions start in Claude with full tools."
                className="inline-flex items-center gap-1.5 text-[11px] text-zinc-600 dark:text-zinc-400"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Launcher online
              </span>
            ) : (
              <span className="inline-flex flex-wrap items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-300">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                <span>
                  Launcher offline — new sessions start from the command line
                  without GitHub tools.
                </span>
                {launcherStatus.launcher_session_id && (
                  <button
                    type="button"
                    title="Open the launcher in Claude and send any message to wake it."
                    onClick={() =>
                      void openExternalUrl(
                        `https://claude.ai/code/${launcherStatus.launcher_session_id}`
                      )
                    }
                    className="font-medium text-indigo-600 underline hover:text-indigo-500 dark:text-indigo-400 dark:hover:text-indigo-300"
                  >
                    Open launcher
                  </button>
                )}
              </span>
            )
          )}
        </div>

        <button
          type="button"
          onClick={() => void handleRefreshClick()}
          disabled={refreshing}
          title="Refresh dev session statuses"
          className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] font-medium text-zinc-700 transition hover:border-indigo-400 hover:text-zinc-900 disabled:opacity-50 dark:border-white/10 dark:bg-[#151923] dark:text-zinc-200 dark:hover:border-indigo-500/40"
        >
          <RefreshCw
            className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`}
          />
          Refresh
        </button>
      </div>

      {activeCards.length > 0 && (
        <div className="space-y-2.5">
          {activeCards.map(({ session, items }) => {
            const visibleItems = items.filter((i) => i.status !== "removed");
            const isFailed = session.status === "failed";
            const isBusy = busyId === session.id;
            const modelEffortLabel = formatModelEffort(
              session.model,
              session.effort
            );

            return (
              <div
                key={session.id}
                className={`space-y-2.5 rounded-lg border p-3 ${
                  isFailed
                    ? "border-rose-300 bg-rose-50/70 dark:border-rose-500/35 dark:bg-rose-500/10"
                    : "border-zinc-200 bg-zinc-50/70 dark:border-white/8 dark:bg-[#0B0E14]"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="truncate text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                      {session.name}
                    </span>
                    {sessionStatusPill(session)}
                    {session.launch_mode !== "launcher" && (
                      <span
                        title="Started from the command line: no GitHub PR tools"
                        className="rounded border border-zinc-200 bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:border-white/10 dark:bg-white/[0.05] dark:text-zinc-400"
                      >
                        CLI
                      </span>
                    )}
                    {modelEffortLabel && (
                      <span className="rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-300">
                        {modelEffortLabel}
                      </span>
                    )}
                    <span className="font-mono text-[10px] text-zinc-500 dark:text-zinc-400">
                      {timeAgo(session.started_at)}
                    </span>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    {isFailed ? (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleStopOrDismiss(session.id)}
                        className="inline-flex items-center gap-1 rounded-md border border-rose-300 bg-white px-2.5 py-1 text-[11px] font-medium text-rose-700 transition hover:bg-rose-100 disabled:opacity-50 dark:border-rose-500/40 dark:bg-rose-950/50 dark:text-rose-200 dark:hover:bg-rose-500/25"
                      >
                        <X className="h-3 w-3" />
                        Dismiss
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            void openExternalUrl(
                              session.remote_session_id
                                ? `https://claude.ai/code/${session.remote_session_id}`
                                : "https://claude.ai/code"
                            )
                          }
                          title={
                            session.remote_session_id
                              ? "Open this session in Claude"
                              : `Opens your session list — it's at the top, named ${session.name}`
                          }
                          className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700 transition hover:border-indigo-400 hover:text-zinc-900 dark:border-white/10 dark:bg-[#151923] dark:text-zinc-200 dark:hover:border-indigo-500/40"
                        >
                          <ExternalLink className="h-3 w-3" />
                          Open
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Stop ${session.name}? Its worktree and branch stay on the server.`
                              )
                            ) {
                              void handleStopOrDismiss(session.id);
                            }
                          }}
                          className="inline-flex items-center gap-1 rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700 transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50 dark:border-white/10 dark:bg-[#151923] dark:text-zinc-200 dark:hover:border-rose-500/40 dark:hover:bg-rose-500/15 dark:hover:text-rose-200"
                        >
                          <Square className="h-2.5 w-2.5" />
                          Stop
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {session.launch_mode === "launcher" &&
                  session.status === "starting" && (
                    <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                      Waiting for the launcher…
                    </p>
                  )}

                {session.agent_status === "launcher offline" && (
                  <p className="text-[11px] text-amber-700 dark:text-amber-300">
                    Launcher was offline, started from the command line
                  </p>
                )}

                {isFailed && session.error && (
                  <pre className="overflow-x-auto whitespace-pre-wrap rounded-md border border-rose-200 bg-white/70 p-2 font-mono text-[11px] leading-relaxed text-rose-800 dark:border-rose-500/25 dark:bg-rose-950/30 dark:text-rose-200">
                    {session.error}
                  </pre>
                )}

                {visibleItems.length > 0 && (
                  <div className="space-y-1">
                    {visibleItems.map((item) => {
                      const ident = item.identifier ?? item.issue_id;
                      return (
                        <div
                          key={item.issue_id}
                          className="flex items-center justify-between gap-2 rounded-md border border-zinc-200/80 bg-white px-2.5 py-1.5 text-xs dark:border-white/[0.06] dark:bg-[#121620]"
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            {item.identifier && onSelectIdentifier ? (
                              <button
                                type="button"
                                onClick={() =>
                                  onSelectIdentifier(item.identifier!)
                                }
                                className="shrink-0 font-mono text-[11px] font-semibold text-indigo-600 hover:underline dark:text-indigo-400"
                              >
                                {ident}
                              </button>
                            ) : (
                              <span className="shrink-0 font-mono text-[11px] font-semibold text-indigo-600 dark:text-indigo-400">
                                {ident}
                              </span>
                            )}
                            <span className="min-w-0 truncate text-xs text-zinc-800 dark:text-zinc-200">
                              {item.title ?? "(not synced)"}
                            </span>
                            {item.note && (
                              <span className="hidden truncate text-[11px] text-zinc-500 dark:text-zinc-400 sm:inline">
                                — {item.note}
                              </span>
                            )}
                          </div>

                          <div className="flex shrink-0 items-center gap-1.5">
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${itemStatusChipClass(
                                item.status
                              )}`}
                            >
                              {item.status}
                            </span>
                            {item.status === "queued" && !isFailed && (
                              <button
                                type="button"
                                title="Remove from session queue"
                                aria-label="Remove from session queue"
                                onClick={() =>
                                  void handleRemoveItemClick(
                                    session.id,
                                    item.issue_id
                                  )
                                }
                                className="rounded p-0.5 text-zinc-400 transition hover:bg-rose-50 hover:text-rose-600 dark:text-zinc-500 dark:hover:bg-rose-500/15 dark:hover:text-rose-300"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {endedSessions.length > 0 && (
        <div className="rounded-lg border border-zinc-200/80 dark:border-white/8">
          <button
            type="button"
            onClick={() => setEndedOpen((v) => !v)}
            className="flex w-full items-center justify-between px-3 py-1.5 text-[11px] font-medium text-zinc-600 transition hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"
          >
            <span className="flex items-center gap-1.5">
              {endedOpen ? (
                <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-zinc-400" />
              )}
              <span>Ended</span>
              <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] text-zinc-600 dark:bg-white/[0.06] dark:text-zinc-400">
                {endedSessions.length}
              </span>
            </span>
            <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
              Last {endedSessions.length}
            </span>
          </button>

          {endedOpen && (
            <div className="divide-y divide-zinc-200/80 border-t border-zinc-200/80 dark:divide-white/[0.06] dark:border-white/8">
              {endedSessions.map(({ session, items }) => {
                const count = items.filter((i) => i.status !== "removed").length;
                const modelEffortLabel = formatModelEffort(
                  session.model,
                  session.effort
                );
                return (
                  <div
                    key={session.id}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-[11px]"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium text-zinc-800 dark:text-zinc-200">
                        {session.name}
                      </span>
                      {sessionStatusPill(session)}
                      {session.launch_mode !== "launcher" && (
                        <span
                          title="Started from the command line: no GitHub PR tools"
                          className="rounded border border-zinc-200 bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-500 dark:border-white/10 dark:bg-white/[0.05] dark:text-zinc-400"
                        >
                          CLI
                        </span>
                      )}
                      {modelEffortLabel && (
                        <span className="rounded-md border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-300">
                          {modelEffortLabel}
                        </span>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2 font-mono text-[10px] text-zinc-500 dark:text-zinc-400">
                      <span>{count} {count === 1 ? "issue" : "issues"}</span>
                      <span>{timeAgo(session.started_at)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
