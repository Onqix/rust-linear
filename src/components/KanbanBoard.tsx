import { useMemo, useState } from "react";
import { FolderKanban, MessageSquare } from "lucide-react";
import type { LinearIssue, WorkspaceMetadata } from "../types";
import { AuthorAvatar, PriorityIcon, StateIcon } from "./Icons";

interface KanbanBoardProps {
  issues: LinearIssue[];
  meta: WorkspaceMetadata;
  teamFilter: string;
  selectedId: string | null;
  onSelectIssue: (issue: LinearIssue) => void;
  onMoveIssueState: (issue: LinearIssue, targetStateId: string) => Promise<void>;
  timeAgo: (iso: string) => string;
}

interface BoardColumn {
  key: string;
  label: string;
  stateType: string;
  color: string;
  directStateId?: string;
  issues: LinearIssue[];
}

export function KanbanBoard({
  issues,
  meta,
  teamFilter,
  selectedId,
  onSelectIssue,
  onMoveIssueState,
  timeAgo,
}: KanbanBoardProps) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [columnLimits, setColumnLimits] = useState<Record<string, number>>({});

  const singleTeam = useMemo(() => {
    if (teamFilter !== "ALL") {
      return meta.teams.find((t) => t.key === teamFilter) ?? null;
    }
    if (meta.teams.length === 1) {
      return meta.teams[0];
    }
    return null;
  }, [meta.teams, teamFilter]);

  const columns: BoardColumn[] = useMemo(() => {
    if (singleTeam && singleTeam.states.length > 0) {
      const sorted = [...singleTeam.states].sort(
        (a, b) => a.position - b.position
      );
      return sorted
        .map((st) => {
          const colIssues = issues.filter(
            (i) =>
              i.state_id === st.id ||
              (i.team_key === singleTeam.key &&
                i.state_name.toLowerCase() === st.name.toLowerCase())
          );
          return {
            key: st.id,
            label: st.name,
            stateType: st.state_type,
            color: st.color,
            directStateId: st.id,
            issues: colIssues,
          };
        })
        .filter(
          (col) =>
            col.stateType !== "canceled" || col.issues.length > 0
        );
    }

    // Multi-team workspace with ALL teams selected: group by workflow stage
    const buckets: {
      key: string;
      label: string;
      stateType: string;
      color: string;
    }[] = [
      { key: "backlog", label: "Backlog", stateType: "backlog", color: "#71717a" },
      { key: "unstarted", label: "Todo", stateType: "unstarted", color: "#94a3b8" },
      { key: "started", label: "In Progress", stateType: "started", color: "#f59e0b" },
      { key: "completed", label: "Done", stateType: "completed", color: "#6366f1" },
      { key: "canceled", label: "Canceled", stateType: "canceled", color: "#52525b" },
    ];

    return buckets
      .map((b) => ({
        ...b,
        issues: issues.filter((i) => {
          const t = i.state_type.toLowerCase();
          if (b.key === "backlog") return t === "backlog" || t === "triage";
          return t === b.key;
        }),
      }))
      .filter((col) => col.key !== "canceled" || col.issues.length > 0);
  }, [issues, singleTeam]);

  function resolveTargetStateId(
    issue: LinearIssue,
    col: BoardColumn
  ): string | null {
    if (col.directStateId) return col.directStateId;
    const team = meta.teams.find(
      (t) => t.id === issue.team_id || t.key === issue.team_key
    );
    if (!team) return null;
    const sorted = [...team.states].sort((a, b) => a.position - b.position);
    const match =
      sorted.find((s) => s.state_type.toLowerCase() === col.stateType) ??
      sorted.find((s) => s.name.toLowerCase() === col.label.toLowerCase());
    return match?.id ?? null;
  }

  return (
    <div className="flex flex-1 gap-3 overflow-x-auto bg-[#090B10] p-4">
      {columns.map((col) => {
        const limit = columnLimits[col.key] ?? 60;
        const visible = col.issues.slice(0, limit);
        const remaining = col.issues.length - visible.length;
        const isDragOver = dragOverKey === col.key;

        return (
          <div
            key={col.key}
            onDragOver={(e) => {
              e.preventDefault();
              if (dragOverKey !== col.key) setDragOverKey(col.key);
            }}
            onDragLeave={() => {
              if (dragOverKey === col.key) setDragOverKey(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragOverKey(null);
              const issueId = e.dataTransfer.getData("text/plain") || draggedId;
              setDraggedId(null);
              if (!issueId) return;
              const dragged = issues.find((i) => i.id === issueId);
              if (!dragged) return;
              const targetStateId = resolveTargetStateId(dragged, col);
              if (!targetStateId || targetStateId === dragged.state_id) return;
              void onMoveIssueState(dragged, targetStateId);
            }}
            className={`flex w-76 shrink-0 flex-col rounded-xl border transition ${
              isDragOver
                ? "border-indigo-500/60 bg-indigo-500/[0.06]"
                : "border-white/8 bg-[#0C0F16]"
            }`}
          >
            {/* Column Header */}
            <div className="flex shrink-0 items-center justify-between border-b border-white/8 px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <StateIcon
                  stateType={col.stateType}
                  color={col.color}
                  className="h-3.5 w-3.5 shrink-0"
                />
                <span className="truncate text-xs font-semibold text-zinc-200">
                  {col.label}
                </span>
              </div>
              <span className="rounded bg-white/[0.05] px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                {col.issues.length}
              </span>
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
                        ? "border-indigo-500/60 bg-indigo-500/12"
                        : issue.unread_responses > 0
                        ? "border-indigo-500/30 bg-[#121622] hover:border-indigo-400/50"
                        : "border-white/8 bg-[#12151E] hover:border-white/18 hover:bg-[#161A26]"
                    }`}
                  >
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5">
                        <PriorityIcon
                          priority={issue.priority}
                          className="h-3.5 w-3.5"
                        />
                        <span className="font-mono text-[11px] font-medium text-zinc-400">
                          {issue.identifier}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {issue.unread_responses > 0 && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-indigo-500/25 px-1.5 py-0.5 text-[9px] font-semibold text-indigo-200">
                            <MessageSquare className="h-2.5 w-2.5" />
                            {issue.unread_responses}
                          </span>
                        )}
                        {issue.assignee_name && (
                          <AuthorAvatar name={issue.assignee_name} size="sm" />
                        )}
                      </div>
                    </div>

                    <div className="line-clamp-2 text-xs font-medium leading-snug text-zinc-100">
                      {issue.title}
                    </div>

                    <div className="mt-2 flex flex-wrap items-center justify-between gap-1.5">
                      <div className="flex min-w-0 flex-wrap items-center gap-1">
                        {issue.project_name && (
                          <span className="inline-flex max-w-[125px] items-center gap-1 truncate rounded border border-white/8 bg-white/[0.03] px-1.5 py-0.5 text-[9.5px] text-zinc-400">
                            <FolderKanban className="h-2.5 w-2.5 shrink-0 text-zinc-500" />
                            <span className="truncate">
                              {issue.project_name}
                            </span>
                          </span>
                        )}
                        {issue.labels.slice(0, 2).map((l) => (
                          <span
                            key={l}
                            className="max-w-[85px] truncate rounded border border-white/8 bg-white/[0.03] px-1.5 py-0.5 text-[9.5px] text-zinc-400"
                          >
                            {l}
                          </span>
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
                  className="w-full rounded-lg border border-white/8 bg-white/[0.03] py-1.5 text-[11px] font-medium text-zinc-400 transition hover:bg-white/[0.06] hover:text-zinc-200"
                >
                  Show {Math.min(60, remaining)} more ({remaining} left)
                </button>
              )}

              {col.issues.length === 0 && (
                <div className="rounded-lg border border-dashed border-white/8 py-6 text-center text-[11px] text-zinc-600">
                  Drop tickets here
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
