import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  FolderKanban,
  GripVertical,
  Hammer,
  History,
  ListOrdered,
  Loader2,
  Play,
  RotateCcw,
  Sparkles,
  Trash2,
  User,
  X,
  XCircle,
} from "lucide-react";
import type {
  BacklogEntry,
  BacklogGroup,
  BacklogTheme,
  BridgeStatus,
  DevSessionView,
  IssueDependency,
  LauncherStatus,
  LinearIssue,
  RerankRun,
} from "../types";
import { AuthorAvatar, PriorityIcon, StateIcon } from "./Icons";
import { DevSessionsPanel } from "./DevSessionsPanel";
import { DarkSelect, type DarkSelectOption } from "./DarkSelect";

const GROUP_COLOR_VARS = [1, 2, 3, 4, 5, 6, 7, 8].map(
  (n) => `var(--viz-series-${n})`
);
const GROUP_FALLBACK_GRAY = "var(--viz-label)";

const DEV_MODEL_OPTIONS: DarkSelectOption[] = [
  { value: "opus", label: "Opus" },
  { value: "sonnet", label: "Sonnet" },
  { value: "fable", label: "Fable" },
  { value: "", label: "Server default" },
];

const DEV_EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;

interface BacklogViewProps {
  backlog: BacklogEntry[];
  backlogGroups: BacklogGroup[];
  backlogThemes: BacklogTheme[];
  backlogDependencies: IssueDependency[];
  issues: LinearIssue[];
  onReorder: (issueIds: string[]) => Promise<void> | void;
  onRemove: (issueId: string) => Promise<void> | void;
  onClearDone: () => Promise<void> | void;
  onConfirmDependency: (
    issueId: string,
    blockerId: string
  ) => Promise<void> | void;
  onDismissDependency: (
    issueId: string,
    blockerId: string
  ) => Promise<void> | void;
  onSelectIdentifier: (identifier: string) => void;
  timeAgo: (iso: string) => string;
  bridgeStatus: BridgeStatus | null;
  rerankRuns: RerankRun[];
  onStartRerank: (comment: string) => Promise<void> | void;
  devSessions: DevSessionView[];
  devDefaults: { model: string; effort: string };
  launcherStatus: LauncherStatus | null;
  devLaunchMode: string;
  onStartDevSession: (
    issueIds: string[],
    name: string,
    note: string,
    delivery: string,
    model: string,
    effort: string
  ) => Promise<void> | void;
  onAddToDevSession: (
    sessionId: string,
    issueIds: string[]
  ) => Promise<void> | void;
  onRemoveFromDevSession: (
    sessionId: string,
    issueId: string
  ) => Promise<void> | void;
  onStopDevSession: (id: string) => Promise<void> | void;
  onRefreshDevSessions: () => Promise<void> | void;
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
  backlogGroups,
  backlogThemes,
  backlogDependencies,
  issues,
  onReorder,
  onRemove,
  onClearDone,
  onConfirmDependency,
  onDismissDependency,
  onSelectIdentifier,
  timeAgo,
  bridgeStatus,
  rerankRuns,
  onStartRerank,
  devSessions,
  devDefaults,
  launcherStatus,
  devLaunchMode,
  onStartDevSession,
  onAddToDevSession,
  onRemoveFromDevSession,
  onStopDevSession,
  onRefreshDevSessions,
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

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [devModalIssueIds, setDevModalIssueIds] = useState<string[] | null>(
    null
  );
  const [devName, setDevName] = useState("");
  const [devNote, setDevNote] = useState("");
  const [devDelivery, setDevDelivery] = useState<"per_issue" | "combined">(
    "per_issue"
  );
  const [devModel, setDevModel] = useState(devDefaults.model);
  const [devEffort, setDevEffort] = useState(devDefaults.effort);
  const [startingDev, setStartingDev] = useState(false);
  const [confirmingDepKey, setConfirmingDepKey] = useState<string | null>(null);

