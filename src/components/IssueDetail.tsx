import { useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import {
  ArrowUpRight,
  Check,
  CheckCheck,
  Copy,
  EyeOff,
  FolderKanban,
  MessageSquare,
  X,
} from "lucide-react";
import type { LinearIssue } from "../types";
import { AuthorAvatar, PriorityIcon, StateIcon } from "./Icons";
import { MarkdownBody } from "./MarkdownBody";

interface IssueDetailProps {
  issue: LinearIssue;
  viewerId: string | null;
  knownIdentifiers: Set<string>;
  onSelectIdentifier: (identifier: string) => void;
  onMarkSeen: (issueId: string) => Promise<void>;
  onMarkUnread: (issueId: string) => Promise<void>;
  onClose?: () => void;
  timeAgo: (iso: string) => string;
}

export function IssueDetail({
  issue,
  viewerId,
  knownIdentifiers,
  onSelectIdentifier,
  onMarkSeen,
  onMarkUnread,
  onClose,
  timeAgo,
}: IssueDetailProps) {
  const [copiedId, setCopiedId] = useState(false);

  const firstUnreadIdx = issue.comments.findIndex((c) => c.is_unread);

  async function handleCopyIdentifier() {
    try {
      await navigator.clipboard.writeText(issue.identifier);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 1400);
    } catch {
      // Ignore if clipboard API restricted
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
            onClick={() => void openExternal(issue.url)}
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
          {/* Title & Properties */}
          <div className="space-y-4">
            <h1 className="text-xl font-semibold tracking-tight text-white">
              {issue.title}
            </h1>

            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/8 bg-[#12151E] px-3.5 py-2.5 text-xs">
              <div className="flex items-center gap-1.5 pr-2">
                <StateIcon
                  stateType={issue.state_type}
                  color={issue.state_color}
                />
                <span className="font-medium text-zinc-200">
                  {issue.state_name}
                </span>
              </div>

              <span className="h-3.5 w-px bg-white/10" />

              <div className="flex items-center gap-1.5 px-2">
                <PriorityIcon priority={issue.priority} />
                <span className="text-zinc-300">
                  {issue.priority_label || "No priority"}
                </span>
              </div>

              <span className="h-3.5 w-px bg-white/10" />

              <div className="flex items-center gap-1.5 px-2">
                {issue.assignee_name ? (
                  <>
                    <AuthorAvatar name={issue.assignee_name} size="sm" />
                    <span className="text-zinc-200">{issue.assignee_name}</span>
                  </>
                ) : (
                  <span className="text-zinc-500">Unassigned</span>
                )}
              </div>

              {issue.project_name && (
                <>
                  <span className="h-3.5 w-px bg-white/10" />
                  <div className="flex items-center gap-1.5 px-2 text-zinc-300">
                    <FolderKanban className="h-3.5 w-3.5 text-indigo-400/80" />
                    <span>{issue.project_name}</span>
                  </div>
                </>
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
            <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
              Description
            </div>
            {issue.description?.trim() ? (
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
          </div>
        </div>
      </div>
    </div>
  );
}
