import React, { useMemo, useState } from "react";
import { Columns3, List as ListIcon, Plus, Trash2, X } from "lucide-react";
import type {
  BoardColumnConfig,
  FilterField,
  FilterMatchMode,
  FilterOperator,
  FilterRule,
  LayoutMode,
  LinearIssue,
  SavedView,
  ScopeFilter,
  WorkspaceMetadata,
} from "../types";
import {
  FILTER_FIELDS,
  VIEW_COLOR_OPTIONS,
  applyBoardColumnConfig,
  formatOperatorMenuLabel,
  getCanonicalBoardColumnSpecs,
  getFieldMeta,
  isUnaryOperator,
  matchesSavedView,
  parseBoardColumnConfig,
  parseSavedViewRules,
  serializeBoardColumnConfig,
  serializeRulesForView,
} from "../lib/viewFilters";
import { DarkSelect, type DarkSelectOption } from "./DarkSelect";
import {
  BoardColumnsChecklist,
  FieldIcon,
  RuleValuesPicker,
} from "./FilterPickerControls";

const SCOPE_SELECT_OPTIONS: DarkSelectOption[] = [
  { value: "all", label: "All tickets" },
  { value: "active", label: "Active (not Completed/Canceled)" },
  { value: "started", label: "In Progress only" },
  { value: "backlog", label: "Backlog & Triage" },
  { value: "completed", label: "Completed only" },
  { value: "mine", label: "Assigned to me" },
];

interface CustomViewModalProps {
  issues: LinearIssue[];
  meta: WorkspaceMetadata;
  viewerName?: string | null;
  initialView: SavedView | null;
  seedState: {
    teamFilter: string;
    scopeFilter: ScopeFilter;
    search: string;
    layoutMode: LayoutMode;
    rules: FilterRule[];
    matchMode: FilterMatchMode;
    boardConfig: BoardColumnConfig;
  };
  onSave: (view: SavedView) => Promise<void>;
  onClose: () => void;
}

