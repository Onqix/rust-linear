import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Columns3,
  Eye,
  EyeOff,
  FolderKanban,
  GripVertical,
  MessageSquare,
  RotateCcw,
} from "lucide-react";
import type {
  BoardColumnConfig,
  LinearIssue,
  WorkspaceMetadata,
} from "../types";
import {
  applyBoardColumnConfig,
  getCanonicalBoardColumnSpecs,
  moveBoardColumnToTarget,
  normalizeColumnId,
  toggleHiddenBoardColumn,
  type CanonicalColumnSpec,
} from "../lib/viewFilters";
import {
  AuthorAvatar,
  IssueLabelBadge,
  PriorityIcon,
  StateIcon,
  buildLabelLookup,
  resolveIssueLabels,
} from "./Icons";
import { BoardColumnsChecklist } from "./FilterPickerControls";

interface KanbanBoardProps {
  issues: LinearIssue[];
  meta: WorkspaceMetadata;
  teamFilter: string;
  boardConfig: BoardColumnConfig;
  onChangeBoardConfig: (next: BoardColumnConfig) => void;
  selectedId: string | null;
  onSelectIssue: (issue: LinearIssue) => void;
  onMoveIssueState: (issue: LinearIssue, targetStateId: string) => Promise<void>;
  timeAgo: (iso: string) => string;
}

interface BoardColumn extends CanonicalColumnSpec {
  issues: LinearIssue[];
}

