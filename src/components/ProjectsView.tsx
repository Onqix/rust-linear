import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Calendar,
  CheckCircle2,
  FolderKanban,
  Layers,
  ListFilter,
  Plus,
  RefreshCw,
  Search,
  User,
  X,
  XCircle,
} from "lucide-react";
import type {
  CreateProjectInput,
  LinearIssue,
  LinearProjectDetail,
  LinearProjectStatusOption,
  ProjectsOverview,
  UpdateProjectPatch,
  WorkspaceMetadata,
} from "../types";
import { openExternalUrl } from "../lib/openExternal";
import { DarkSelect, type DarkSelectOption } from "./DarkSelect";
import { AuthorAvatar, PriorityIcon, StateIcon } from "./Icons";

interface ProjectsViewProps {
  overview: ProjectsOverview | null;
  loading: boolean;
  error: string | null;
  hasApiKey: boolean;
  issues: LinearIssue[];
  workspaceMeta: WorkspaceMetadata;
  onRefresh: () => Promise<void>;
  onCreateProject: (input: CreateProjectInput) => Promise<void>;
  onUpdateProject: (
    projectId: string,
    patch: UpdateProjectPatch
  ) => Promise<void>;
  onViewProjectIssues: (project: LinearProjectDetail) => void;
  onSelectIdentifier: (identifier: string) => void;
  timeAgo: (iso: string) => string;
}

type ProjectStatusFilter =
  | "all"
  | "active"
  | "paused"
  | "backlog"
  | "completed"
  | "canceled";

const STATUS_FILTER_CHIPS: { id: ProjectStatusFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "paused", label: "Paused" },
  { id: "backlog", label: "Backlog" },
  { id: "completed", label: "Completed" },
  { id: "canceled", label: "Canceled" },
];

const WORKFLOW_SEGMENTS: {
  key: "backlog" | "unstarted" | "started" | "completed" | "canceled";
  label: string;
  color: string;
}[] = [
  { key: "backlog", label: "Backlog", color: "#71717a" },
  { key: "unstarted", label: "Todo", color: "#94a3b8" },
  { key: "started", label: "In Progress", color: "#f59e0b" },
  { key: "completed", label: "Done", color: "#10b981" },
  { key: "canceled", label: "Canceled", color: "#ef4444" },
];

function getTodayDateString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isProjectDone(statusType: string): boolean {
  const st = statusType.toLowerCase();
  return st === "completed" || st === "canceled" || st === "cancelled";
}

function isProjectOverdue(
  targetDate: string | null,
  statusType: string,
  todayStr: string
): boolean {
  if (!targetDate || isProjectDone(statusType)) return false;
  return targetDate < todayStr;
}

function matchesProjectStatusFilter(
  statusType: string,
  filter: ProjectStatusFilter
): boolean {
  const st = statusType.toLowerCase();
  switch (filter) {
    case "all":
      return true;
    case "active":
      return st === "planned" || st === "started";
    case "paused":
      return st === "paused";
    case "backlog":
      return st === "backlog";
    case "completed":
      return st === "completed";
    case "canceled":
      return st === "canceled" || st === "cancelled";
  }
}

function prioritySortRank(priority: number): number {
  return priority >= 1 && priority <= 4 ? priority : 5;
}

function HealthBadge({ health }: { health: string | null }) {
  if (!health) {
    return <span className="text-[11px] text-zinc-400 dark:text-zinc-600">—</span>;
  }
  const normalized = health.trim();
  if (normalized === "onTrack") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300">
        <CheckCircle2 className="h-3 w-3 shrink-0" />
        On track
      </span>
    );
  }
  if (normalized === "atRisk") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300">
        <AlertTriangle className="h-3 w-3 shrink-0" />
        At risk
      </span>
    );
  }
  if (normalized === "offTrack") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-300">
        <XCircle className="h-3 w-3 shrink-0" />
        Off track
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-zinc-200 bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-700 dark:border-white/10 dark:bg-white/[0.06] dark:text-zinc-300">
      {normalized}
    </span>
  );
}