export function CustomViewModal({
  issues,
  meta,
  viewerName,
  initialView,
  seedState,
  onSave,
  onClose,
}: CustomViewModalProps) {
  const initialParsed = useMemo(
    () => (initialView ? parseSavedViewRules(initialView) : null),
    [initialView]
  );

  const [name, setName] = useState(initialView?.name ?? "");
  const [iconColor, setIconColor] = useState(initialView?.icon || "indigo");
  const [scopeFilter, setScopeFilter] = useState<string>(
    initialView?.scope_filter || seedState.scopeFilter
  );
  const [teamFilter, setTeamFilter] = useState<string>(
    initialView?.team_filter || seedState.teamFilter
  );
  const [searchQuery, setSearchQuery] = useState<string>(
    initialView?.search_query ?? seedState.search
  );
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(
    (initialView?.layout_mode || seedState.layoutMode) === "board"
      ? "board"
      : "list"
  );
  const [matchMode, setMatchMode] = useState<FilterMatchMode>(
    initialParsed?.matchMode ?? seedState.matchMode
  );
  const [rules, setRules] = useState<FilterRule[]>(() => {
    const src = initialParsed ? initialParsed.rules : seedState.rules;
    return src.map((r) => ({ ...r, values: [...r.values] }));
  });
  const [boardConfig, setBoardConfig] = useState<BoardColumnConfig>(() =>
    initialView
      ? parseBoardColumnConfig(initialView.board_columns_json)
      : {
          hiddenColumns: [...seedState.boardConfig.hiddenColumns],
          columnOrder: [...seedState.boardConfig.columnOrder],
        }
  );
  const [showBoardColsSection, setShowBoardColsSection] = useState(
    () =>
      layoutMode === "board" ||
      (initialView
        ? parseBoardColumnConfig(initialView.board_columns_json).hiddenColumns
            .length > 0 ||
          parseBoardColumnConfig(initialView.board_columns_json).columnOrder
            .length > 0
        : seedState.boardConfig.hiddenColumns.length > 0 ||
          seedState.boardConfig.columnOrder.length > 0)
  );
  const [saving, setSaving] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const { orderedAll: orderedBoardCols, hiddenSet: hiddenBoardSet } = useMemo(
    () =>
      applyBoardColumnConfig(
        getCanonicalBoardColumnSpecs(meta, teamFilter),
        boardConfig
      ),
    [meta, teamFilter, boardConfig]
  );

  const teamSelectOptions: DarkSelectOption[] = useMemo(
    () => [
      { value: "ALL", label: "All teams" },
      ...meta.teams.map((t) => ({
        value: t.key,
        label: `${t.key} — ${t.name}`,
      })),
    ],
    [meta.teams]
  );

  const fieldOptions: DarkSelectOption[] = useMemo(
    () =>
      FILTER_FIELDS.map((f) => ({
        value: f.field,
        label: f.label,
        icon: <FieldIcon field={f.field} className="h-3.5 w-3.5" />,
      })),
    []
  );

  const draftView: SavedView = useMemo(
    () => ({
      id: initialView?.id || `view-${Date.now()}`,
      name: name.trim() || "Untitled View",
      icon: iconColor,
      match_mode: matchMode,
      filters_json: serializeRulesForView(rules),
      board_columns_json: serializeBoardColumnConfig(boardConfig),
      team_filter: teamFilter,
      scope_filter: scopeFilter,
      assignee_filter: "ALL",
      project_filter: "ALL",
      label_filter: "ALL",
      search_query: searchQuery,
      layout_mode: layoutMode,
      created_at: initialView?.created_at,
    }),
    [
      initialView,
      name,
      iconColor,
      matchMode,
      rules,
      boardConfig,
      teamFilter,
      scopeFilter,
      searchQuery,
      layoutMode,
    ]
  );

  const previewMatches = useMemo(
    () => issues.filter((i) => matchesSavedView(i, draftView, viewerName)),
    [issues, draftView, viewerName]
  );

  function addConditionRow() {
    setRules((prev) => [
      ...prev,
      {
        id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        field: "priority",
        operator: "is",
        values: [],
      },
    ]);
  }

  function updateConditionField(id: string, nextField: FilterField) {
    const fMeta = getFieldMeta(nextField);
    setRules((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              field: nextField,
              operator: fMeta.defaultOperator,
              values: [],
            }
          : r
      )
    );
  }

  function updateConditionOperator(id: string, op: FilterOperator) {
    setRules((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              operator: op,
              values: isUnaryOperator(op) ? [] : r.values,
            }
          : r
      )
    );
  }

  function updateConditionValues(id: string, values: string[]) {
    setRules((prev) =>
      prev.map((r) => (r.id === id ? { ...r, values } : r))
    );
  }

  function removeCondition(id: string) {
    setRules((prev) => prev.filter((r) => r.id !== id));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setErrMsg("Please enter a name for this custom view.");
      return;
    }
    setErrMsg(null);
    setSaving(true);
    try {
      await onSave({
        ...draftView,
        name: name.trim(),
      });
    } catch (err) {
      setErrMsg(String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/12 bg-[#10131B] shadow-2xl shadow-black/90"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/8 px-6 py-4">
          <div>
            <h2 className="text-sm font-semibold text-white">
              {initialView ? "Edit Custom View" : "New Custom View"}
            </h2>
            <p className="mt-0.5 text-[11px] text-zinc-400">
              Compose Linear-style filters with{" "}
              <span className="text-indigo-300">is</span>,{" "}
              <span className="text-indigo-300">is not</span>,{" "}
              <span className="text-indigo-300">includes all</span>,{" "}
              <span className="text-indigo-300">is set</span>, and keyword rules.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-zinc-400 transition hover:bg-white/5 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {errMsg && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/12 px-3 py-2 text-xs text-rose-200">
              {errMsg}
            </div>
          )}

          {/* Name + Color + Layout */}
          <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-300">
                View Name
              </label>
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Urgent Bugs Not Done"
                  className="w-full rounded-lg border border-white/10 bg-[#090B10] px-3 py-2 text-xs text-white placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div className="flex items-center gap-1.5 pt-1">
                <span className="mr-1 text-[10px] text-zinc-500">Color:</span>
                {VIEW_COLOR_OPTIONS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    title={c.label}
                    onClick={() => setIconColor(c.id)}
                    className={`flex h-5 w-5 items-center justify-center rounded-full border transition ${
                      iconColor === c.id
                        ? "border-white scale-110"
                        : "border-white/10 opacity-65 hover:opacity-100"
                    }`}
                  >
                    <span className={`h-2.5 w-2.5 rounded-full ${c.dotClass}`} />
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-zinc-300">
                Default Layout
              </label>
              <div className="flex items-center rounded-lg border border-white/10 bg-[#090B10] p-1">
                <button
                  type="button"
                  onClick={() => setLayoutMode("list")}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition ${
                    layoutMode === "list"
                      ? "bg-white/12 text-white"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  <ListIcon className="h-3.5 w-3.5" />
                  List
                </button>
                <button
                  type="button"
                  onClick={() => setLayoutMode("board")}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition ${
                    layoutMode === "board"
                      ? "bg-white/12 text-white"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  <Columns3 className="h-3.5 w-3.5" />
                  Board
                </button>
              </div>
            </div>
          </div>

          {/* Scope + Team + Keyword */}
          <div className="grid gap-3 rounded-xl border border-white/8 bg-[#0B0D14] p-3.5 sm:grid-cols-3">
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-zinc-400">
                Base Scope
              </label>
              <DarkSelect
                value={scopeFilter}
                options={SCOPE_SELECT_OPTIONS}
                onChange={setScopeFilter}
                fullWidth
                compact
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-zinc-400">
                Team
              </label>
              <DarkSelect
                value={teamFilter}
                options={teamSelectOptions}
                onChange={setTeamFilter}
                fullWidth
                compact
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-zinc-400">
                Search Text (optional)
              </label>
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Contains text..."
                className="w-full rounded-lg border border-white/10 bg-[#12151F] px-2.5 py-1 text-[11px] text-white placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Filter Conditions Builder */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-zinc-200">
                  Filter Conditions
                </span>
                <div className="inline-flex rounded-lg border border-white/10 bg-[#090B10] p-0.5 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setMatchMode("all")}
                    className={`rounded-md px-2 py-0.5 font-medium transition ${
                      matchMode === "all"
                        ? "bg-indigo-600 text-white"
                        : "text-zinc-400 hover:text-white"
                    }`}
                  >
                    Match All (AND)
                  </button>
                  <button
                    type="button"
                    onClick={() => setMatchMode("any")}
                    className={`rounded-md px-2 py-0.5 font-medium transition ${
                      matchMode === "any"
                        ? "bg-indigo-600 text-white"
                        : "text-zinc-400 hover:text-white"
                    }`}
                  >
                    Match Any (OR)
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={addConditionRow}
                className="inline-flex items-center gap-1 rounded-lg border border-indigo-500/35 bg-indigo-500/15 px-2.5 py-1 text-[11px] font-medium text-indigo-200 transition hover:bg-indigo-500/25"
              >
                <Plus className="h-3 w-3" />
                Add Condition
              </button>
            </div>

            {rules.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/12 bg-[#0A0C12] px-4 py-5 text-center text-xs text-zinc-500">
                No extra filter rules added yet. Click{" "}
                <span className="font-medium text-indigo-300">
                  Add Condition
                </span>{" "}
                to add <span className="text-zinc-300">is</span>,{" "}
                <span className="text-zinc-300">is not</span>,{" "}
                <span className="text-zinc-300">includes all</span>, or{" "}
                <span className="text-zinc-300">is set</span> filters.
              </div>
            ) : (
              <div className="space-y-2">
                {rules.map((rule) => {
                  const fMeta = getFieldMeta(rule.field);
                  const operatorOptions: DarkSelectOption[] =
                    fMeta.operators.map((op) => ({
                      value: op,
                      label: formatOperatorMenuLabel(rule.field, op),
                    }));
                  return (
                    <div
                      key={rule.id}
                      className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-[#0B0D14] p-2.5"
                    >
                      <DarkSelect
                        value={rule.field}
                        options={fieldOptions}
                        onChange={(val) =>
                          updateConditionField(rule.id, val as FilterField)
                        }
                        compact
                      />

                      <DarkSelect
                        value={rule.operator}
                        options={operatorOptions}
                        onChange={(val) =>
                          updateConditionOperator(
                            rule.id,
                            val as FilterOperator
                          )
                        }
                        compact
                      />

                      {!isUnaryOperator(rule.operator) && (
                        <div className="min-w-[150px] flex-1 rounded-lg border border-white/10 bg-[#12151F]">
                          <RuleValuesPicker
                            rule={rule}
                            issues={issues}
                            meta={meta}
                            viewerName={viewerName}
                            onChangeValues={(vals) =>
                              updateConditionValues(rule.id, vals)
                            }
                            className="w-full py-0.5"
                          />
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={() => removeCondition(rule.id)}
                        title="Remove condition"
                        className="ml-auto rounded-lg p-1.5 text-zinc-500 transition hover:bg-white/5 hover:text-rose-300"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Board Columns Visibility & Order */}
          <div className="rounded-xl border border-white/8 bg-[#0B0D14] p-3.5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-200">
                  <Columns3 className="h-3.5 w-3.5 text-indigo-400" />
                  Board Columns & Ordering
                </div>
                <p className="mt-0.5 text-[11px] text-zinc-500">
                  {orderedBoardCols.length - hiddenBoardSet.size} of{" "}
                  {orderedBoardCols.length} columns visible
                  {hiddenBoardSet.size > 0
                    ? ` (${hiddenBoardSet.size} hidden)`
                    : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowBoardColsSection((p) => !p)}
                className="rounded-lg border border-white/10 bg-[#12151F] px-2.5 py-1 text-[11px] font-medium text-zinc-300 hover:border-indigo-500/40 hover:text-white"
              >
                {showBoardColsSection ? "Collapse" : "Configure Columns"}
              </button>
            </div>

            {showBoardColsSection && (
              <div className="mt-3 rounded-lg border border-white/8 bg-[#090B10] p-1.5">
                <BoardColumnsChecklist
                  orderedColumns={orderedBoardCols}
                  hiddenSet={hiddenBoardSet}
                  boardConfig={boardConfig}
                  onChangeBoardConfig={setBoardConfig}
                />
              </div>
            )}
          </div>

          {/* Live Preview Strip */}
          <div className="rounded-xl border border-indigo-500/25 bg-indigo-500/[0.06] px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-medium text-indigo-200">
                Live Preview:{" "}
                <span className="font-mono text-white">
                  {previewMatches.length}
                </span>{" "}
                {previewMatches.length === 1 ? "ticket matches" : "tickets match"}
              </span>
              {previewMatches.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {previewMatches.slice(0, 4).map((m) => (
                    <span
                      key={m.id}
                      className="rounded border border-white/10 bg-[#090B10] px-1.5 py-0.5 font-mono text-[10px] text-zinc-300"
                    >
                      {m.identifier}
                    </span>
                  ))}
                  {previewMatches.length > 4 && (
                    <span className="text-[10px] text-zinc-400">
                      +{previewMatches.length - 4} more
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-white/8 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-white/10 px-3.5 py-1.5 text-xs font-medium text-zinc-300 hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !name.trim()}
            className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-medium text-white shadow-sm shadow-indigo-950/60 transition hover:bg-indigo-500 disabled:opacity-50"
          >
            {saving
              ? "Saving..."
              : initialView
              ? "Save Changes"
              : "Create View"}
          </button>
        </div>
      </form>
    </div>
  );
}
