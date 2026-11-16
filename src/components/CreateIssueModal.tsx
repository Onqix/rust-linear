import React, { useEffect, useMemo, useRef, useState } from "react";
import { FolderKanban, Plus, User, X } from "lucide-react";
import type { CreateIssueInput, WorkspaceMetadata } from "../types";
import { DarkMultiSelect, DarkSelect, type DarkSelectOption } from "./DarkSelect";
import { PriorityIcon, StateIcon } from "./Icons";
import { MarkdownBody } from "./MarkdownBody";

interface CreateIssueModalProps {
  meta: WorkspaceMetadata;
  defaultTeamKey: string;
  viewerId: string | null;
  knownIdentifiers: Set<string>;
  onSelectIdentifier: (identifier: string) => void;
  onCreate: (input: CreateIssueInput) => Promise<void>;
  onClose: () => void;
}

const PRIORITY_OPTIONS: DarkSelectOption[] = [
  { value: "0", label: "No priority", icon: <PriorityIcon priority={0} /> },
  { value: "1", label: "Urgent", icon: <PriorityIcon priority={1} /> },
  { value: "2", label: "High", icon: <PriorityIcon priority={2} /> },
  { value: "3", label: "Medium", icon: <PriorityIcon priority={3} /> },
  { value: "4", label: "Low", icon: <PriorityIcon priority={4} /> },
];