function ProjectTargetDateInput({
  value,
  overdue,
  disabled,
  onCommit,
}: {
  value: string | null;
  overdue: boolean;
  disabled: boolean;
  onCommit: (nextValue: string) => void;
}) {
  const [draft, setDraft] = useState(value ?? "");

  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);

  function commitIfValid(next: string) {
    const current = value ?? "";
    if (next === current) return;
    if (next === "" || (/^\d{4}-\d{2}-\d{2}$/.test(next) && Number(next.slice(0, 4)) >= 1900)) {
      onCommit(next);
    }
  }

  return (
    <div
      className="flex min-w-0 flex-col items-start gap-0.5"
      onClick={(e) => e.stopPropagation()}
    >
      <input
        type="date"
        value={draft}
        disabled={disabled}
        onChange={(e) => {
          const next = e.target.value;
          setDraft(next);
          if (next === "" || (/^\d{4}-\d{2}-\d{2}$/.test(next) && Number(next.slice(0, 4)) >= 1900)) {
            commitIfValid(next);
          }
        }}
        onBlur={() => {
          const current = value ?? "";
          if (draft !== current && draft !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(draft)) {
            setDraft(current);
          } else {
            commitIfValid(draft);
          }
        }}
        className={`rounded-md border px-1.5 py-0.5 font-mono text-[11px] focus:border-indigo-500 focus:outline-none disabled:opacity-50 ${
          overdue
            ? "border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/12 dark:text-rose-300"
            : "border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-white/10 dark:bg-[#141720] dark:text-zinc-300"
        }`}
      />
      {overdue && (
        <span className="text-[10px] font-semibold text-rose-600 dark:text-rose-400">
          Overdue
        </span>
      )}
    </div>
  );
}

interface CreateProjectModalProps {
  statuses: LinearProjectStatusOption[];
  workspaceMeta: WorkspaceMetadata;
  onCreate: (input: CreateProjectInput) => Promise<void>;
  onClose: () => void;
}

