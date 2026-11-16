import { useEffect, useMemo, useState } from "react";
import { openExternalUrl } from "../lib/openExternal";
import {
  ArrowUpRight,
  Check,
  CheckCheck,
  Copy,
  EyeOff,
  FolderKanban,
  MessageSquare,
  Pencil,
  RefreshCw,
  Send,
  User,
  X,
} from "lucide-react";
import type {
  LinearIssue,
  UpdateIssuePatch,
  WorkspaceMetadata,
} from "../types";
import { DarkMultiSelect, DarkSelect, type DarkSelectOption } from "./DarkSelect";
import { AuthorAvatar, PriorityIcon, StateIcon } from "./Icons";
import { MarkdownBody } from "./MarkdownBody";

interface IssueDetailProps {
  issue: LinearIssue;
  meta: WorkspaceMetadata;
  viewerId: string | null;
  knownIdentifiers: Set<string>;
  onSelectIdentifier: (identifier: string) => void;
  onMarkSeen: (issueId: string) => Promise<void>;
  onMarkUnread: (issueId: string) => Promise<void>;
  onUpdateIssue: (issueId: string, patch: UpdateIssuePatch) => Promise<void>;
  onAddComment: (issueId: string, body: string) => Promise<void>;
  onRefreshIssue: (issueId: string) => Promise<void>;
  onClose?: () => void;
  timeAgo: (iso: string) => string;
}

const PRIORITY_OPTIONS: DarkSelectOption[] = [
  { value: "0", label: "No priority", icon: <PriorityIcon priority={0} /> },
  { value: "1", label: "Urgent", icon: <PriorityIcon priority={1} /> },
  { value: "2", label: "High", icon: <PriorityIcon priority={2} /> },
  { value: "3", label: "Medium", icon: <PriorityIcon priority={3} /> },
  { value: "4", label: "Low", icon: <PriorityIcon priority={4} /> },
];