export function CreateIssueModal({
  meta,
  defaultTeamKey,
  viewerId,
  knownIdentifiers,
  onSelectIdentifier,
  onCreate,
  onClose,
}: CreateIssueModalProps) {
  const initialTeam =
    meta.teams.find((t) => t.key === defaultTeamKey) ?? meta.teams[0];

  const [teamId, setTeamId] = useState(initialTeam?.id ?? "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [descTab, setDescTab] = useState<"write" | "preview">("write");
  const [stateId, setStateId] = useState(() => {
    const t = initialTeam;
    if (!t) return "";
    return (
      t.states.find((s) => s.state_type === "unstarted")?.id ??
      t.states[0]?.id ??
      ""
    );
  });
  const [priority, setPriority] = useState("0");
  const [assigneeId, setAssigneeId] = useState(viewerId ?? "");
  const [projectId, setProjectId] = useState("");
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    titleInputRef.current?.focus();
  }, []);

  const selectedTeam = useMemo(
    () => meta.teams.find((t) => t.id === teamId) ?? meta.teams[0],
    [meta.teams, teamId]
  );

  useEffect(() => {
    if (!selectedTeam) return;
    const valid = selectedTeam.states.some((s) => s.id === stateId);
    if (!valid) {
      const def =
        selectedTeam.states.find((s) => s.state_type === "unstarted")?.id ??
        selectedTeam.states[0]?.id ??
        "";
      setStateId(def);
    }
    setLabelIds((prev) =>
      prev.filter((id) => {
        const lbl = meta.labels.find((l) => l.id === id);
        return !lbl?.team_id || lbl.team_id === selectedTeam.id;
      })
    );
  }, [selectedTeam, stateId, meta.labels]);

  const teamOptions: DarkSelectOption[] = useMemo(
    () =>
      meta.teams.map((t) => ({
        value: t.id,
        label: `${t.key} · ${t.name}`,
      })),
    [meta.teams]
  );

  const stateOptions: DarkSelectOption[] = useMemo(
    () =>
      (selectedTeam?.states ?? []).map((s) => ({
        value: s.id,
        label: s.name,
        icon: <StateIcon stateType={s.state_type} color={s.color} />,
      })),
    [selectedTeam]
  );

  const assigneeOptions: DarkSelectOption[] = useMemo(
    () => [
      {
        value: "",
        label: "Unassigned",
        icon: <User className="h-3.5 w-3.5 text-zinc-500" />,
      },
      ...meta.users.map((u) => ({
        value: u.id,
        label: u.name,
      })),
    ],
    [meta.users]
  );

  const projectOptions: DarkSelectOption[] = useMemo(
    () => [
      {
        value: "",
        label: "No project",
        icon: <FolderKanban className="h-3.5 w-3.5 text-zinc-500" />,
      },
      ...meta.projects.map((p) => ({
        value: p.id,
        label: p.name,
      })),
    ],
    [meta.projects]
  );

  const labelOptions: DarkSelectOption[] = useMemo(
    () =>
      meta.labels
        .filter((l) => !l.team_id || l.team_id === selectedTeam?.id)
        .map((l) => ({
          value: l.id,
          label: l.name,
          colorDot: l.color,
        })),
    [meta.labels, selectedTeam?.id]
  );

  async function submitForm() {
    if (!teamId || !title.trim() || submitting) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      await onCreate({
        team_id: teamId,
        title: title.trim(),
        description: description.trim() ? description : null,
        state_id: stateId || null,
        priority: Number(priority),
        assignee_id: assigneeId || null,
        project_id: projectId || null,
        label_ids: labelIds.length > 0 ? labelIds : null,
      });
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <form
        onSubmit={handleSubmit}
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/12 bg-[#10131B] shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-white/8 px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="text-xs font-semibold text-zinc-200">
              New Linear Issue
            </span>
            {teamOptions.length > 0 && (
              <DarkSelect
                value={teamId}
                options={teamOptions}
                onChange={setTeamId}
                compact
              />
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-zinc-400 transition hover:bg-white/5 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {meta.teams.length === 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              Sync Linear first so teams, workflow states, and users are loaded.
            </div>
          )}

          {submitError && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
              {submitError}
            </div>
          )}

          <input
            ref={titleInputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                void submitForm();
              }
            }}
            placeholder="Issue title..."
            className="w-full rounded-lg border border-white/10 bg-[#090B10] px-3.5 py-2.5 text-sm font-medium text-white placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none"
          />

          <div className="overflow-hidden rounded-xl border border-white/10 bg-[#090B10]">
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
                Markdown supported
              </span>
            </div>

            {descTab === "write" ? (
              <textarea
                rows={6}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                    e.preventDefault();
                    void submitForm();
                  }
                }}
                placeholder="Add description, acceptance criteria, or links..."
                className="w-full resize-y bg-transparent p-3 text-xs leading-relaxed text-zinc-200 placeholder:text-zinc-500 focus:outline-none"
              />
            ) : (
              <div className="min-h-[140px] p-3">
                {description.trim() ? (
                  <MarkdownBody
                    content={description}
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

          <div className="flex flex-wrap items-center gap-2 pt-1">
            {stateOptions.length > 0 && (
              <DarkSelect
                value={stateId}
                options={stateOptions}
                onChange={setStateId}
                placeholder="Status"
                compact
              />
            )}
            <DarkSelect
              value={priority}
              options={PRIORITY_OPTIONS}
              onChange={setPriority}
              compact
            />
            <DarkSelect
              value={assigneeId}
              options={assigneeOptions}
              onChange={setAssigneeId}
              placeholder="Assignee"
              compact
            />
            <DarkSelect
              value={projectId}
              options={projectOptions}
              onChange={setProjectId}
              placeholder="Project"
              compact
            />
            {labelOptions.length > 0 && (
              <DarkMultiSelect
                values={labelIds}
                options={labelOptions}
                onChange={setLabelIds}
                placeholder="Labels"
                compact
              />
            )}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-white/8 bg-[#0B0D13] px-5 py-3">
          <span className="text-[11px] text-zinc-500">
            <kbd className="rounded border border-white/10 bg-white/[0.04] px-1 font-mono text-zinc-400">
              Ctrl+Enter
            </kbd>{" "}
            to create
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-zinc-300 transition hover:bg-white/5"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!teamId || !title.trim() || submitting}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              {submitting ? "Creating..." : "Create Issue"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