function CreateProjectModal({
  statuses,
  workspaceMeta,
  onCreate,
  onClose,
}: CreateProjectModalProps) {
  const [name, setName] = useState("");
  const [teamIds, setTeamIds] = useState<string[]>(() =>
    workspaceMeta.teams.length > 0 ? [workspaceMeta.teams[0].id] : []
  );
  const [description, setDescription] = useState("");
  const [statusId, setStatusId] = useState(() => {
    const planned = statuses.find(
      (s) => s.status_type.toLowerCase() === "planned"
    );
    const backlog = statuses.find(
      (s) => s.status_type.toLowerCase() === "backlog"
    );
    return planned?.id ?? backlog?.id ?? statuses[0]?.id ?? "";
  });
  const [leadId, setLeadId] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameInputRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [onClose]);

  const statusOptions: DarkSelectOption[] = useMemo(
    () =>
      statuses.map((s) => ({
        value: s.id,
        label: s.name,
        colorDot: s.color,
      })),
    [statuses]
  );

  const leadOptions: DarkSelectOption[] = useMemo(
    () => [
      {
        value: "",
        label: "No lead",
        icon: <User className="h-3.5 w-3.5 text-zinc-500" />,
      },
      ...workspaceMeta.users.map((u) => ({
        value: u.id,
        label: u.name,
      })),
    ],
    [workspaceMeta.users]
  );

  function toggleTeam(id: string) {
    setTeamIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  }

  async function submitForm() {
    if (!name.trim() || teamIds.length === 0 || submitting) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      await onCreate({
        name: name.trim(),
        team_ids: teamIds,
        description: description.trim() ? description.trim() : null,
        status_id: statusId || null,
        lead_id: leadId || null,
        target_date: targetDate || null,
      });
      onClose();
    } catch (err) {
      setSubmitError(String(err));
      setSubmitting(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void submitForm();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-sm dark:bg-black/75">
      <form
        onSubmit={handleSubmit}
        className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-white/12 dark:bg-[#10131B]"
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3.5 dark:border-white/8">
          <div className="flex items-center gap-2">
            <FolderKanban className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-200">
              New Linear Project
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {workspaceMeta.teams.length === 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              Sync Linear first so workspace teams are loaded.
            </div>
          )}

          {submitError && (
            <div className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
              {submitError}
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
              Project name
            </label>
            <input
              ref={nameInputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  void submitForm();
                }
              }}
              placeholder="Project name..."
              className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-3.5 py-2 text-sm font-medium text-zinc-900 placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-white/10 dark:bg-[#090B10] dark:text-white dark:placeholder:text-zinc-500"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
              Teams (at least one)
            </label>
            <div className="flex flex-wrap gap-1.5">
              {workspaceMeta.teams.map((team) => {
                const selected = teamIds.includes(team.id);
                return (
                  <button
                    key={team.id}
                    type="button"
                    onClick={() => toggleTeam(team.id)}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                      selected
                        ? "border-indigo-500 bg-indigo-50 text-indigo-800 dark:border-indigo-500/60 dark:bg-indigo-500/20 dark:text-indigo-200"
                        : "border-zinc-200 bg-zinc-50 text-zinc-600 hover:border-zinc-300 hover:text-zinc-900 dark:border-white/10 dark:bg-[#090B10] dark:text-zinc-400 dark:hover:border-white/20 dark:hover:text-zinc-200"
                    }`}
                  >
                    <Layers className="h-3 w-3" />
                    <span className="font-mono text-[11px]">{team.key}</span>
                    <span>{team.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-zinc-700 dark:text-zinc-300">
              Summary
            </label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short summary of the project goals..."
              className="w-full resize-y rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs leading-relaxed text-zinc-900 placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-white/10 dark:bg-[#090B10] dark:text-zinc-200 dark:placeholder:text-zinc-500"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            {statusOptions.length > 0 && (
              <DarkSelect
                value={statusId}
                options={statusOptions}
                onChange={setStatusId}
                placeholder="Status"
                compact
              />
            )}
            <DarkSelect
              value={leadId}
              options={leadOptions}
              onChange={setLeadId}
              placeholder="Lead"
              compact
            />
            <div className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2 py-1 text-[11px] dark:border-white/10 dark:bg-[#12151F]">
              <Calendar className="h-3 w-3 text-zinc-400" />
              <input
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                className="bg-transparent font-mono text-[11px] text-zinc-800 focus:outline-none dark:text-zinc-100"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-zinc-200 bg-zinc-50 px-5 py-3 dark:border-white/8 dark:bg-[#0B0D13]">
          <span className="text-[11px] text-zinc-500">
            <kbd className="rounded border border-zinc-200 bg-white px-1 font-mono text-zinc-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-400">
              Ctrl+Enter
            </kbd>{" "}
            to create
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-white/10 dark:text-zinc-300 dark:hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || teamIds.length === 0 || submitting}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              {submitting ? "Creating..." : "Create Project"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

export function ProjectsView({
  overview,
  loading,
  error,
  hasApiKey,
  issues,
  workspaceMeta,
  onRefresh,
  onCreateProject,
  onUpdateProject,
  onViewProjectIssues,
  onSelectIdentifier,
  timeAgo,
}: ProjectsViewProps) {
  const [statusFilter, setStatusFilter] = useState<ProjectStatusFilter>("all");
  const [search, setSearch] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null
  );
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(new Set());
  const [localError, setLocalError] = useState<string | null>(null);

  const [nameDraft, setNameDraft] = useState("");
  const [descDraft, setDescDraft] = useState("");

  const todayStr = useMemo(() => getTodayDateString(), []);

  const issueStatsByProject = useMemo(() => {
    const map = new Map<
      string,
      {
        all: LinearIssue[];
        total: number;
        done: number;
        inProgress: number;
        byStage: Record<
          "backlog" | "unstarted" | "started" | "completed" | "canceled",
          number
        >;
      }
    >();

    for (const issue of issues) {
      if (!issue.project_id) continue;
      let entry = map.get(issue.project_id);
      if (!entry) {
        entry = {
          all: [],
          total: 0,
          done: 0,
          inProgress: 0,
          byStage: {
            backlog: 0,
            unstarted: 0,
            started: 0,
            completed: 0,
            canceled: 0,
          },
        };
        map.set(issue.project_id, entry);
      }
      entry.all.push(issue);
      entry.total += 1;
      const st = issue.state_type.toLowerCase();
      if (st === "completed") {
        entry.done += 1;
        entry.byStage.completed += 1;
      } else if (st === "canceled" || st === "cancelled") {
        entry.byStage.canceled += 1;
      } else if (st === "started") {
        entry.inProgress += 1;
        entry.byStage.started += 1;
      } else if (st === "unstarted") {
        entry.byStage.unstarted += 1;
      } else {
        entry.byStage.backlog += 1;
      }
    }
    return map;
  }, [issues]);

  const projects = overview?.projects ?? [];
  const statuses = overview?.statuses ?? [];

  const filteredProjects = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projects.filter((p) => {
      if (!matchesProjectStatusFilter(p.status_type, statusFilter)) {
        return false;
      }
      if (q && !p.name.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [projects, statusFilter, search]);

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) ?? null,
    [projects, selectedProjectId]
  );

  useEffect(() => {
    if (selectedProject) {
      setNameDraft(selectedProject.name);
      setDescDraft(selectedProject.description ?? "");
    }
  }, [
    selectedProject?.id,
    selectedProject?.name,
    selectedProject?.description,
  ]);

  const statusOptions: DarkSelectOption[] = useMemo(
    () =>
      statuses.map((s) => ({
        value: s.id,
        label: s.name,
        colorDot: s.color,
      })),
    [statuses]
  );

  const leadOptions: DarkSelectOption[] = useMemo(
    () => [
      {
        value: "",
        label: "No lead",
        icon: <User className="h-3.5 w-3.5 text-zinc-500" />,
      },
      ...workspaceMeta.users.map((u) => ({
        value: u.id,
        label: u.name,
      })),
    ],
    [workspaceMeta.users]
  );

  async function applyProjectUpdate(
    projectId: string,
    patch: UpdateProjectPatch
  ) {
    setLocalError(null);
    setUpdatingIds((prev) => {
      const next = new Set(prev);
      next.add(projectId);
      return next;
    });
    try {
      await onUpdateProject(projectId, patch);
    } catch (err) {
      setLocalError(String(err));
    } finally {
      setUpdatingIds((prev) => {
        const next = new Set(prev);
        next.delete(projectId);
        return next;
      });
    }
  }

  function saveInlineName() {
    if (!selectedProject) return;
    const trimmed = nameDraft.trim();
    if (!trimmed) {
      setNameDraft(selectedProject.name);
      return;
    }
    if (trimmed !== selectedProject.name) {
      void applyProjectUpdate(selectedProject.id, { name: trimmed });
    }
  }

  function saveInlineDescription() {
    if (!selectedProject) return;
    if (descDraft !== selectedProject.description) {
      void applyProjectUpdate(selectedProject.id, { description: descDraft });
    }
  }

  const selectedProjectOpenIssues = useMemo(() => {
    if (!selectedProject) return [];
    const stats = issueStatsByProject.get(selectedProject.id);
    if (!stats) return [];
    return stats.all
      .filter((i) => {
        const st = i.state_type.toLowerCase();
        return st !== "completed" && st !== "canceled" && st !== "cancelled";
      })
      .sort((a, b) => {
        const prioDiff =
          prioritySortRank(a.priority) - prioritySortRank(b.priority);
        if (prioDiff !== 0) return prioDiff;
        return (
          new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        );
      });
  }, [selectedProject, issueStatsByProject]);

  const selectedProjectStats = selectedProject
    ? issueStatsByProject.get(selectedProject.id)
    : undefined;

  const combinedError = localError || error;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <header className="shrink-0 space-y-2.5 border-b border-zinc-200 bg-white px-5 py-3.5 dark:border-white/8 dark:bg-[#0C0E14]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <FolderKanban className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
            <h1 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-white">
              Projects
            </h1>
            {overview && (
              <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] text-zinc-600 dark:bg-white/[0.06] dark:text-zinc-300">
                {filteredProjects.length}
                {filteredProjects.length !== projects.length
                  ? ` / ${projects.length}`
                  : ""}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <div className="relative w-56">
              <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-zinc-400 dark:text-zinc-500" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter projects..."
                className="w-full rounded-lg border border-zinc-200 bg-zinc-50 py-1.5 pl-8 pr-7 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-white/10 dark:bg-[#141720] dark:text-zinc-100 dark:placeholder:text-zinc-500"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-1.5 top-1.5 rounded p-0.5 text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => void onRefresh()}
              disabled={loading || !hasApiKey}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-medium text-zinc-700 transition hover:border-indigo-400 hover:text-zinc-900 disabled:opacity-50 dark:border-white/10 dark:bg-[#141720] dark:text-zinc-200 dark:hover:border-indigo-500/40 dark:hover:text-white"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
              />
              Refresh
            </button>

            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              disabled={!hasApiKey || workspaceMeta.teams.length === 0}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-indigo-500 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              New project
            </button>
          </div>
        </div>

        {/* Status Filter Chips */}
        <div className="flex flex-wrap items-center gap-1.5">
          {STATUS_FILTER_CHIPS.map((chip) => {
            const active = statusFilter === chip.id;
            return (
              <button
                key={chip.id}
                type="button"
                onClick={() => setStatusFilter(chip.id)}
                className={`rounded-md border px-2.5 py-1 text-[11px] font-medium transition ${
                  active
                    ? "border-indigo-300 bg-indigo-50 text-indigo-800 dark:border-indigo-500/40 dark:bg-indigo-500/18 dark:text-indigo-200"
                    : "border-zinc-200 bg-zinc-50 text-zinc-600 hover:border-zinc-300 hover:text-zinc-900 dark:border-white/8 dark:bg-white/[0.03] dark:text-zinc-400 dark:hover:border-white/15 dark:hover:text-zinc-200"
                }`}
              >
                {chip.label}
              </button>
            );
          })}
        </div>
      </header>

      {combinedError && (
        <div className="flex items-center justify-between border-b border-rose-300 bg-rose-50 px-4 py-2 text-xs text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/12 dark:text-rose-200">
          <span className="line-clamp-2">{combinedError}</span>
          <button
            type="button"
            onClick={() => setLocalError(null)}
            className="ml-3 shrink-0 text-rose-600 hover:text-rose-900 dark:text-rose-300 dark:hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Content Area */}
      <div className="relative flex flex-1 overflow-hidden">
        <main className="surface-glow flex-1 overflow-y-auto p-5 pb-32">
          {!hasApiKey && !overview ? (
            <div className="mx-auto max-w-md rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center dark:border-white/12 dark:bg-[#10131B]/70">
              <FolderKanban className="mx-auto mb-3 h-8 w-8 text-indigo-500/75 dark:text-indigo-400/75" />
              <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                Linear API key not configured
              </p>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Add your Linear Personal API Key in Settings to view and manage
                projects.
              </p>
            </div>
          ) : loading && !overview ? (
            <div className="space-y-2.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <div
                  key={n}
                  className="h-14 animate-pulse rounded-xl border border-zinc-200 bg-white dark:border-white/8 dark:bg-[#10131B]"
                />
              ))}
            </div>
          ) : !overview ? (
            <div className="mx-auto max-w-md rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center dark:border-white/12 dark:bg-[#10131B]/70">
              <FolderKanban className="mx-auto mb-3 h-8 w-8 text-indigo-500/75 dark:text-indigo-400/75" />
              <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                Projects not loaded yet
              </p>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Click Refresh to load projects from Linear.
              </p>
            </div>
          ) : projects.length === 0 ? (
            <div className="mx-auto max-w-md rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center dark:border-white/12 dark:bg-[#10131B]/70">
              <FolderKanban className="mx-auto mb-3 h-8 w-8 text-indigo-500/75 dark:text-indigo-400/75" />
              <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                No projects in this workspace
              </p>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Create your first Linear project to track milestones and
                progress.
              </p>
            </div>
          ) : filteredProjects.length === 0 ? (
            <div className="mx-auto max-w-md rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center dark:border-white/12 dark:bg-[#10131B]/70">
              <ListFilter className="mx-auto mb-3 h-7 w-7 text-zinc-400" />
              <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                No matching projects
              </p>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Adjust the status filter or search query to see other projects.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-zinc-200 bg-white dark:border-white/8 dark:bg-[#10131B]">
              {/* Column Header */}
              <div className="hidden grid-cols-[minmax(180px,2fr)_140px_100px_150px_150px_120px_120px] items-center gap-3 border-b border-zinc-200 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:border-white/8 xl:grid">
                <span>Project</span>
                <span>Status</span>
                <span>Health</span>
                <span>Lead</span>
                <span>Target date</span>
                <span>Progress</span>
                <span className="text-right">Local issues</span>
              </div>

              <div className="divide-y divide-zinc-200/80 dark:divide-white/[0.06]">
                {filteredProjects.map((project) => {
                  const isSelected = selectedProjectId === project.id;
                  const isUpdating = updatingIds.has(project.id);
                  const overdue = isProjectOverdue(
                    project.target_date,
                    project.status_type,
                    todayStr
                  );
                  const pct = Math.max(
                    0,
                    Math.min(100, Math.round(project.progress * 100))
                  );
                  const stats = issueStatsByProject.get(project.id);
                  const totalCount = stats?.total ?? 0;
                  const doneCount = stats?.done ?? 0;
                  const inProgressCount = stats?.inProgress ?? 0;

                  return (
                    <div
                      key={project.id}
                      onClick={() => setSelectedProjectId(project.id)}
                      className={`grid cursor-pointer grid-cols-1 items-center gap-3 px-4 py-2.5 transition xl:grid-cols-[minmax(180px,2fr)_140px_100px_150px_150px_120px_120px] ${
                        isSelected
                          ? "bg-indigo-50/80 dark:bg-indigo-500/12"
                          : "hover:bg-zinc-50 dark:hover:bg-white/[0.025]"
                      } ${isUpdating ? "opacity-75" : ""}`}
                    >
                      {/* Name + Dot */}
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/10 dark:ring-white/15"
                          style={{
                            backgroundColor: project.color || "#6366f1",
                          }}
                        />
                        <div className="min-w-0">
                          <div className="truncate text-xs font-medium text-zinc-900 dark:text-zinc-100">
                            {project.name}
                          </div>
                          {project.teams.length > 0 && (
                            <div className="truncate font-mono text-[10px] text-zinc-500">
                              {project.teams.map((t) => t.key).join(" · ")}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Status */}
                      <div onClick={(e) => e.stopPropagation()}>
                        {statusOptions.length > 0 ? (
                          <DarkSelect
                            value={project.status_id}
                            options={statusOptions}
                            onChange={(nextStatusId) => {
                              if (nextStatusId !== project.status_id) {
                                void applyProjectUpdate(project.id, {
                                  status_id: nextStatusId,
                                });
                              }
                            }}
                            disabled={isUpdating}
                            compact
                            fullWidth
                          />
                        ) : (
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[11px] font-medium text-zinc-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-300">
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{ backgroundColor: project.status_color }}
                            />
                            {project.status_name}
                          </span>
                        )}
                      </div>

                      {/* Health */}
                      <div>
                        <HealthBadge health={project.health} />
                      </div>

                      {/* Lead */}
                      <div onClick={(e) => e.stopPropagation()}>
                        <DarkSelect
                          value={project.lead_id ?? ""}
                          options={leadOptions}
                          onChange={(nextLeadId) => {
                            const currentLead = project.lead_id ?? "";
                            if (nextLeadId !== currentLead) {
                              void applyProjectUpdate(project.id, {
                                lead_id: nextLeadId,
                              });
                            }
                          }}
                          placeholder="No lead"
                          disabled={isUpdating}
                          compact
                          fullWidth
                        />
                      </div>

                      {/* Target date */}
                      <div>
                        <ProjectTargetDateInput
                          value={project.target_date}
                          overdue={overdue}
                          disabled={isUpdating}
                          onCommit={(nextDate) => {
                            void applyProjectUpdate(project.id, {
                              target_date: nextDate,
                            });
                          }}
                        />
                      </div>

                      {/* Progress */}
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-white/10">
                          <div
                            className="h-full rounded-full bg-indigo-600 transition-all dark:bg-indigo-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="w-8 text-right font-mono text-[11px] text-zinc-600 dark:text-zinc-300">
                          {pct}%
                        </span>
                      </div>

                      {/* Local issue counts */}
                      <div className="flex items-center justify-end gap-1.5 font-mono text-[11px]">
                        <span
                          className="text-zinc-800 dark:text-zinc-200"
                          title="Total local issues"
                        >
                          {totalCount}
                        </span>
                        <span className="text-zinc-400">·</span>
                        <span
                          className="text-amber-600 dark:text-amber-400"
                          title="In progress"
                        >
                          {inProgressCount}p
                        </span>
                        <span
                          className="text-emerald-600 dark:text-emerald-400"
                          title="Done"
                        >
                          {doneCount}d
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </main>

        {/* Selected Project Right Drawer */}
        {selectedProject && (
          <aside className="flex w-[420px] shrink-0 flex-col overflow-hidden border-l border-zinc-200 bg-white shadow-2xl shadow-black/10 dark:border-white/10 dark:bg-[#0D1017] dark:shadow-black/60">
            <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-white/8">
              <div className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{
                    backgroundColor: selectedProject.color || "#6366f1",
                  }}
                />
                <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                  Project Details
                </span>
                {updatingIds.has(selectedProject.id) && (
                  <span className="text-[10px] text-indigo-600 dark:text-indigo-400">
                    Saving...
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSelectedProjectId(null)}
                className="rounded p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto p-4">
              {/* Editable Name & Description */}
              <div className="space-y-2.5">
                <input
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={saveInlineName}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      saveInlineName();
                      e.currentTarget.blur();
                    } else if (e.key === "Escape") {
                      setNameDraft(selectedProject.name);
                      e.currentTarget.blur();
                    }
                  }}
                  disabled={updatingIds.has(selectedProject.id)}
                  aria-label="Project name"
                  className="w-full rounded-lg border border-transparent bg-transparent px-2 py-1 text-sm font-semibold text-zinc-900 transition hover:border-zinc-200 focus:border-indigo-500 focus:bg-zinc-50 focus:outline-none dark:text-white dark:hover:border-white/10 dark:focus:bg-[#141720]"
                />

                <textarea
                  rows={3}
                  value={descDraft}
                  onChange={(e) => setDescDraft(e.target.value)}
                  onBlur={saveInlineDescription}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      saveInlineDescription();
                      e.currentTarget.blur();
                    } else if (e.key === "Escape") {
                      setDescDraft(selectedProject.description ?? "");
                      e.currentTarget.blur();
                    }
                  }}
                  disabled={updatingIds.has(selectedProject.id)}
                  placeholder="Add a short project summary..."
                  aria-label="Project summary"
                  className="w-full resize-y rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-2 text-xs leading-relaxed text-zinc-800 placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-white/10 dark:bg-[#12151F] dark:text-zinc-200 dark:placeholder:text-zinc-500"
                />
              </div>

              {/* Metadata & Actions */}
              <div className="space-y-2.5 rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-white/8 dark:bg-[#10131B]">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                  <span className="text-zinc-500">Status</span>
                  <span className="inline-flex items-center gap-1.5 font-medium text-zinc-800 dark:text-zinc-200">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: selectedProject.status_color }}
                    />
                    {selectedProject.status_name}
                  </span>
                </div>

                {selectedProject.lead_name && (
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="text-zinc-500">Lead</span>
                    <span className="inline-flex items-center gap-1.5 font-medium text-zinc-800 dark:text-zinc-200">
                      <AuthorAvatar
                        name={selectedProject.lead_name}
                        size="sm"
                      />
                      {selectedProject.lead_name}
                    </span>
                  </div>
                )}

                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="text-zinc-500">Teams</span>
                  <div className="flex flex-wrap justify-end gap-1">
                    {selectedProject.teams.length === 0 ? (
                      <span className="text-zinc-400">None</span>
                    ) : (
                      selectedProject.teams.map((t) => (
                        <span
                          key={t.id}
                          className="rounded border border-zinc-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-zinc-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-zinc-300"
                        >
                          {t.key} · {t.name}
                        </span>
                      ))
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="text-zinc-500">Updated</span>
                  <span className="text-zinc-600 dark:text-zinc-400">
                    {timeAgo(selectedProject.updated_at)}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void openExternalUrl(selectedProject.url)}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:border-indigo-400 hover:text-zinc-900 dark:border-white/10 dark:bg-[#141720] dark:text-zinc-200 dark:hover:border-indigo-500/40 dark:hover:text-white"
                >
                  Open in Linear
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onViewProjectIssues(selectedProject)}
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-500"
                >
                  View issues
                </button>
              </div>

              {/* Local Issue Workflow Breakdown */}
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h2 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                    Workflow Breakdown
                  </h2>
                  <span className="font-mono text-[11px] text-zinc-500">
                    {selectedProjectStats?.total ?? 0} synced
                  </span>
                </div>

                {selectedProjectStats && selectedProjectStats.total > 0 ? (
                  <>
                    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-white/[0.06]">
                      {WORKFLOW_SEGMENTS.map((seg) => {
                        const count = selectedProjectStats.byStage[seg.key];
                        if (count === 0) return null;
                        const widthPct =
                          (count / selectedProjectStats.total) * 100;
                        return (
                          <div
                            key={seg.key}
                            title={`${seg.label}: ${count}`}
                            style={{
                              width: `${widthPct}%`,
                              backgroundColor: seg.color,
                            }}
                          />
                        );
                      })}
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                      {WORKFLOW_SEGMENTS.map((seg) => {
                        const count = selectedProjectStats.byStage[seg.key];
                        return (
                          <div
                            key={seg.key}
                            className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400"
                          >
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{ backgroundColor: seg.color }}
                            />
                            <span>{seg.label}</span>
                            <span className="font-mono font-medium text-zinc-900 dark:text-zinc-200">
                              {count}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-zinc-500">
                    No synced issues belong to this project yet.
                  </p>
                )}
              </section>

              {/* Open Issues List */}
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h2 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                    Open Issues
                  </h2>
                  <span className="font-mono text-[11px] text-zinc-500">
                    {selectedProjectOpenIssues.length}
                  </span>
                </div>

                {selectedProjectOpenIssues.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-zinc-200 p-4 text-center text-xs text-zinc-500 dark:border-white/10">
                    No open local issues in this project.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {selectedProjectOpenIssues.map((issue) => (
                      <button
                        key={issue.id}
                        type="button"
                        onClick={() => onSelectIdentifier(issue.identifier)}
                        className="flex w-full items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-2 text-left text-xs transition hover:border-indigo-300 hover:bg-indigo-50/40 dark:border-white/8 dark:bg-[#10131B] dark:hover:border-indigo-500/40 dark:hover:bg-[#141824]"
                      >
                        <PriorityIcon
                          priority={issue.priority}
                          className="h-3.5 w-3.5 shrink-0"
                        />
                        <StateIcon
                          stateType={issue.state_type}
                          color={issue.state_color}
                          className="h-3.5 w-3.5 shrink-0"
                        />
                        <span className="shrink-0 font-mono text-[11px] font-semibold text-indigo-600 dark:text-indigo-400">
                          {issue.identifier}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-zinc-800 dark:text-zinc-200">
                          {issue.title}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </aside>
        )}
      </div>

      {showCreateModal && (
        <CreateProjectModal
          statuses={statuses}
          workspaceMeta={workspaceMeta}
          onCreate={onCreateProject}
          onClose={() => setShowCreateModal(false)}
        />
      )}
    </div>
  );
}