export function IssueDetail({
  issue,
  meta,
  viewerId,
  knownIdentifiers,
  onSelectIdentifier,
  onMarkSeen,
  onMarkUnread,
  onUpdateIssue,
  onAddComment,
  onRefreshIssue,
  onClose,
  timeAgo,
}: IssueDetailProps) {
  const [copiedId, setCopiedId] = useState(false);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(issue.title);
  const [savingTitle, setSavingTitle] = useState(false);

  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState(issue.description ?? "");
  const [descTab, setDescTab] = useState<"write" | "preview">("write");
  const [savingDesc, setSavingDesc] = useState(false);

  const [commentDraft, setCommentDraft] = useState("");
  const [commentTab, setCommentTab] = useState<"write" | "preview">("write");
  const [postingComment, setPostingComment] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [updatingProp, setUpdatingProp] = useState(false);

  useEffect(() => {
    setEditingTitle(false);
    setTitleDraft(issue.title);
    setEditingDesc(false);
    setDescDraft(issue.description ?? "");
    setDescTab("write");
    setCommentDraft("");
    setCommentTab("write");
  }, [issue.id]);

  useEffect(() => {
    if (!editingTitle) setTitleDraft(issue.title);
  }, [issue.title, editingTitle]);

  useEffect(() => {
    if (!editingDesc) setDescDraft(issue.description ?? "");
  }, [issue.description, editingDesc]);

  const firstUnreadIdx = issue.comments.findIndex((c) => c.is_unread);

  const team = useMemo(
    () =>
      meta.teams.find(
        (t) => t.id === issue.team_id || t.key === issue.team_key
      ) ?? null,
    [meta.teams, issue.team_id, issue.team_key]
  );

  const stateOptions: DarkSelectOption[] = useMemo(() => {
    const base = (team?.states ?? []).map((s) => ({
      value: s.id,
      label: s.name,
      icon: <StateIcon stateType={s.state_type} color={s.color} />,
    }));
    if (
      issue.state_id &&
      !base.some((o) => o.value === issue.state_id)
    ) {
      base.unshift({
        value: issue.state_id,
        label: issue.state_name,
        icon: (
          <StateIcon
            stateType={issue.state_type}
            color={issue.state_color}
          />
        ),
      });
    }
    return base;
  }, [team, issue.state_id, issue.state_name, issue.state_type, issue.state_color]);

  const assigneeOptions: DarkSelectOption[] = useMemo(() => {
    const base: DarkSelectOption[] = [
      {
        value: "",
        label: "Unassigned",
        icon: <User className="h-3.5 w-3.5 text-zinc-500" />,
      },
      ...meta.users.map((u) => ({
        value: u.id,
        label: u.name,
        icon: <AuthorAvatar name={u.name} size="sm" />,
      })),
    ];
    if (
      issue.assignee_id &&
      issue.assignee_name &&
      !base.some((o) => o.value === issue.assignee_id)
    ) {
      base.push({
        value: issue.assignee_id,
        label: issue.assignee_name,
        icon: <AuthorAvatar name={issue.assignee_name} size="sm" />,
      });
    }
    return base;
  }, [meta.users, issue.assignee_id, issue.assignee_name]);

  const projectOptions: DarkSelectOption[] = useMemo(() => {
    const base: DarkSelectOption[] = [
      {
        value: "",
        label: "No project",
        icon: <FolderKanban className="h-3.5 w-3.5 text-zinc-500" />,
      },
      ...meta.projects.map((p) => ({
        value: p.id,
        label: p.name,
        icon: <FolderKanban className="h-3.5 w-3.5 text-indigo-400/80" />,
      })),
    ];
    if (
      issue.project_id &&
      issue.project_name &&
      !base.some((o) => o.value === issue.project_id)
    ) {
      base.push({
        value: issue.project_id,
        label: issue.project_name,
        icon: <FolderKanban className="h-3.5 w-3.5 text-indigo-400/80" />,
      });
    }
    return base;
  }, [meta.projects, issue.project_id, issue.project_name]);

  const labelOptions: DarkSelectOption[] = useMemo(
    () =>
      meta.labels
        .filter((l) => !l.team_id || l.team_id === (team?.id ?? issue.team_id))
        .map((l) => ({
          value: l.id,
          label: l.name,
          colorDot: l.color,
        })),
    [meta.labels, team?.id, issue.team_id]
  );

  async function handleCopyIdentifier() {
    try {
      await navigator.clipboard.writeText(issue.identifier);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 1400);
    } catch {
      // Ignore if clipboard API restricted
    }
  }

  async function applyPatch(patch: UpdateIssuePatch) {
    setUpdatingProp(true);
    try {
      await onUpdateIssue(issue.id, patch);
    } finally {
      setUpdatingProp(false);
    }
  }

  async function saveTitleEdit() {
    const trimmed = titleDraft.trim();
    if (!trimmed || trimmed === issue.title) {
      setTitleDraft(issue.title);
      setEditingTitle(false);
      return;
    }
    setSavingTitle(true);
    try {
      await onUpdateIssue(issue.id, { title: trimmed });
      setEditingTitle(false);
    } finally {
      setSavingTitle(false);
    }
  }

  async function saveDescEdit() {
    setSavingDesc(true);
    try {
      await onUpdateIssue(issue.id, { description: descDraft });
      setEditingDesc(false);
    } finally {
      setSavingDesc(false);
    }
  }

  async function submitComment() {
    const trimmed = commentDraft.trim();
    if (!trimmed || postingComment) return;
    setPostingComment(true);
    try {
      await onAddComment(issue.id, trimmed);
      setCommentDraft("");
      setCommentTab("write");
    } finally {
      setPostingComment(false);
    }
  }

  async function handleRefreshThread() {
    setRefreshing(true);
    try {
      await onRefreshIssue(issue.id);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#0D1017]">
      {/* Sticky Top Action Bar */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/8 bg-[#0D1017]/95 px-6 py-3 backdrop-blur-sm">
        <div className="flex min-w-0 items-center gap-2 text-xs text-zinc-400">
          <span className="truncate font-medium text-zinc-300">
            {issue.team_name}
          </span>
          {issue.project_name && (
            <>
              <span className="text-zinc-600">›</span>
              <span className="inline-flex items-center gap-1 truncate text-zinc-400">
                <FolderKanban className="h-3 w-3 text-zinc-500" />
                {issue.project_name}
              </span>
            </>
          )}
          <span className="text-zinc-600">›</span>
          <button
            type="button"
            onClick={() => void handleCopyIdentifier()}
            title="Copy ticket identifier"
            className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 font-mono text-[11px] font-semibold text-indigo-300 transition hover:border-indigo-500/40 hover:bg-indigo-500/15"
          >
            {issue.identifier}
            {copiedId ? (
              <Check className="h-3 w-3 text-emerald-400" />
            ) : (
              <Copy className="h-2.5 w-2.5 text-zinc-500" />
            )}
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => void handleRefreshThread()}
            disabled={refreshing}
            title="Refresh ticket & latest comments from Linear"
            className="rounded-lg border border-white/10 bg-white/[0.03] p-1.5 text-zinc-400 transition hover:border-white/20 hover:text-zinc-200 disabled:opacity-50"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
            />
          </button>

          {issue.unread_responses > 0 ? (
            <button
              type="button"
              onClick={() => void onMarkSeen(issue.id)}
              className="flex items-center gap-1.5 rounded-lg border border-emerald-500/35 bg-emerald-500/12 px-2.5 py-1.5 text-xs font-medium text-emerald-300 transition hover:bg-emerald-500/20"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Mark Seen
              <kbd className="ml-0.5 hidden rounded border border-emerald-500/30 bg-emerald-950/60 px-1 font-mono text-[9px] text-emerald-300/80 sm:inline">
                M
              </kbd>
            </button>
          ) : (
            issue.comments.length > 0 && (
              <button
                type="button"
                onClick={() => void onMarkUnread(issue.id)}
                className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-xs font-medium text-zinc-400 transition hover:border-white/20 hover:text-zinc-200"
              >
                <EyeOff className="h-3.5 w-3.5" />
                Keep Unread
              </button>
            )
          )}

          <button
            type="button"
            onClick={() => void openExternalUrl(issue.url)}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#151923] px-2.5 py-1.5 text-xs font-medium text-zinc-200 transition hover:border-indigo-500/40 hover:bg-[#1B202D]"
          >
            Open in Linear
            <ArrowUpRight className="h-3.5 w-3.5 text-zinc-400" />
            <kbd className="ml-0.5 hidden rounded border border-white/10 bg-black/40 px-1 font-mono text-[9px] text-zinc-400 sm:inline">
              O
            </kbd>
          </button>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close drawer"
              className="rounded-lg border border-white/10 bg-white/[0.03] p-1.5 text-zinc-400 transition hover:bg-white/10 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Scrollable Body */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {/* Title & Editable Properties */}
          <div className="space-y-4">
            {editingTitle ? (
              <div className="space-y-2">
                <input
                  autoFocus
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void saveTitleEdit();
                    } else if (e.key === "Escape") {
                      e.stopPropagation();
                      setTitleDraft(issue.title);
                      setEditingTitle(false);
                    }
                  }}
                  className="w-full rounded-lg border border-indigo-500/60 bg-[#090B10] px-3 py-2 text-lg font-semibold text-white focus:outline-none"
                />
                <div className="flex items-center gap-2 text-xs">
                  <button
                    type="button"
                    disabled={savingTitle}
                    onClick={() => void saveTitleEdit()}
                    className="rounded-md bg-indigo-600 px-3 py-1 font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                  >
                    {savingTitle ? "Saving..." : "Save Title"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTitleDraft(issue.title);
                      setEditingTitle(false);
                    }}
                    className="rounded-md border border-white/10 px-2.5 py-1 text-zinc-300 hover:bg-white/5"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="group flex items-start justify-between gap-3">
                <h1
                  onClick={() => setEditingTitle(true)}
                  title="Click to edit title"
                  className="cursor-text text-xl font-semibold tracking-tight text-white transition hover:text-indigo-100"
                >
                  {issue.title}
                </h1>
                <button
                  type="button"
                  onClick={() => setEditingTitle(true)}
                  title="Edit title"
                  className="mt-1 shrink-0 rounded-md p-1 text-zinc-500 opacity-0 transition hover:bg-white/5 hover:text-zinc-200 group-hover:opacity-100"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {/* Interactive Properties Bar */}
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/8 bg-[#12151E] px-3 py-2.5 text-xs">
              {stateOptions.length > 0 ? (
                <DarkSelect
                  value={issue.state_id}
                  options={stateOptions}
                  onChange={(stateId) => void applyPatch({ state_id: stateId })}
                  disabled={updatingProp}
                  compact
                />
              ) : (
                <div className="flex items-center gap-1.5 px-1.5">
                  <StateIcon
                    stateType={issue.state_type}
                    color={issue.state_color}
                  />
                  <span className="font-medium text-zinc-200">
                    {issue.state_name}
                  </span>
                </div>
              )}

              <DarkSelect
                value={String(issue.priority)}
                options={PRIORITY_OPTIONS}
                onChange={(val) => void applyPatch({ priority: Number(val) })}
                disabled={updatingProp}
                compact
              />

              <DarkSelect
                value={issue.assignee_id ?? ""}
                options={assigneeOptions}
                onChange={(assigneeId) =>
                  void applyPatch({ assignee_id: assigneeId })
                }
                placeholder="Unassigned"
                disabled={updatingProp}
                compact
              />

              <DarkSelect
                value={issue.project_id ?? ""}
                options={projectOptions}
                onChange={(projectId) =>
                  void applyPatch({ project_id: projectId })
                }
                placeholder="No project"
                disabled={updatingProp}
                compact
              />

              {labelOptions.length > 0 && (
                <DarkMultiSelect
                  values={issue.label_ids}
                  options={labelOptions}
                  onChange={(labelIds) =>
                    void applyPatch({ label_ids: labelIds })
                  }
                  placeholder="Add labels"
                  disabled={updatingProp}
                  compact
                />
              )}

              <span className="ml-auto text-[11px] text-zinc-500">
                Updated {timeAgo(issue.updated_at)}
              </span>
            </div>

            {issue.labels.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {issue.labels.map((label) => (
                  <span
                    key={label}
                    className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-0.5 text-[11px] font-medium text-zinc-300"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-indigo-400/80" />
                    {label}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Description */}
          <div className="rounded-xl border border-white/8 bg-[#12151E] p-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                Description
              </div>
              {!editingDesc && (
                <button
                  type="button"
                  onClick={() => {
                    setDescDraft(issue.description ?? "");
                    setDescTab("write");
                    setEditingDesc(true);
                  }}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium text-zinc-400 transition hover:bg-white/5 hover:text-zinc-200"
                >
                  <Pencil className="h-3 w-3" />
                  Edit
                </button>
              )}
            </div>

            {editingDesc ? (
              <div className="space-y-3">
                <div className="overflow-hidden rounded-lg border border-white/10 bg-[#090B10]">
                  <div className="flex items-center justify-between border-b border-white/8 px-3 py-1.5">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setDescTab("write")}
                        className={`rounded px-2 py-0.5 text-[11px] font-medium transition ${
                          descTab === "write"
                            ? "bg-white/10 text-white"
                            : "text-zinc-400 hover:text-zinc-200"
                        }`}
                      >
                        Write
                      </button>
                      <button
                        type="button"
                        onClick={() => setDescTab("preview")}
                        className={`rounded px-2 py-0.5 text-[11px] font-medium transition ${
                          descTab === "preview"
                            ? "bg-white/10 text-white"
                            : "text-zinc-400 hover:text-zinc-200"
                        }`}
                      >
                        Preview
                      </button>
                    </div>
                    <span className="text-[10px] text-zinc-500">
                      Ctrl+Enter to save
                    </span>
                  </div>

                  {descTab === "write" ? (
                    <textarea
                      rows={8}
                      autoFocus
                      value={descDraft}
                      onChange={(e) => setDescDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                          e.preventDefault();
                          void saveDescEdit();
                        } else if (e.key === "Escape") {
                          e.stopPropagation();
                          setDescDraft(issue.description ?? "");
                          setEditingDesc(false);
                        }
                      }}
                      className="w-full resize-y bg-transparent p-3 text-xs leading-relaxed text-zinc-200 focus:outline-none"
                    />
                  ) : (
                    <div className="min-h-[160px] p-3">
                      {descDraft.trim() ? (
                        <MarkdownBody
                          content={descDraft}
                          knownIdentifiers={knownIdentifiers}
                          onSelectIdentifier={onSelectIdentifier}
                        />
                      ) : (
                        <p className="text-xs italic text-zinc-500">
                          Nothing to preview.
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setDescDraft(issue.description ?? "");
                      setEditingDesc(false);
                    }}
                    className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-white/5"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={savingDesc}
                    onClick={() => void saveDescEdit()}
                    className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                  >
                    {savingDesc ? "Saving..." : "Save Description"}
                  </button>
                </div>
              </div>
            ) : issue.description?.trim() ? (
              <MarkdownBody
                content={issue.description}
                knownIdentifiers={knownIdentifiers}
                onSelectIdentifier={onSelectIdentifier}
              />
            ) : (
              <p className="text-xs italic text-zinc-500">
                No description provided.
              </p>
            )}
          </div>

          {/* Responses & Comments Timeline */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                <MessageSquare className="h-3.5 w-3.5" />
                Responses & Comments ({issue.comments.length})
              </div>
              {issue.unread_responses > 0 && (
                <span className="rounded-full border border-indigo-500/30 bg-indigo-500/15 px-2 py-0.5 text-[10px] font-semibold text-indigo-300">
                  {issue.unread_responses} unread
                </span>
              )}
            </div>

            {issue.comments.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/10 bg-[#12151E]/60 p-6 text-center text-xs text-zinc-500">
                No comments on this ticket yet.
              </div>
            ) : (
              <div className="space-y-3">
                {issue.comments.map((c, idx) => {
                  const isYou = Boolean(viewerId && c.author_id === viewerId);
                  return (
                    <div key={c.id}>
                      {idx === firstUnreadIdx && (
                        <div className="my-3 flex items-center gap-3">
                          <div className="h-px flex-1 bg-indigo-500/35" />
                          <span className="text-[10px] font-semibold uppercase tracking-widest text-indigo-400">
                            Unread Responses
                          </span>
                          <div className="h-px flex-1 bg-indigo-500/35" />
                        </div>
                      )}
                      <div
                        className={`rounded-xl border p-4 transition ${
                          c.is_unread
                            ? "border-indigo-500/40 bg-indigo-500/[0.07] shadow-[0_0_0_1px_rgba(99,102,241,0.1)]"
                            : "border-white/8 bg-[#12151E]"
                        }`}
                      >
                        <div className="mb-2.5 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <AuthorAvatar name={c.author_name} size="md" />
                            <span className="text-xs font-semibold text-zinc-100">
                              {c.author_name}
                            </span>
                            {isYou && (
                              <span className="rounded border border-white/10 bg-white/[0.05] px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
                                You
                              </span>
                            )}
                            {c.is_unread && (
                              <span className="rounded-full bg-indigo-500 px-2 py-0.5 text-[10px] font-semibold text-white">
                                New Reply
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] text-zinc-500">
                            {timeAgo(c.created_at)}
                          </span>
                        </div>
                        <MarkdownBody
                          content={c.body}
                          knownIdentifiers={knownIdentifiers}
                          onSelectIdentifier={onSelectIdentifier}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Inline Reply Composer */}
            <div className="overflow-hidden rounded-xl border border-white/10 bg-[#10131B]">
              <div className="flex items-center justify-between border-b border-white/8 px-3.5 py-2">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setCommentTab("write")}
                    className={`rounded px-2 py-0.5 text-[11px] font-medium transition ${
                      commentTab === "write"
                        ? "bg-white/10 text-white"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    Write Reply
                  </button>
                  <button
                    type="button"
                    onClick={() => setCommentTab("preview")}
                    className={`rounded px-2 py-0.5 text-[11px] font-medium transition ${
                      commentTab === "preview"
                        ? "bg-white/10 text-white"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    Preview
                  </button>
                </div>
                <span className="text-[10px] text-zinc-500">
                  Posts directly to Linear & marks seen
                </span>
              </div>

              {commentTab === "write" ? (
                <textarea
                  rows={3}
                  value={commentDraft}
                  onChange={(e) => setCommentDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                      e.preventDefault();
                      void submitComment();
                    }
                  }}
                  placeholder="Write a Markdown comment... (Ctrl+Enter to post)"
                  className="w-full resize-y bg-[#090B10]/60 p-3.5 text-xs leading-relaxed text-zinc-200 placeholder:text-zinc-500 focus:outline-none"
                />
              ) : (
                <div className="min-h-[86px] bg-[#090B10]/60 p-3.5">
                  {commentDraft.trim() ? (
                    <MarkdownBody
                      content={commentDraft}
                      knownIdentifiers={knownIdentifiers}
                      onSelectIdentifier={onSelectIdentifier}
                    />
                  ) : (
                    <p className="text-xs italic text-zinc-500">
                      Nothing to preview.
                    </p>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between border-t border-white/8 bg-[#0C0F16] px-3.5 py-2">
                <span className="text-[10px] text-zinc-500">
                  <kbd className="rounded border border-white/10 bg-white/[0.04] px-1 font-mono text-zinc-400">
                    Ctrl+Enter
                  </kbd>{" "}
                  to send
                </span>
                <button
                  type="button"
                  disabled={!commentDraft.trim() || postingComment}
                  onClick={() => void submitComment()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
                >
                  <Send className="h-3 w-3" />
                  {postingComment ? "Sending..." : "Comment"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