export function KanbanBoard({
  issues,
  meta,
  teamFilter,
  boardConfig,
  onChangeBoardConfig,
  selectedId,
  onSelectIssue,
  onMoveIssueState,
  timeAgo,
}: KanbanBoardProps) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [draggedColId, setDraggedColId] = useState<string | null>(null);
  const [dragOverColId, setDragOverColId] = useState<string | null>(null);
  const [columnLimits, setColumnLimits] = useState<Record<string, number>>({});
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false);

  const columnsMenuRef = useRef<HTMLDivElement>(null);
  const labelLookup = useMemo(
    () => buildLabelLookup(meta.labels),
    [meta.labels]
  );

  useEffect(() => {
    if (!columnsMenuOpen) return;
    function onMouseDown(e: MouseEvent) {
      if (
        columnsMenuRef.current &&
        !columnsMenuRef.current.contains(e.target as Node)
      ) {
        setColumnsMenuOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setColumnsMenuOpen(false);
      }
    }
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [columnsMenuOpen]);

  const singleTeam = useMemo(() => {
    if (teamFilter !== "ALL") {
      return meta.teams.find((t) => t.key === teamFilter) ?? null;
    }
    if (meta.teams.length === 1) {
      return meta.teams[0];
    }
    return null;
  }, [meta.teams, teamFilter]);

  const { orderedAll, visibleColumns, hiddenSet, issueCountsByNormId } =
    useMemo(() => {
      const specs = getCanonicalBoardColumnSpecs(meta, teamFilter);
      const rawColumns: BoardColumn[] = specs.map((spec) => {
        const colIssues = issues.filter((i) => {
          if (spec.directStateId) {
            return (
              i.state_id === spec.directStateId ||
              (singleTeam &&
                i.team_key === singleTeam.key &&
                normalizeColumnId(i.state_name) === spec.normId)
            );
          }
          const t = i.state_type.toLowerCase();
          if (spec.key === "backlog") return t === "backlog" || t === "triage";
          return t === spec.key;
        });
        return { ...spec, issues: colIssues };
      });

      const applied = applyBoardColumnConfig(rawColumns, boardConfig);
      const countsMap = new Map<string, number>();
      for (const c of applied.orderedAll) {
        countsMap.set(c.normId, c.issues.length);
      }

      return {
        orderedAll: applied.orderedAll,
        visibleColumns: applied.visible,
        hiddenSet: applied.hiddenSet,
        issueCountsByNormId: countsMap,
      };
    }, [issues, meta, teamFilter, singleTeam, boardConfig]);

  const orderedIds = useMemo(
    () => orderedAll.map((c) => c.normId),
    [orderedAll]
  );

  function resolveTargetStateId(
    issue: LinearIssue,
    col: BoardColumn
  ): string | null {
    if (col.directStateId) return col.directStateId;
    const team = meta.teams.find(
      (t) => t.id === issue.team_id || t.key === issue.team_key
    );
    if (!team) return null;
    const match =
      team.states.find((s) => s.state_type.toLowerCase() === col.stateType) ??
      team.states.find((s) => s.name.toLowerCase() === col.label.toLowerCase());
    return match?.id ?? null;
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-[#F4F5F7] dark:bg-[#090B10]">
      {/* Board Columns Toolbar */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-200 bg-white px-4 py-2 dark:border-white/8 dark:bg-[#0B0D13]">
        <div className="flex items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
          <span>
            Showing{" "}
            <strong className="text-zinc-900 dark:text-zinc-200">
              {visibleColumns.length}
            </strong>{" "}
            of {orderedAll.length} columns
          </span>
          {hiddenSet.size > 0 && (
            <button
              type="button"
              onClick={() =>
                onChangeBoardConfig({ ...boardConfig, hiddenColumns: [] })
              }
              className="inline-flex items-center gap-1 rounded border border-indigo-200 bg-indigo-50 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 transition hover:bg-indigo-100 dark:border-indigo-500/30 dark:bg-indigo-500/12 dark:text-indigo-300 dark:hover:bg-indigo-500/20"
            >
              <Eye className="h-2.5 w-2.5" />
              Show {hiddenSet.size} hidden
            </button>
          )}
          {boardConfig.columnOrder.length > 0 && (
            <button
              type="button"
              onClick={() =>
                onChangeBoardConfig({ ...boardConfig, columnOrder: [] })
              }
              title="Reset columns to default Backlog-first order"
              className="inline-flex items-center gap-1 rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 transition hover:text-zinc-900 dark:border-white/10 dark:bg-white/[0.03] dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              <RotateCcw className="h-2.5 w-2.5" />
              Reset order
            </button>
          )}
        </div>

        <div ref={columnsMenuRef} className="relative">
          <button
            type="button"
            onClick={() => setColumnsMenuOpen((p) => !p)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium transition ${
              columnsMenuOpen
                ? "border-indigo-400 bg-indigo-50 text-indigo-700 dark:border-indigo-500/50 dark:bg-indigo-500/15 dark:text-indigo-200"
                : "border-zinc-200 bg-zinc-50 text-zinc-700 hover:border-indigo-400 hover:text-zinc-900 dark:border-white/10 dark:bg-[#141720] dark:text-zinc-300 dark:hover:border-indigo-500/40 dark:hover:text-white"
            }`}
          >
            <Columns3 className="h-3 w-3 text-indigo-600 dark:text-indigo-400" />
            <span>
              Columns ({visibleColumns.length}/{orderedAll.length})
            </span>
          </button>

          {columnsMenuOpen && (
            <div className="absolute right-0 z-50 mt-1.5 w-80 overflow-hidden rounded-xl border border-zinc-200 bg-white p-1.5 shadow-xl shadow-black/15 dark:border-white/12 dark:bg-[#11141E] dark:shadow-2xl dark:shadow-black/90">
              <BoardColumnsChecklist
                orderedColumns={orderedAll}
                hiddenSet={hiddenSet}
                boardConfig={boardConfig}
                issueCountsByNormId={issueCountsByNormId}
                onChangeBoardConfig={onChangeBoardConfig}
              />
            </div>
          )}
        </div>
      </div>

      {/* Board Columns */}
      {visibleColumns.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-xs text-zinc-500">
          <p>All board columns are currently hidden.</p>
          <button
            type="button"
            onClick={() =>
              onChangeBoardConfig({ ...boardConfig, hiddenColumns: [] })
            }
            className="rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 dark:border-indigo-500/40 dark:bg-indigo-500/15 dark:text-indigo-200 dark:hover:bg-indigo-500/25"
          >
            Show all columns
          </button>
        </div>
      ) : (
        <div className="flex flex-1 gap-3 overflow-x-auto p-4">
          {visibleColumns.map((col, visibleIdx) => {
            const limit = columnLimits[col.key] ?? 60;
            const visible = col.issues.slice(0, limit);
            const remaining = col.issues.length - visible.length;
            const isCardDragOver = dragOverKey === col.key;
            const isColDragOver =
              dragOverColId === col.normId && draggedColId !== col.normId;

            return (
              <div
                key={col.key}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (draggedColId) {
                    if (dragOverColId !== col.normId) {
                      setDragOverColId(col.normId);
                    }
                    return;
                  }
                  if (draggedId && dragOverKey !== col.key) {
                    setDragOverKey(col.key);
                  }
                }}
                onDragLeave={() => {
                  if (dragOverKey === col.key) setDragOverKey(null);
                  if (dragOverColId === col.normId) setDragOverColId(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOverKey(null);
                  setDragOverColId(null);

                  if (draggedColId) {
                    const sourceCol = draggedColId;
                    setDraggedColId(null);
                    if (sourceCol !== col.normId) {
                      onChangeBoardConfig(
                        moveBoardColumnToTarget(
                          orderedIds,
                          boardConfig,
                          sourceCol,
                          col.normId
                        )
                      );
                    }
                    return;
                  }

                  const issueId =
                    e.dataTransfer.getData("text/plain") || draggedId;
                  setDraggedId(null);
                  if (!issueId) return;
                  const dragged = issues.find((i) => i.id === issueId);
                  if (!dragged) return;
                  const targetStateId = resolveTargetStateId(dragged, col);
                  if (!targetStateId || targetStateId === dragged.state_id) {
                    return;
                  }
                  void onMoveIssueState(dragged, targetStateId);
                }}
                className={`flex w-76 shrink-0 flex-col rounded-xl border transition ${
                  isColDragOver
                    ? "border-emerald-400 bg-emerald-50/70 dark:border-emerald-400/70 dark:bg-emerald-500/[0.06]"
                    : isCardDragOver
                    ? "border-indigo-400 bg-indigo-50/70 dark:border-indigo-500/60 dark:bg-indigo-500/[0.06]"
                    : "border-zinc-200 bg-zinc-100/80 dark:border-white/8 dark:bg-[#0C0F16]"
                }`}
              >
                {/* Column Header (drag or use arrows/hide) */}
                <div
                  draggable
                  onDragStart={(e) => {
                    e.stopPropagation();
                    setDraggedId(null);
                    setDraggedColId(col.normId);
                    e.dataTransfer.setData(
                      "application/x-column-id",
                      col.normId
                    );
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={() => {
                    setDraggedColId(null);
                    setDragOverColId(null);
                  }}
                  title="Drag column header or use arrows to reorder"
                  className="group flex shrink-0 cursor-grab items-center justify-between gap-1 border-b border-zinc-200 px-3 py-2.5 active:cursor-grabbing dark:border-white/8"
                >
                  <div className="flex min-w-0 items-center gap-1.5">
                    <GripVertical className="h-3 w-3 shrink-0 text-zinc-400 opacity-0 transition group-hover:opacity-100 dark:text-zinc-600" />
                    <StateIcon
                      stateType={col.stateType}
                      color={col.color}
                      className="h-3.5 w-3.5 shrink-0"
                    />
                    <span className="truncate text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                      {col.label}
                    </span>
                  </div>

                  <div className="flex shrink-0 items-center gap-0.5">
                    <div className="mr-1 hidden items-center gap-0.5 group-hover:flex">
                      <button
                        type="button"
                        disabled={visibleIdx === 0}
                        onClick={(e) => {
                          e.stopPropagation();
                          const prevCol = visibleColumns[visibleIdx - 1];
                          if (!prevCol) return;
                          onChangeBoardConfig(
                            moveBoardColumnToTarget(
                              orderedIds,
                              boardConfig,
                              col.normId,
                              prevCol.normId
                            )
                          );
                        }}
                        title="Move column left"
                        className="rounded p-0.5 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 disabled:opacity-25 dark:hover:bg-white/10 dark:hover:text-zinc-200"
                      >
                        <ArrowLeft className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        disabled={visibleIdx === visibleColumns.length - 1}
                        onClick={(e) => {
                          e.stopPropagation();
                          const nextCol = visibleColumns[visibleIdx + 1];
                          if (!nextCol) return;
                          onChangeBoardConfig(
                            moveBoardColumnToTarget(
                              orderedIds,
                              boardConfig,
                              col.normId,
                              nextCol.normId
                            )
                          );
                        }}
                        title="Move column right"
                        className="rounded p-0.5 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 disabled:opacity-25 dark:hover:bg-white/10 dark:hover:text-zinc-200"
                      >
                        <ArrowRight className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onChangeBoardConfig(
                            toggleHiddenBoardColumn(boardConfig, col.normId)
                          );
                        }}
                        title={`Hide "${col.label}" column`}
                        className="rounded p-0.5 text-zinc-500 hover:bg-zinc-200 hover:text-amber-600 dark:hover:bg-white/10 dark:hover:text-amber-300"
                      >
                        <EyeOff className="h-3 w-3" />
                      </button>
                    </div>
                    <span className="rounded bg-zinc-200/80 px-1.5 py-0.5 font-mono text-[10px] text-zinc-600 dark:bg-white/[0.05] dark:text-zinc-400">
                      {col.issues.length}
                    </span>
                  </div>
                </div>

                {/* Cards */}
                <div className="flex-1 space-y-2 overflow-y-auto p-2.5">
                  {visible.map((issue) => {
                    const isSelected = selectedId === issue.id;
                    const isDragging = draggedId === issue.id;
                    return (
                      <div
                        key={issue.id}
                        draggable
                        onDragStart={(e) => {
                          e.stopPropagation();
                          setDraggedColId(null);
                          e.dataTransfer.setData("text/plain", issue.id);
                          e.dataTransfer.effectAllowed = "move";
                          setDraggedId(issue.id);
                        }}
                        onDragEnd={() => {
                          setDraggedId(null);
                          setDragOverKey(null);
                        }}
                        onClick={() => onSelectIssue(issue)}
                        className={`cursor-pointer rounded-xl border p-3 transition ${
                          isDragging ? "opacity-45" : ""
                        } ${
                          isSelected
                            ? "border-indigo-400 bg-indigo-50/90 shadow-xs dark:border-indigo-500/60 dark:bg-indigo-500/12"
                            : issue.unread_responses > 0
                            ? "border-indigo-300 bg-white shadow-xs hover:border-indigo-400 dark:border-indigo-500/30 dark:bg-[#121622] dark:hover:border-indigo-400/50"
                            : "border-zinc-200 bg-white shadow-xs hover:border-zinc-300 hover:bg-zinc-50/80 dark:border-white/8 dark:bg-[#12151E] dark:shadow-none dark:hover:border-white/18 dark:hover:bg-[#161A26]"
                        }`}
                      >
                        <div className="mb-1.5 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <PriorityIcon
                              priority={issue.priority}
                              className="h-3.5 w-3.5"
                            />
                            <span className="font-mono text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                              {issue.identifier}
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            {issue.unread_responses > 0 && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-1.5 py-0.5 text-[9px] font-semibold text-indigo-700 dark:bg-indigo-500/25 dark:text-indigo-200">
                                <MessageSquare className="h-2.5 w-2.5" />
                                {issue.unread_responses}
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

                        <div className="line-clamp-2 text-xs font-medium leading-snug text-zinc-900 dark:text-zinc-100">
                          {issue.title}
                        </div>

                        <div className="mt-2 flex flex-wrap items-center justify-between gap-1.5">
                          <div className="flex min-w-0 flex-wrap items-center gap-1">
                            {issue.project_name && (
                              <span className="inline-flex max-w-[125px] items-center gap-1 truncate rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[9.5px] text-zinc-600 dark:border-white/8 dark:bg-white/[0.03] dark:text-zinc-400">
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
                                  variant="board"
                                />
                              ))}
                          </div>
                          <span className="text-[10px] text-zinc-500">
                            {timeAgo(issue.updated_at)}
                          </span>
                        </div>
                      </div>
                    );
                  })}

                  {remaining > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        setColumnLimits((prev) => ({
                          ...prev,
                          [col.key]: limit + 60,
                        }))
                      }
                      className="w-full rounded-lg border border-zinc-200 bg-white py-1.5 text-[11px] font-medium text-zinc-600 transition hover:bg-zinc-50 hover:text-zinc-900 dark:border-white/8 dark:bg-white/[0.03] dark:text-zinc-400 dark:hover:bg-white/[0.06] dark:hover:text-zinc-200"
                    >
                      Show {Math.min(60, remaining)} more ({remaining} left)
                    </button>
                  )}

                  {col.issues.length === 0 && (
                    <div className="rounded-lg border border-dashed border-zinc-300 py-6 text-center text-[11px] text-zinc-500 dark:border-white/8 dark:text-zinc-600">
                      Drop tickets here
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