  const popoverRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const devNameInputRef = useRef<HTMLInputElement>(null);

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
    const validIds = new Set(backlog.map((b) => b.issue_id));
    setSelectedIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (validIds.has(id)) {
          next.add(id);
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [backlog]);

  const issueById = useMemo(() => {
    const map = new Map<string, LinearIssue>();
    for (const issue of issues) {
      map.set(issue.id, issue);
    }
    return map;
  }, [issues]);

  const blockersByIssueId = useMemo(() => {
    const map = new Map<string, IssueDependency[]>();
    for (const dep of backlogDependencies) {
      const list = map.get(dep.issue_id) ?? [];
      list.push(dep);
      map.set(dep.issue_id, list);
    }
    return map;
  }, [backlogDependencies]);

  const devModalBlockingWarnings = useMemo(() => {
    if (!devModalIssueIds || devModalIssueIds.length === 0) return [];
    const selectedSet = new Set(devModalIssueIds);
    const warnings: Array<{ key: string; text: string }> = [];
    for (const issueId of devModalIssueIds) {
      const issueIdent = issueById.get(issueId)?.identifier ?? issueId;
      const deps = blockersByIssueId.get(issueId) ?? [];
      for (const dep of deps) {
        if (!dep.blocker_open) continue;
        if (selectedSet.has(dep.blocker_id)) continue;
        const blockerCached = issueById.get(dep.blocker_id);
        if (
          blockerCached &&
          isCompletedOrCanceled(blockerCached.state_type) !== null
        ) {
          continue;
        }
        const blockerIdent =
          dep.blocker_identifier ||
          blockerCached?.identifier ||
          dep.blocker_id;
        warnings.push({
          key: `${issueId}:${dep.blocker_id}`,
          text: `${issueIdent} is blocked by ${blockerIdent}`,
        });
      }
    }
    return warnings;
  }, [devModalIssueIds, issueById, blockersByIssueId]);

  const activeSessionByIssueId = useMemo(() => {
    const map = new Map<
      string,
      { sessionId: string; sessionName: string; itemStatus: string }
    >();
    for (const view of devSessions) {
      if (
        view.session.status !== "starting" &&
        view.session.status !== "running"
      ) {
        continue;
      }
      for (const item of view.items) {
        if (item.status === "removed" || item.status === "done") continue;
        if (!map.has(item.issue_id)) {
          map.set(item.issue_id, {
            sessionId: view.session.id,
            sessionName: view.session.name,
            itemStatus: item.status,
          });
        }
      }
    }
    return map;
  }, [devSessions]);

  const assignableSessions = useMemo(
    () =>
      devSessions.filter(
        (s) =>
          s.session.status === "starting" || s.session.status === "running"
      ),
    [devSessions]
  );

  const groupColorByName = useMemo(() => {
    const map = new Map<string, string>();
    backlogGroups.forEach((g, idx) => {
      const color =
        idx < GROUP_COLOR_VARS.length
          ? GROUP_COLOR_VARS[idx]
          : GROUP_FALLBACK_GRAY;
      map.set(g.name, color);
    });
    return map;
  }, [backlogGroups]);

  const visibleGroups = useMemo(() => {
    const membersByGroup = new Map<string, BacklogEntry[]>();
    for (const entry of orderedEntries) {
      if (!entry.group_name) continue;
      const list = membersByGroup.get(entry.group_name) ?? [];
      list.push(entry);
      membersByGroup.set(entry.group_name, list);
    }

    return backlogGroups
      .map((group) => {
        const members = membersByGroup.get(group.name) ?? [];
        const openMemberIds = members
          .filter(
            (m) =>
              isCompletedOrCanceled(issueById.get(m.issue_id)?.state_type) ===
              null
          )
          .map((m) => m.issue_id);
        const activeSessionName =
          members
            .map((m) => activeSessionByIssueId.get(m.issue_id)?.sessionName)
            .find((name): name is string => Boolean(name)) ?? null;
        return {
          group,
          color: groupColorByName.get(group.name) ?? GROUP_FALLBACK_GRAY,
          members,
          openMemberIds,
          activeSessionName,
        };
      })
      .filter((item) => item.members.length > 0);
  }, [
    backlogGroups,
    orderedEntries,
    issueById,
    activeSessionByIssueId,
    groupColorByName,
  ]);

