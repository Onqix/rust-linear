import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  FolderKanban,
  GripVertical,
  History,
  ListOrdered,
  Loader2,
  RotateCcw,
  Sparkles,
  Trash2,
  User,
  X,
  XCircle,
} from "lucide-react";
import type {
  BacklogEntry,
  BridgeStatus,
  LinearIssue,
  RerankRun,
} from "../types";
import { AuthorAvatar, PriorityIcon, StateIcon } from "./Icons";

interface BacklogViewProps {
  backlog: BacklogEntry[];
  issues: LinearIssue[];
  onReorder: (issueIds: string[]) => Promise<void> | void;
  onRemove: (issueId: string) => Promise<void> | void;
  onClearDone: () => Promise<void> | void;
  onSelectIdentifier: (identifier: string) => void;
  timeAgo: (iso: string) => string;
  bridgeStatus: BridgeStatus | null;
  rerankRuns: RerankRun[];
  onStartRerank: (comment: string) => Promise<void> | void;
}

function formatElapsed(startedAt: string, nowMs: number): string {
  const startMs = new Date(startedAt).getTime();
  if (Number.isNaN(startMs)) return "0s";
  const totalSecs = Math.max(0, Math.floor((nowMs - startMs) / 1000));
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${String(secs).padStart(2, "0")}s`;
}

function isCompletedOrCanceled(stateType?: string): "done" | "canceled" | null {
  if (!stateType) return null;
  const st = stateType.trim().toLowerCase();
  if (st === "completed") return "done";
  if (st === "canceled" || st === "cancelled") return "canceled";
  return null;
}

export function BacklogView({
  backlog,
  issues,
  onReorder,
  onRemove,
  onClearDone,
  onSelectIdentifier,
  timeAgo,
  bridgeStatus,
  rerankRuns,
  onStartRerank,
}: BacklogViewProps) {
  const [orderedEntries, setOrderedEntries] = useState<BacklogEntry[]>(backlog);
  const [dragReadyId, setDragReadyId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    id: string;
    edge: "above" | "below";
  } | null>(null);

  const [popoverOpen, setPopoverOpen] = useState(false);
  const [rerankComment, setRerankComment] = useState("");
  const [startingRerank, setStartingRerank] = useState(false);
  const [dismissedRunId, setDismissedRunId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const popoverRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const newestRun = rerankRuns[0] ?? null;
  const isRunning = newestRun?.status === "running";
  const newestFinishedRun = useMemo(
    () =>
      rerankRuns.find(
        (r) => r.status === "succeeded" || r.status === "failed"
      ) ?? null,
    [rerankRuns]
  );

  useEffect(() => {
    if (!isRunning) return;
    setNowMs(Date.now());
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isRunning, newestRun?.id]);

  useEffect(() => {
    if (!popoverOpen) return;
    const focusTimer = window.setTimeout(() => {
      textareaRef.current?.focus();
    }, 0);
    const onMouseDown = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        setPopoverOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [popoverOpen]);

  async function handleStartSubmit() {
    if (isRunning || startingRerank) return;
    setStartingRerank(true);
    try {
      await onStartRerank(rerankComment);
      setRerankComment("");
      setPopoverOpen(false);
    } catch {
      // Error surfaced via parent banner; keep popover open with comment intact.
    } finally {
      setStartingRerank(false);
    }
  }

  async function handleRetry(comment: string) {
    if (isRunning || startingRerank) return;
    setStartingRerank(true);
    try {
      await onStartRerank(comment);
    } catch {
      // Error surfaced via parent banner.
    } finally {
      setStartingRerank(false);
    }
  }

  useEffect(() => {
    setOrderedEntries(
      [...backlog].sort((a, b) => a.position - b.position)
    );
  }, [backlog]);

  const issueById = useMemo(() => {
    const map = new Map<string, LinearIssue>();
    for (const issue of issues) {
      map.set(issue.id, issue);
    }
    return map;
  }, [issues]);

  const doneCount = useMemo(() => {
    let count = 0;
    for (const entry of orderedEntries) {
      const issue = issueById.get(entry.issue_id);
      if (issue && isCompletedOrCanceled(issue.state_type) !== null) {
        count += 1;
      }
    }
    return count;
  }, [orderedEntries, issueById]);

  function commitOrder(nextEntries: BacklogEntry[]) {
    const renumbered = nextEntries.map((entry, idx) => ({
      ...entry,
      position: idx + 1,
    }));
    setOrderedEntries(renumbered);
    void onReorder(renumbered.map((e) => e.issue_id));
  }

  function handleMoveBy(index: number, delta: -1 | 1) {
    const targetIdx = index + delta;
    if (targetIdx < 0 || targetIdx >= orderedEntries.length) return;
    const next = [...orderedEntries];
    const [moved] = next.splice(index, 1);
    next.splice(targetIdx, 0, moved);
    commitOrder(next);
  }

  function handleDropOnRow(targetId: string, edge: "above" | "below") {
    if (!draggingId || draggingId === targetId) {
      setDraggingId(null);
      setDropTarget(null);
      setDragReadyId(null);
      return;
    }

    const fromIdx = orderedEntries.findIndex((e) => e.issue_id === draggingId);
    if (fromIdx === -1) {
      setDraggingId(null);
      setDropTarget(null);
      setDragReadyId(null);
      return;
    }

    const next = [...orderedEntries];
    const [moved] = next.splice(fromIdx, 1);
    let toIdx = next.findIndex((e) => e.issue_id === targetId);
    if (toIdx === -1) {
      setDraggingId(null);
      setDropTarget(null);
      setDragReadyId(null);
      return;
    }
    if (edge === "below") {
      toIdx += 1;
    }
    next.splice(toIdx, 0, moved);

    setDraggingId(null);
    setDropTarget(null);
    setDragReadyId(null);
    commitOrder(next);
  }

  const bridgeBadge = useMemo(() => {
    if (!bridgeStatus) return null;
    if (bridgeStatus.tunnel_state === "connected") {
      return {
        dot: "bg-emerald-500",
        label: "Bridge connected",
      };
    }
    if (bridgeStatus.server_running) {
      return {
        dot: "bg-indigo-500",
        label: `MCP listening on :${bridgeStatus.port}`,
      };
    }
    if (bridgeStatus.tunnel_state === "error" || bridgeStatus.server_error) {
      return {
        dot: "bg-rose-500",
        label: "Bridge error",
      };
    }
    return {
      dot: "bg-zinc-400",
      label: "Bridge off",
    };
  }, [bridgeStatus]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <header className="shrink-0 border-b border-zinc-200 bg-white px-5 py-3.5 dark:border-white/8 dark:bg-[#0C0E14]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2.5">
              <ListOrdered className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
              <h1 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-white">
                Backlog
              </h1>
              <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] text-zinc-600 dark:bg-white/[0.06] dark:text-zinc-300">
                {orderedEntries.length}
              </span>
              {bridgeBadge && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:border-white/10 dark:bg-white/[0.03] dark:text-zinc-400">
                  <span className={`h-1.5 w-1.5 rounded-full ${bridgeBadge.dot}`} />
                  {bridgeBadge.label}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Ranked by Claude Code via the bridge. Drag to reorder.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {bridgeStatus !== null &&
              bridgeStatus.tunnel_state !== "connected" && (
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/12 dark:text-amber-200">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                  Bridge tunnel isn&apos;t connected — Claude won&apos;t be able
                  to reach the backlog.
                </span>
              )}

            <div className="relative" ref={popoverRef}>
              <button
                type="button"
                disabled={isRunning || startingRerank}
                onClick={() => setPopoverOpen((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm shadow-indigo-950/30 transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-70 dark:shadow-indigo-950/50"
              >
                {isRunning ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Claude is reranking…</span>
                    {newestRun && (
                      <span className="rounded bg-white/15 px-1.5 py-0.5 font-mono text-[10px]">
                        {formatElapsed(newestRun.started_at, nowMs)}
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3.5 w-3.5" />
                    <span>Rerank with Claude</span>
                  </>
                )}
              </button>

              {popoverOpen && !isRunning && (
                <div className="absolute right-0 top-full z-30 mt-2 w-80 rounded-xl border border-zinc-200 bg-white p-3.5 shadow-xl dark:border-white/12 dark:bg-[#121620] dark:shadow-black/60">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                      Rerank with Claude
                    </span>
                    <button
                      type="button"
                      onClick={() => setPopoverOpen(false)}
                      className="rounded p-0.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <textarea
                    ref={textareaRef}
                    rows={3}
                    value={rerankComment}
                    onChange={(e) => setRerankComment(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                        e.preventDefault();
                        void handleStartSubmit();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        setPopoverOpen(false);
                      }
                    }}
                    placeholder="Anything Claude should know? (optional)"
                    className="w-full resize-none rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-2 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-white/10 dark:bg-[#090B10] dark:text-zinc-100 dark:placeholder:text-zinc-500"
                  />
                  <div className="mt-2.5 flex items-center justify-between">
                    <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
                      Cmd/Ctrl + Enter to start
                    </span>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setPopoverOpen(false)}
                        className="rounded-md border border-zinc-200 px-2.5 py-1 text-[11px] font-medium text-zinc-600 hover:bg-zinc-100 dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/5"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={startingRerank}
                        onClick={() => void handleStartSubmit()}
                        className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-3 py-1 text-[11px] font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
                      >
                        <Sparkles className="h-3 w-3" />
                        {startingRerank ? "Starting..." : "Start"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              disabled={doneCount === 0}
              onClick={() => void onClearDone()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:border-indigo-400 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-45 dark:border-white/10 dark:bg-[#141720] dark:text-zinc-200 dark:hover:border-indigo-500/40 dark:hover:text-white"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Clear completed
              {doneCount > 0 && (
                <span className="rounded bg-zinc-100 px-1 font-mono text-[10px] text-zinc-600 dark:bg-white/[0.08] dark:text-zinc-300">
                  {doneCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="surface-glow flex-1 overflow-y-auto p-5">
        <div className="mx-auto max-w-5xl space-y-4">
          {/* Latest Finished Result Card */}
          {newestFinishedRun && dismissedRunId !== newestFinishedRun.id && (
            newestFinishedRun.status === "succeeded" ? (
              <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-4 dark:border-indigo-500/25 dark:bg-indigo-500/[0.07]">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-indigo-900 dark:text-indigo-200">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    <span>
                      Reranked{" "}
                      {timeAgo(
                        newestFinishedRun.finished_at ??
                          newestFinishedRun.started_at
                      )}
                    </span>
                  </div>
                  <button
                    type="button"
                    aria-label="Dismiss rerank summary"
                    onClick={() => setDismissedRunId(newestFinishedRun.id)}
                    className="rounded p-0.5 text-zinc-400 hover:bg-zinc-200/60 hover:text-zinc-700 dark:hover:bg-white/10 dark:hover:text-zinc-200"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>

                {newestFinishedRun.comment.trim() && (
                  <blockquote className="mt-2 border-l-2 border-indigo-300 pl-2.5 text-xs italic text-zinc-600 dark:border-indigo-500/40 dark:text-zinc-400">
                    &ldquo;{newestFinishedRun.comment}&rdquo;
                  </blockquote>
                )}

                {newestFinishedRun.summary && (
                  <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-zinc-700 dark:text-zinc-200">
                    {newestFinishedRun.summary}
                  </p>
                )}
              </div>
            ) : (
              <div className="rounded-xl border border-rose-300 bg-rose-50/80 p-4 dark:border-rose-500/35 dark:bg-rose-500/12">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-rose-800 dark:text-rose-200">
                    <XCircle className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
                    <span>
                      Rerank failed{" "}
                      {timeAgo(
                        newestFinishedRun.finished_at ??
                          newestFinishedRun.started_at
                      )}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={isRunning || startingRerank}
                      onClick={() =>
                        void handleRetry(newestFinishedRun.comment)
                      }
                      className="inline-flex items-center gap-1 rounded-md border border-rose-300 bg-white px-2.5 py-1 text-[11px] font-medium text-rose-700 transition hover:bg-rose-100 disabled:opacity-50 dark:border-rose-500/40 dark:bg-rose-950/50 dark:text-rose-200 dark:hover:bg-rose-500/25"
                    >
                      <RotateCcw className="h-3 w-3" />
                      Retry
                    </button>
                    <button
                      type="button"
                      aria-label="Dismiss error"
                      onClick={() => setDismissedRunId(newestFinishedRun.id)}
                      className="rounded p-0.5 text-rose-500 hover:bg-rose-200/60 hover:text-rose-800 dark:text-rose-300 dark:hover:bg-white/10 dark:hover:text-white"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {newestFinishedRun.comment.trim() && (
                  <blockquote className="mt-2 border-l-2 border-rose-300 pl-2.5 text-xs italic text-rose-700/80 dark:border-rose-500/40 dark:text-rose-200/80">
                    &ldquo;{newestFinishedRun.comment}&rdquo;
                  </blockquote>
                )}

                {newestFinishedRun.error && (
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-rose-800 dark:text-rose-200">
                    {newestFinishedRun.error}
                  </pre>
                )}
              </div>
            )
          )}

          {/* History Disclosure */}
          {rerankRuns.length > 0 && (
            <div className="rounded-xl border border-zinc-200 bg-white dark:border-white/8 dark:bg-[#10131B]">
              <button
                type="button"
                onClick={() => setHistoryOpen((v) => !v)}
                className="flex w-full items-center justify-between px-3.5 py-2 text-xs font-medium text-zinc-700 transition hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white"
              >
                <span className="flex items-center gap-2">
                  {historyOpen ? (
                    <ChevronDown className="h-3.5 w-3.5 text-zinc-400" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 text-zinc-400" />
                  )}
                  <History className="h-3.5 w-3.5 text-indigo-500 dark:text-indigo-400" />
                  <span>History</span>
                  <span className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[10px] text-zinc-600 dark:bg-white/[0.06] dark:text-zinc-400">
                    {rerankRuns.length}
                  </span>
                </span>
                <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                  Last {Math.min(rerankRuns.length, 10)} runs
                </span>
              </button>

              {historyOpen && (
                <div className="divide-y divide-zinc-200/80 border-t border-zinc-200/80 dark:divide-white/[0.06] dark:border-white/8">
                  {rerankRuns.slice(0, 10).map((run) => (
                    <div
                      key={run.id}
                      className="flex items-start justify-between gap-3 px-3.5 py-2.5 text-xs"
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                              run.status === "succeeded"
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300"
                                : run.status === "failed"
                                ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-300"
                                : "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/15 dark:text-indigo-300"
                            }`}
                          >
                            {run.status === "running" && (
                              <Loader2 className="h-2.5 w-2.5 animate-spin" />
                            )}
                            {run.status}
                          </span>
                          <span className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                            {timeAgo(run.finished_at ?? run.started_at)}
                          </span>
                        </div>
                        {run.comment.trim() ? (
                          <p className="truncate text-[11px] text-zinc-700 dark:text-zinc-300">
                            &ldquo;{run.comment}&rdquo;
                          </p>
                        ) : (
                          <p className="text-[11px] italic text-zinc-400 dark:text-zinc-500">
                            No instruction
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {orderedEntries.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-12 text-center dark:border-white/12 dark:bg-[#10131B]/70">
              <ListOrdered className="mx-auto mb-3 h-8 w-8 text-indigo-500/75 dark:text-indigo-400/75" />
              <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                Your ranked backlog is empty
              </p>
              <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                Once the Claude Code bridge is connected in Settings, Claude Code
                sessions can prioritize and annotate issues here. You can also
                add any issue directly using the{" "}
                <span className="font-medium text-zinc-700 dark:text-zinc-200">
                  Add to backlog
                </span>{" "}
                button in issue detail.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {orderedEntries.map((entry, idx) => {
                const issue = issueById.get(entry.issue_id);
                const closedKind = isCompletedOrCanceled(issue?.state_type);
                const isDragging = draggingId === entry.issue_id;
                const isDropAbove =
                  dropTarget?.id === entry.issue_id &&
                  dropTarget.edge === "above";
                const isDropBelow =
                  dropTarget?.id === entry.issue_id &&
                  dropTarget.edge === "below";

                return (
                  <div
                    key={entry.issue_id}
                    draggable={dragReadyId === entry.issue_id}
                    onDragStart={(e) => {
                      setDraggingId(entry.issue_id);
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", entry.issue_id);
                    }}
                    onDragEnd={() => {
                      setDraggingId(null);
                      setDropTarget(null);
                      setDragReadyId(null);
                    }}
                    onDragOver={(e) => {
                      if (!draggingId || draggingId === entry.issue_id) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      const rect = e.currentTarget.getBoundingClientRect();
                      const midY = rect.top + rect.height / 2;
                      const edge = e.clientY < midY ? "above" : "below";
                      if (
                        dropTarget?.id !== entry.issue_id ||
                        dropTarget.edge !== edge
                      ) {
                        setDropTarget({ id: entry.issue_id, edge });
                      }
                    }}
                    onDragLeave={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                        if (dropTarget?.id === entry.issue_id) {
                          setDropTarget(null);
                        }
                      }
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const rect = e.currentTarget.getBoundingClientRect();
                      const edge =
                        e.clientY < rect.top + rect.height / 2
                          ? "above"
                          : "below";
                      handleDropOnRow(entry.issue_id, edge);
                    }}
                    onClick={() => {
                      if (issue?.identifier) {
                        onSelectIdentifier(issue.identifier);
                      }
                    }}
                    className={`group relative flex items-center gap-3 rounded-xl border px-3.5 py-3 transition ${
                      issue?.identifier ? "cursor-pointer" : "cursor-default"
                    } ${
                      isDragging
                        ? "border-indigo-400 bg-indigo-50/50 opacity-50 dark:border-indigo-500/50 dark:bg-indigo-500/10"
                        : "border-zinc-200 bg-white hover:border-indigo-300 hover:bg-zinc-50/80 dark:border-white/8 dark:bg-[#10131B] dark:hover:border-indigo-500/40 dark:hover:bg-[#141824]"
                    } ${closedKind ? "opacity-60" : ""}`}
                  >
                    {isDropAbove && (
                      <div className="pointer-events-none absolute -top-1 left-2 right-2 h-0.5 rounded-full bg-indigo-500" />
                    )}
                    {isDropBelow && (
                      <div className="pointer-events-none absolute -bottom-1 left-2 right-2 h-0.5 rounded-full bg-indigo-500" />
                    )}

                    {/* Drag Handle + Keyboard Move Buttons */}
                    <div
                      className="flex shrink-0 items-center gap-0.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        aria-label="Drag to reorder"
                        title="Drag to reorder"
                        onMouseDown={() => setDragReadyId(entry.issue_id)}
                        onMouseUp={() => setDragReadyId(null)}
                        className="cursor-grab rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 active:cursor-grabbing dark:text-zinc-500 dark:hover:bg-white/[0.06] dark:hover:text-zinc-200"
                      >
                        <GripVertical className="h-4 w-4" />
                      </button>
                      <div className="flex flex-col">
                        <button
                          type="button"
                          aria-label="Move up"
                          title="Move up"
                          disabled={idx === 0}
                          onClick={() => handleMoveBy(idx, -1)}
                          className="rounded p-0.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-25 dark:text-zinc-500 dark:hover:bg-white/[0.06] dark:hover:text-zinc-200"
                        >
                          <ChevronUp className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          aria-label="Move down"
                          title="Move down"
                          disabled={idx === orderedEntries.length - 1}
                          onClick={() => handleMoveBy(idx, 1)}
                          className="rounded p-0.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-25 dark:text-zinc-500 dark:hover:bg-white/[0.06] dark:hover:text-zinc-200"
                        >
                          <ChevronDown className="h-3 w-3" />
                        </button>
                      </div>
                    </div>

                    {/* Rank Number */}
                    <div className="flex w-10 shrink-0 items-center justify-center">
                      <span className="font-mono text-lg font-bold tracking-tight text-zinc-400 group-hover:text-indigo-600 dark:text-zinc-500 dark:group-hover:text-indigo-400">
                        {entry.position}
                      </span>
                    </div>

                    {/* Main Issue Info */}
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {issue ? (
                          <>
                            <StateIcon
                              stateType={issue.state_type}
                              color={issue.state_color}
                              className="h-3.5 w-3.5 shrink-0"
                            />
                            <span className="shrink-0 font-mono text-xs font-semibold text-indigo-600 dark:text-indigo-400">
                              {issue.identifier}
                            </span>
                            <span
                              className={`min-w-0 truncate text-sm font-medium text-zinc-900 dark:text-zinc-100 ${
                                closedKind ? "line-through" : ""
                              }`}
                            >
                              {issue.title}
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="shrink-0 font-mono text-xs font-semibold text-zinc-500">
                              {entry.issue_id}
                            </span>
                            <span className="text-sm italic text-zinc-500">
                              (not synced)
                            </span>
                          </>
                        )}

                        {closedKind === "done" && (
                          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300">
                            Done
                          </span>
                        )}
                        {closedKind === "canceled" && (
                          <span className="rounded-full border border-zinc-300 bg-zinc-100 px-2 py-0.5 text-[10px] font-semibold text-zinc-600 dark:border-white/15 dark:bg-white/[0.06] dark:text-zinc-400">
                            Canceled
                          </span>
                        )}
                      </div>

                      {entry.note && (
                        <p className="line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">
                          {entry.note}
                        </p>
                      )}

                      {issue && (
                        <div className="flex flex-wrap items-center gap-3 pt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                          <span className="inline-flex items-center gap-1">
                            <PriorityIcon
                              priority={issue.priority}
                              className="h-3 w-3"
                            />
                            <span>{issue.priority_label}</span>
                          </span>

                          <span className="inline-flex items-center gap-1">
                            {issue.assignee_name ? (
                              <>
                                <AuthorAvatar
                                  name={issue.assignee_name}
                                  size="sm"
                                />
                                <span>{issue.assignee_name}</span>
                              </>
                            ) : (
                              <>
                                <User className="h-3 w-3 text-zinc-400" />
                                <span>Unassigned</span>
                              </>
                            )}
                          </span>

                          {issue.project_name && (
                            <span className="inline-flex items-center gap-1 truncate">
                              <FolderKanban className="h-3 w-3 text-zinc-400" />
                              <span className="truncate">
                                {issue.project_name}
                              </span>
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Meta + Remove */}
                    <div className="flex shrink-0 items-center gap-2.5">
                      {entry.added_by === "claude" ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/15 dark:text-indigo-300">
                          <Sparkles className="h-2.5 w-2.5" />
                          Claude
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full border border-zinc-200 bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600 dark:border-white/10 dark:bg-white/[0.05] dark:text-zinc-300">
                          You
                        </span>
                      )}

                      <span className="w-16 text-right font-mono text-[10px] text-zinc-500">
                        {timeAgo(entry.updated_at)}
                      </span>

                      <button
                        type="button"
                        aria-label="Remove from backlog"
                        title="Remove from backlog"
                        onClick={(e) => {
                          e.stopPropagation();
                          void onRemove(entry.issue_id);
                        }}
                        className="rounded-md p-1 text-zinc-400 transition hover:bg-rose-50 hover:text-rose-600 dark:text-zinc-500 dark:hover:bg-rose-500/15 dark:hover:text-rose-300"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