  const visibleGroupByName = useMemo(
    () => new Map(visibleGroups.map((g) => [g.group.name, g])),
    [visibleGroups]
  );

  const themeReasonByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const theme of backlogThemes) {
      map.set(theme.name, theme.reason);
    }
    return map;
  }, [backlogThemes]);

  const themeBlocks = useMemo(() => {
    const blocks: Array<{
      themeName: string | null;
      entries: Array<{ entry: BacklogEntry; idx: number }>;
      openMemberIds: string[];
    }> = [];
    for (let idx = 0; idx < orderedEntries.length; idx += 1) {
      const entry = orderedEntries[idx];
      const themeName = entry.theme_name ?? null;
      const last = blocks[blocks.length - 1];
      if (last && last.themeName === themeName) {
        last.entries.push({ entry, idx });
      } else {
        blocks.push({
          themeName,
          entries: [{ entry, idx }],
          openMemberIds: [],
        });
      }
    }
    for (const block of blocks) {
      if (block.themeName !== null) {
        block.openMemberIds = block.entries
          .filter(
            ({ entry }) =>
              isCompletedOrCanceled(issueById.get(entry.issue_id)?.state_type) ===
              null
          )
          .map(({ entry }) => entry.issue_id);
      }
    }
    return blocks;
  }, [orderedEntries, issueById]);

  const devModelOptions = useMemo(() => {
    if (
      !devModel ||
      DEV_MODEL_OPTIONS.some((opt) => opt.value === devModel)
    ) {
      return DEV_MODEL_OPTIONS;
    }
    return [{ value: devModel, label: devModel }, ...DEV_MODEL_OPTIONS];
  }, [devModel]);

  const orderedSelectedIds = useMemo(
    () =>
      orderedEntries
        .filter((e) => selectedIds.has(e.issue_id))
        .map((e) => e.issue_id),
    [orderedEntries, selectedIds]
  );

  useEffect(() => {
    if (!addMenuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (
        addMenuRef.current &&
        !addMenuRef.current.contains(e.target as Node)
      ) {
        setAddMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [addMenuOpen]);

  useEffect(() => {
    if (!devModalIssueIds) return;
    const focusTimer = window.setTimeout(() => {
      devNameInputRef.current?.focus();
      devNameInputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(focusTimer);
  }, [devModalIssueIds]);

  function openDevModalForIds(ids: string[], nameOverride?: string) {
    if (ids.length === 0) return;
    const idents = ids.map(
      (id) => issueById.get(id)?.identifier ?? id
    );
    const defaultName =
      nameOverride?.trim() ||
      (idents.length <= 3
        ? idents.join(" + ")
        : `${idents[0]} + ${idents[1]} + ${idents.length - 2} more`);
    setDevName(defaultName);
    setDevNote("");
    setDevDelivery("per_issue");
    setDevModel(devDefaults.model);
    setDevEffort(devDefaults.effort);
    setAddMenuOpen(false);
    setDevModalIssueIds(ids);
  }

  function handleSelectGroup(issueIds: string[]) {
    if (issueIds.length === 0) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of issueIds) {
        next.add(id);
      }
      return next;
    });
  }

  async function handleStartDevSubmit() {
    if (!devModalIssueIds || devModalIssueIds.length === 0 || startingDev) {
      return;
    }
    setStartingDev(true);
    try {
      await onStartDevSession(
        devModalIssueIds,
        devName,
        devNote,
        devDelivery,
        devModel,
        devEffort
      );
      setDevModalIssueIds(null);
      setDevNote("");
      setSelectedIds(new Set());
    } catch {
      // Error surfaced via parent banner; keep popover open.
    } finally {
      setStartingDev(false);
    }
  }

  async function handleAddToExistingSession(sessionId: string) {
    if (orderedSelectedIds.length === 0) return;
    setAddMenuOpen(false);
    try {
      await onAddToDevSession(sessionId, orderedSelectedIds);
      setSelectedIds(new Set());
    } catch {
      // Error surfaced via parent banner.
    }
  }

  function toggleRowSelection(issueId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(issueId)) {
        next.delete(issueId);
      } else {
        next.add(issueId);
      }
      return next;
    });
  }

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

          {/* Dev Sessions Panel */}
          <DevSessionsPanel
            devSessions={devSessions}
            launcherStatus={launcherStatus}
            devLaunchMode={devLaunchMode}
            onRefresh={onRefreshDevSessions}
            onStop={onStopDevSession}
            onRemoveItem={onRemoveFromDevSession}
            onSelectIdentifier={onSelectIdentifier}
            timeAgo={timeAgo}
          />

          {/* Selection Action Bar */}
          {selectedIds.size > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-indigo-200 bg-indigo-50/70 px-3.5 py-2.5 dark:border-indigo-500/30 dark:bg-indigo-500/10">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => openDevModalForIds(orderedSelectedIds)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm shadow-indigo-950/30 transition hover:bg-indigo-500"
                >
                  <Hammer className="h-3.5 w-3.5" />
                  <span>Start developing ({selectedIds.size})</span>
                </button>

                <div className="relative" ref={addMenuRef}>
                  <button
                    type="button"
                    disabled={assignableSessions.length === 0}
                    onClick={() => setAddMenuOpen((v) => !v)}
                    className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:border-indigo-400 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-45 dark:border-white/10 dark:bg-[#141720] dark:text-zinc-200 dark:hover:border-indigo-500/40 dark:hover:text-white"
                  >
                    <span>Add to session ▾</span>
                  </button>

                  {addMenuOpen && assignableSessions.length > 0 && (
                    <div className="absolute left-0 top-full z-30 mt-1.5 w-72 rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl dark:border-white/12 dark:bg-[#121620] dark:shadow-black/60">
                      {assignableSessions.map(({ session }) => (
                        <button
                          key={session.id}
                          type="button"
                          onClick={() =>
                            void handleAddToExistingSession(session.id)
                          }
                          className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-800 transition hover:bg-indigo-50 dark:text-zinc-200 dark:hover:bg-white/[0.06]"
                        >
                          <span className="truncate font-medium">
                            {session.name}
                          </span>
                          <span className="shrink-0 font-mono text-[10px] text-zinc-500 dark:text-zinc-400">
                            {session.status}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setSelectedIds(new Set())}
                  className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-600 transition hover:bg-zinc-200/60 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-white/10 dark:hover:text-white"
                >
                  Clear
                </button>
              </div>
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
              {(() => {
                const renderEntry = (
                  entry: BacklogEntry,
                  idx: number,
                  inThemeRun: boolean,
                  isFirstInThemeBlock: boolean
                ) => {
                  const issue = issueById.get(entry.issue_id);
                  const closedKind = isCompletedOrCanceled(issue?.state_type);
                  const rowBlockers =
                    blockersByIssueId.get(entry.issue_id) ?? [];
                  const hasOpenBlocker = rowBlockers.some(
                    (d) => d.blocker_open
                  );
                  const activeDev = activeSessionByIssueId.get(entry.issue_id);
                  const isSelected = selectedIds.has(entry.issue_id);
                  const isDragging = draggingId === entry.issue_id;
                  const isDropAbove =
                    dropTarget?.id === entry.issue_id &&
                    dropTarget.edge === "above";
                  const isDropBelow =
                    dropTarget?.id === entry.issue_id &&
                    dropTarget.edge === "below";

                  const groupName = entry.group_name ?? null;
                  const prevGroup =
                    idx > 0
                      ? orderedEntries[idx - 1].group_name ?? null
                      : null;
                  const nextGroup =
                    idx < orderedEntries.length - 1
                      ? orderedEntries[idx + 1].group_name ?? null
                      : null;
                  const startsGroupRun =
                    groupName !== null && groupName !== prevGroup;
                  const inGroupRun =
                    groupName !== null &&
                    (groupName === prevGroup || groupName === nextGroup);
                  const groupInfo = startsGroupRun
                    ? visibleGroupByName.get(groupName) ?? null
                    : null;
                  const groupColor = groupName
                    ? groupColorByName.get(groupName) ?? GROUP_FALLBACK_GRAY
                    : null;

                  return (
                    <Fragment key={entry.issue_id}>
                      {startsGroupRun && groupInfo && (
                        <div
                          className={`flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-1.5 ${
                            idx > 0 && !isFirstInThemeBlock ? "mt-3" : ""
                          }`}
                          style={{
                            borderLeft: `3px solid ${groupColor}`,
                            backgroundColor: `color-mix(in srgb, ${groupColor} 8%, transparent)`,
                          }}
                        >
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <span className="truncate text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                              {groupInfo.group.name}
                            </span>
                            <span className="shrink-0 rounded bg-white/70 px-1.5 py-0.5 font-mono text-[10px] text-zinc-600 dark:bg-white/[0.06] dark:text-zinc-300">
                              {groupInfo.members.length} together
                            </span>
                            {groupInfo.group.reason && (
                              <span
                                title={groupInfo.group.reason}
                                className="min-w-0 truncate text-[11px] text-zinc-600 dark:text-zinc-400"
                              >
                                {groupInfo.group.reason}
                              </span>
                            )}
                            {groupInfo.activeSessionName && (
                              <span className="shrink-0 rounded-full border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/15 dark:text-indigo-300">
                                In {groupInfo.activeSessionName}
                              </span>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5">
                            <button
                              type="button"
                              disabled={groupInfo.openMemberIds.length === 0}
                              onClick={() =>
                                handleSelectGroup(groupInfo.openMemberIds)
                              }
                              className="rounded-md border border-zinc-200 bg-white px-2 py-0.5 text-[11px] font-medium text-zinc-700 transition hover:border-indigo-400 disabled:cursor-not-allowed disabled:opacity-45 dark:border-white/10 dark:bg-[#151923] dark:text-zinc-200"
                            >
                              Select
                            </button>
                            <button
                              type="button"
                              disabled={groupInfo.openMemberIds.length === 0}
                              onClick={() =>
                                openDevModalForIds(
                                  groupInfo.openMemberIds,
                                  groupInfo.group.name
                                )
                              }
                              className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-2 py-0.5 text-[11px] font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-45"
                            >
                              <Hammer className="h-3 w-3" />
                              Start session
                            </button>
                          </div>
                        </div>
                      )}
                      <div
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
                          if (!draggingId || draggingId === entry.issue_id)
                            return;
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
                          if (
                            !e.currentTarget.contains(e.relatedTarget as Node)
                          ) {
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
                        style={
                          inGroupRun && groupColor
                            ? { borderLeft: `3px solid ${groupColor}` }
                            : undefined
                        }
                        className={`group relative flex items-center gap-3 rounded-xl border px-3.5 py-3 transition ${
                          issue?.identifier
                            ? "cursor-pointer"
                            : "cursor-default"
                        } ${
                          isDragging
                            ? "border-indigo-400 bg-indigo-50/50 opacity-50 dark:border-indigo-500/50 dark:bg-indigo-500/10"
                            : "border-zinc-200 bg-white hover:border-indigo-300 hover:bg-zinc-50/80 dark:border-white/8 dark:bg-[#10131B] dark:hover:border-indigo-500/40 dark:hover:bg-[#141824]"
                        } ${
                          closedKind
                            ? "opacity-60"
                            : hasOpenBlocker
                            ? "opacity-75"
                            : ""
                        }`}
                      >
                        {isDropAbove && (
                          <div className="pointer-events-none absolute -top-1 left-2 right-2 h-0.5 rounded-full bg-indigo-500" />
                        )}
                        {isDropBelow && (
                          <div className="pointer-events-none absolute -bottom-1 left-2 right-2 h-0.5 rounded-full bg-indigo-500" />
                        )}

                        {/* Selection Checkbox + Drag Handle + Keyboard Move Buttons */}
                        <div
                          className="flex shrink-0 items-center gap-0.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            aria-label={`Select ${
                              issue?.identifier ?? entry.issue_id
                            }`}
                            onChange={() => toggleRowSelection(entry.issue_id)}
                            className="mr-1 h-3.5 w-3.5 cursor-pointer rounded border-zinc-400 bg-white accent-indigo-600 dark:border-zinc-600 dark:bg-zinc-900 dark:accent-indigo-500"
                          />
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
                            {activeDev && (
                              <span
                                title={`${activeDev.sessionName} (${activeDev.itemStatus})`}
                                className="inline-flex items-center gap-1 rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/15 dark:text-indigo-300"
                              >
                                <Hammer className="h-3 w-3 shrink-0" />
                                <span className="max-w-[140px] truncate">
                                  {activeDev.sessionName}
                                </span>
                                {activeDev.itemStatus !== "queued" && (
                                  <span className="font-mono text-[9px] opacity-80">
                                    · {activeDev.itemStatus}
                                  </span>
                                )}
                              </span>
                            )}
                            {entry.group_name && !inGroupRun && (
                              <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[10px] font-medium text-zinc-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-300">
                                <span
                                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                                  style={{
                                    backgroundColor:
                                      groupColorByName.get(entry.group_name) ??
                                      GROUP_FALLBACK_GRAY,
                                  }}
                                />
                                <span className="max-w-[140px] truncate">
                                  {entry.group_name}
                                </span>
                              </span>
                            )}
                            {entry.theme_name && !inThemeRun && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[10px] font-medium text-zinc-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-400">
                                <span className="max-w-[140px] truncate">
                                  {entry.theme_name}
                                </span>
                              </span>
                            )}
                          </div>

                          {entry.note && (
                            <p className="line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">
                              {entry.note}
                            </p>
                          )}

                          {(issue || rowBlockers.length > 0) && (
                            <div className="flex flex-wrap items-center gap-3 pt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                              {issue && (
                                <>
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
                                </>
                              )}

                              {rowBlockers.map((dep) => {
                                const isSuggested = dep.source === "suggested";
                                const isOpen = dep.blocker_open;
                                const depKey = `${entry.issue_id}:${dep.blocker_id}`;
                                const isConfirming = confirmingDepKey === depKey;
                                const ident =
                                  dep.blocker_identifier || dep.blocker_id;
                                const chipColors = isOpen
                                  ? "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
                                  : "border-zinc-200 bg-zinc-100 text-zinc-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-400";
                                const tooltip = isSuggested
                                  ? dep.reason || dep.blocker_title || undefined
                                  : dep.blocker_title
                                  ? `${dep.blocker_title}${
                                      dep.blocker_state_name
                                        ? ` (${dep.blocker_state_name})`
                                        : ""
                                    }`
                                  : undefined;

                                return (
                                  <span
                                    key={dep.blocker_id}
                                    title={tooltip}
                                    onClick={(e) => e.stopPropagation()}
                                    className={`group/dep inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                                      isSuggested ? "border-dashed" : ""
                                    } ${chipColors}`}
                                  >
                                    <span>Blocked by</span>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        if (dep.blocker_identifier) {
                                          onSelectIdentifier(
                                            dep.blocker_identifier
                                          );
                                        }
                                      }}
                                      className={`font-mono font-semibold hover:underline ${
                                        !isOpen ? "line-through" : ""
                                      }`}
                                    >
                                      {ident}
                                    </button>
                                    {isSuggested && (
                                      <>
                                        <span className="opacity-75">
                                          suggested
                                        </span>
                                        <span className="hidden items-center gap-1 pl-0.5 group-hover/dep:inline-flex group-focus-within/dep:inline-flex">
                                          <button
                                            type="button"
                                            disabled={isConfirming}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              setConfirmingDepKey(depKey);
                                              Promise.resolve(
                                                onConfirmDependency(
                                                  entry.issue_id,
                                                  dep.blocker_id
                                                )
                                              ).finally(() => {
                                                setConfirmingDepKey((cur) =>
                                                  cur === depKey ? null : cur
                                                );
                                              });
                                            }}
                                            className="rounded border border-current/25 bg-white/70 px-1.5 py-0 text-[9px] font-semibold transition hover:bg-white disabled:opacity-50 dark:bg-black/25 dark:hover:bg-black/40"
                                          >
                                            {isConfirming
                                              ? "Adding…"
                                              : "Add to Linear"}
                                          </button>
                                          <button
                                            type="button"
                                            aria-label={`Dismiss suggested blocker ${ident}`}
                                            title="Dismiss suggestion"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              void onDismissDependency(
                                                entry.issue_id,
                                                dep.blocker_id
                                              );
                                            }}
                                            className="rounded px-1 text-[11px] leading-none opacity-75 transition hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10"
                                          >
                                            ×
                                          </button>
                                        </span>
                                      </>
                                    )}
                                  </span>
                                );
                              })}
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
                            aria-label="Start developing"
                            title="Start developing"
                            onClick={(e) => {
                              e.stopPropagation();
                              openDevModalForIds([entry.issue_id]);
                            }}
                            className="rounded-md p-1 text-zinc-400 transition hover:bg-indigo-50 hover:text-indigo-600 dark:text-zinc-500 dark:hover:bg-indigo-500/15 dark:hover:text-indigo-300"
                          >
                            <Play className="h-3.5 w-3.5" />
                          </button>

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
                    </Fragment>
                  );
                };

                return themeBlocks.map((block, blockIdx) => {
                  const inThemeRun =
                    block.themeName !== null && block.entries.length >= 2;
                  const themeReason =
                    block.themeName !== null
                      ? themeReasonByName.get(block.themeName) ?? ""
                      : "";
                  const rows = block.entries.map(({ entry, idx }, posInBlock) =>
                    renderEntry(
                      entry,
                      idx,
                      inThemeRun,
                      block.themeName !== null && posInBlock === 0
                    )
                  );

                  if (block.themeName === null || !inThemeRun) {
                    return (
                      <Fragment
                        key={`plain-${block.entries[0].entry.issue_id}`}
                      >
                        {rows}
                      </Fragment>
                    );
                  }

                  return (
                    <Fragment
                      key={`theme-${block.themeName}-${block.entries[0].entry.issue_id}`}
                    >
                      <div
                        className={`flex flex-wrap items-center justify-between gap-2 px-1 py-1 ${
                          blockIdx > 0 ? "mt-3" : ""
                        }`}
                      >
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <span className="shrink-0 text-[10px] font-medium uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                            Theme
                          </span>
                          <span className="truncate text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                            {block.themeName}
                          </span>
                          <span className="shrink-0 font-mono text-[10px] text-zinc-500 dark:text-zinc-400">
                            {block.entries.length}{" "}
                            {block.entries.length === 1 ? "ticket" : "tickets"}
                          </span>
                          {themeReason && (
                            <span
                              title={themeReason}
                              className="min-w-0 truncate text-[11px] text-zinc-500 dark:text-zinc-400"
                            >
                              {themeReason}
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          disabled={block.openMemberIds.length === 0}
                          onClick={() => handleSelectGroup(block.openMemberIds)}
                          className="shrink-0 rounded-md border border-zinc-200 bg-white px-2 py-0.5 text-[11px] font-medium text-zinc-700 transition hover:border-indigo-400 disabled:cursor-not-allowed disabled:opacity-45 dark:border-white/10 dark:bg-[#151923] dark:text-zinc-200"
                        >
                          Select
                        </button>
                      </div>
                      {inThemeRun ? (
                        <div className="space-y-2 border-l border-zinc-200 pl-3 dark:border-white/10">
                          {rows}
                        </div>
                      ) : (
                        rows
                      )}
                    </Fragment>
                  );
                });
              })()}
            </div>
          )}
        </div>
      </main>

      {devModalIssueIds && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !startingDev) {
              setDevModalIssueIds(null);
            }
          }}
        >
          <div
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                void handleStartDevSubmit();
              } else if (e.key === "Escape" && !startingDev) {
                e.preventDefault();
                setDevModalIssueIds(null);
              }
            }}
            className="w-full max-w-md space-y-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-2xl dark:border-white/12 dark:bg-[#121620] dark:shadow-black/70"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Hammer className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                  Start developing ({devModalIssueIds.length})
                </span>
              </div>
              <button
                type="button"
                disabled={startingDev}
                onClick={() => setDevModalIssueIds(null)}
                className="rounded p-0.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                Session name
              </label>
              <input
                ref={devNameInputRef}
                type="text"
                value={devName}
                onChange={(e) => setDevName(e.target.value)}
                className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-xs text-zinc-900 focus:border-indigo-500 focus:outline-none dark:border-white/10 dark:bg-[#090B10] dark:text-zinc-100"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                Note
              </label>
              <textarea
                rows={3}
                value={devNote}
                onChange={(e) => setDevNote(e.target.value)}
                placeholder="Anything Claude should know? (optional)"
                className="w-full resize-none rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-2 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-white/10 dark:bg-[#090B10] dark:text-zinc-100 dark:placeholder:text-zinc-500"
              />
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                  Model
                </label>
                <DarkSelect
                  value={devModel}
                  options={devModelOptions}
                  onChange={setDevModel}
                  fullWidth
                  compact
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                  Effort
                </label>
                <div className="grid grid-cols-5 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 dark:border-white/10 dark:bg-[#090B10]">
                  {DEV_EFFORT_LEVELS.map((level) => {
                    const active = devEffort === level;
                    return (
                      <button
                        key={level}
                        type="button"
                        onClick={() => setDevEffort(level)}
                        className={`py-1 text-center text-[10px] font-medium transition ${
                          active
                            ? "bg-indigo-600 text-white"
                            : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-white/[0.06]"
                        }`}
                      >
                        {level}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">
                Delivery
              </div>
              <div className="flex items-center gap-4 text-xs text-zinc-800 dark:text-zinc-200">
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="radio"
                    name="dev-delivery"
                    value="per_issue"
                    checked={devDelivery === "per_issue"}
                    onChange={() => setDevDelivery("per_issue")}
                    className="accent-indigo-600 dark:accent-indigo-500"
                  />
                  One PR per issue
                </label>
                <label className="flex cursor-pointer items-center gap-1.5">
                  <input
                    type="radio"
                    name="dev-delivery"
                    value="combined"
                    checked={devDelivery === "combined"}
                    onChange={() => setDevDelivery("combined")}
                    className="accent-indigo-600 dark:accent-indigo-500"
                  />
                  One combined PR
                </label>
              </div>
            </div>

            {devLaunchMode !== "ssh" && launcherStatus !== null && (
              <p
                className={`text-[11px] ${
                  launcherStatus.online
                    ? "text-emerald-700 dark:text-emerald-400"
                    : "text-amber-700 dark:text-amber-400"
                }`}
              >
                {launcherStatus.online
                  ? "Starts in Claude with full tools (GitHub, sub-sessions)."
                  : "Launcher offline: starts from the command line, without GitHub tools."}
              </p>
            )}

            {devModalBlockingWarnings.length > 0 && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/12 dark:text-amber-200">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                  <div className="space-y-0.5">
                    {devModalBlockingWarnings.map((w) => (
                      <div key={w.key} className="font-mono text-[11px]">
                        {w.text}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between pt-1">
              <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
                Cmd/Ctrl + Enter to start
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={startingDev}
                  onClick={() => setDevModalIssueIds(null)}
                  className="rounded-md border border-zinc-200 px-2.5 py-1 text-[11px] font-medium text-zinc-600 hover:bg-zinc-100 dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/5"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={startingDev}
                  onClick={() => void handleStartDevSubmit()}
                  className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-3 py-1 text-[11px] font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
                >
                  <Hammer className="h-3 w-3" />
                  {startingDev ? "Starting..." : "Start"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
