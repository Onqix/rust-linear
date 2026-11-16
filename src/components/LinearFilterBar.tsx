import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronRight, ListFilter, Search, X } from "lucide-react";
import type {
  FilterField,
  FilterMatchMode,
  FilterOperator,
  FilterRule,
  LinearIssue,
  ScopeFilter,
  WorkspaceMetadata,
} from "../types";
import {
  FILTER_FIELDS,
  buildFieldOptions,
  formatOperatorLabel,
  formatOperatorMenuLabel,
  getFieldMeta,
  isUnaryOperator,
} from "../lib/viewFilters";
import {
  FieldIcon,
  FilterValueChecklist,
  RuleValuesPicker,
} from "./FilterPickerControls";

const SCOPE_OPTIONS: { id: ScopeFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "started", label: "In Progress" },
  { id: "backlog", label: "Backlog" },
  { id: "completed", label: "Done" },
  { id: "mine", label: "Mine" },
];

interface LinearFilterBarProps {
  issues: LinearIssue[];
  meta: WorkspaceMetadata;
  viewerName?: string | null;
  scopeFilter: ScopeFilter;
  onChangeScope: (scope: ScopeFilter) => void;
  teamFilter: string;
  onClearTeamFilter: () => void;
  rules: FilterRule[];
  onChangeRules: (nextRules: FilterRule[]) => void;
  matchMode: FilterMatchMode;
  onChangeMatchMode: (mode: FilterMatchMode) => void;
  hasAnyFilters: boolean;
  onResetAll: () => void;
  openSignal: number;
}

function OperatorPillSelector({
  rule,
  onSelectOperator,
}: {
  rule: FilterRule;
  onSelectOperator: (op: FilterOperator) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const meta = getFieldMeta(rule.field);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    }
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="h-full border-r border-white/10 bg-white/[0.02] px-2 py-1 text-[11px] font-medium text-indigo-300 transition hover:bg-indigo-500/15 hover:text-indigo-200"
      >
        {formatOperatorLabel(rule.field, rule.operator, rule.values.length)}
      </button>
      {open && (
        <div className="absolute left-0 z-50 mt-1.5 min-w-[165px] overflow-hidden rounded-xl border border-white/12 bg-[#11141E] p-1 shadow-2xl shadow-black/80">
          {meta.operators.map((op) => {
            const active = rule.operator === op;
            return (
              <button
                key={op}
                type="button"
                onClick={() => {
                  onSelectOperator(op);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition ${
                  active
                    ? "bg-indigo-500/20 font-medium text-indigo-200"
                    : "text-zinc-300 hover:bg-white/[0.06]"
                }`}
              >
                <span>{formatOperatorMenuLabel(rule.field, op)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function LinearFilterBar({
  issues,
  meta,
  viewerName,
  scopeFilter,
  onChangeScope,
  teamFilter,
  onClearTeamFilter,
  rules,
  onChangeRules,
  matchMode,
  onChangeMatchMode,
  hasAnyFilters,
  onResetAll,
  openSignal,
}: LinearFilterBarProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [selectedField, setSelectedField] = useState<FilterField | null>(null);
  const [draftOperator, setDraftOperator] = useState<FilterOperator>("is");
  const [draftRuleId, setDraftRuleId] = useState<string | null>(null);
  const [fieldSearch, setFieldSearch] = useState("");
  const [textDraft, setTextDraft] = useState("");

  const addRef = useRef<HTMLDivElement>(null);
  const fieldSearchRef = useRef<HTMLInputElement>(null);
  const textDraftRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (openSignal > 0) {
      setSelectedField(null);
      setDraftRuleId(null);
      setFieldSearch("");
      setTextDraft("");
      setAddOpen(true);
    }
  }, [openSignal]);

  useEffect(() => {
    if (!addOpen) {
      setSelectedField(null);
      setDraftRuleId(null);
      setFieldSearch("");
      setTextDraft("");
      return;
    }

    if (!selectedField) {
      setTimeout(() => fieldSearchRef.current?.focus(), 0);
    } else if (selectedField === "text") {
      setTimeout(() => textDraftRef.current?.focus(), 0);
    }

    function onMouseDown(e: MouseEvent) {
      if (addRef.current && !addRef.current.contains(e.target as Node)) {
        setAddOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (selectedField) {
          setSelectedField(null);
          setDraftRuleId(null);
        } else {
          setAddOpen(false);
        }
      }
    }
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [addOpen, selectedField]);

  const visibleFields = useMemo(() => {
    const q = fieldSearch.trim().toLowerCase();
    if (!q) return FILTER_FIELDS;
    return FILTER_FIELDS.filter((f) => f.label.toLowerCase().includes(q));
  }, [fieldSearch]);

  const activeFieldMeta = selectedField ? getFieldMeta(selectedField) : null;
  const activeFieldOptions = useMemo(() => {
    if (!selectedField || selectedField === "text") return [];
    return buildFieldOptions(selectedField, issues, meta, viewerName);
  }, [selectedField, issues, meta, viewerName]);

  const draftRule = useMemo(
    () => (draftRuleId ? rules.find((r) => r.id === draftRuleId) ?? null : null),
    [draftRuleId, rules]
  );

  function chooseField(field: FilterField) {
    const fMeta = getFieldMeta(field);
    setSelectedField(field);
    setDraftOperator(fMeta.defaultOperator);
    setDraftRuleId(null);
    setTextDraft("");
  }

  function handleDraftOperatorChange(op: FilterOperator) {
    setDraftOperator(op);
    if (!selectedField) return;
    if (isUnaryOperator(op)) {
      if (draftRule) {
        onChangeRules(
          rules.map((r) =>
            r.id === draftRule.id ? { ...r, operator: op, values: [] } : r
          )
        );
      } else {
        const newRule: FilterRule = {
          id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          field: selectedField,
          operator: op,
          values: [],
        };
        onChangeRules([...rules, newRule]);
      }
      setAddOpen(false);
      return;
    }

    if (draftRule) {
      onChangeRules(
        rules.map((r) =>
          r.id === draftRule.id ? { ...r, operator: op } : r
        )
      );
    }
  }

  function handleDraftToggleValue(val: string) {
    if (!selectedField) return;
    if (!draftRule) {
      const id = `rule-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      onChangeRules([
        ...rules,
        { id, field: selectedField, operator: draftOperator, values: [val] },
      ]);
      setDraftRuleId(id);
      return;
    }
    const exists = draftRule.values.includes(val);
    const nextValues = exists
      ? draftRule.values.filter((v) => v !== val)
      : [...draftRule.values, val];
    if (nextValues.length === 0) {
      onChangeRules(rules.filter((r) => r.id !== draftRule.id));
      setDraftRuleId(null);
    } else {
      onChangeRules(
        rules.map((r) =>
          r.id === draftRule.id ? { ...r, values: nextValues } : r
        )
      );
    }
  }

  function handleCommitTextDraft() {
    const trimmed = textDraft.trim();
    if (!trimmed) return;
    const id = `rule-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    onChangeRules([
      ...rules,
      { id, field: "text", operator: draftOperator, values: [trimmed] },
    ]);
    setAddOpen(false);
  }

  function updateRule(
    id: string,
    patch: Partial<Pick<FilterRule, "operator" | "values">>
  ) {
    onChangeRules(
      rules.map((r) => (r.id === id ? { ...r, ...patch } : r))
    );
  }

  function removeRule(id: string) {
    onChangeRules(rules.filter((r) => r.id !== id));
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {SCOPE_OPTIONS.map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onChangeScope(opt.id)}
          className={`rounded-md px-2 py-1 text-[11px] font-medium transition ${
            scopeFilter === opt.id
              ? "bg-white/12 text-white"
              : "text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-300"
          }`}
        >
          {opt.label}
        </button>
      ))}

      {teamFilter !== "ALL" && (
        <span className="inline-flex items-center gap-1 rounded-md border border-indigo-500/30 bg-indigo-500/15 px-2 py-0.5 text-[11px] font-medium text-indigo-200">
          Team: {teamFilter}
          <button
            type="button"
            onClick={onClearTeamFilter}
            className="text-indigo-300 hover:text-white"
            title="Show all teams"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      )}

      <span className="mx-0.5 h-3.5 w-px bg-white/10" />

      {/* Active Linear-style composable FilterRule pills */}
      {rules.map((rule) => {
        const fMeta = getFieldMeta(rule.field);
        return (
          <div
            key={rule.id}
            className="inline-flex h-7 items-center rounded-lg border border-white/12 bg-[#141824] shadow-xs"
          >
            <span className="inline-flex items-center gap-1.5 border-r border-white/10 px-2 text-[11px] font-medium text-zinc-300">
              <FieldIcon field={rule.field} className="h-3 w-3" />
              <span>{fMeta.label}</span>
            </span>

            <OperatorPillSelector
              rule={rule}
              onSelectOperator={(op) =>
                updateRule(rule.id, {
                  operator: op,
                  values: isUnaryOperator(op) ? [] : rule.values,
                })
              }
            />

            <RuleValuesPicker
              rule={rule}
              issues={issues}
              meta={meta}
              viewerName={viewerName}
              onChangeValues={(values) => updateRule(rule.id, { values })}
              className="h-full"
            />

            <button
              type="button"
              onClick={() => removeRule(rule.id)}
              title="Remove filter"
              className="flex h-full items-center border-l border-white/10 px-1.5 text-zinc-500 transition hover:bg-white/[0.06] hover:text-rose-300"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}

      {/* + Filter button & two-step popover */}
      <div ref={addRef} className="relative">
        <button
          type="button"
          onClick={() => setAddOpen((p) => !p)}
          title="Add filter condition (F)"
          className={`inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium transition ${
            addOpen
              ? "border-indigo-500/50 bg-indigo-500/15 text-indigo-200"
              : "border-white/12 bg-[#12151F] text-zinc-300 hover:border-indigo-500/40 hover:text-white"
          }`}
        >
          <ListFilter className="h-3 w-3 text-indigo-400" />
          <span>Filter</span>
          <kbd className="rounded border border-white/10 bg-black/30 px-1 font-mono text-[9px] text-zinc-500">
            F
          </kbd>
        </button>

        {addOpen && (
          <div className="absolute left-0 z-50 mt-1.5 w-64 overflow-hidden rounded-xl border border-white/12 bg-[#11141E] shadow-2xl shadow-black/80">
            {!selectedField ? (
              <>
                <div className="border-b border-white/8 p-1.5">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2 top-2 h-3 w-3 text-zinc-500" />
                    <input
                      ref={fieldSearchRef}
                      value={fieldSearch}
                      onChange={(e) => setFieldSearch(e.target.value)}
                      placeholder="Filter by..."
                      className="w-full rounded-md border border-white/10 bg-[#090B10] py-1 pl-6 pr-2 text-[11px] text-zinc-100 placeholder:text-zinc-500 focus:border-indigo-500/50 focus:outline-none"
                    />
                  </div>
                </div>
                <div className="max-h-72 overflow-y-auto p-1">
                  {visibleFields.map((f) => (
                    <button
                      key={f.field}
                      type="button"
                      onClick={() => chooseField(f.field)}
                      className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs text-zinc-200 transition hover:bg-white/[0.06]"
                    >
                      <span className="flex items-center gap-2">
                        <FieldIcon field={f.field} className="h-3.5 w-3.5" />
                        <span>{f.label}</span>
                      </span>
                      <ChevronRight className="h-3.5 w-3.5 text-zinc-500" />
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between border-b border-white/8 px-2.5 py-2">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedField(null);
                      setDraftRuleId(null);
                    }}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-300 hover:text-white"
                  >
                    <ArrowLeft className="h-3 w-3" />
                    <FieldIcon field={selectedField} className="h-3 w-3" />
                    <span>{activeFieldMeta?.label}</span>
                  </button>
                </div>

                <div className="flex flex-wrap gap-1 border-b border-white/8 bg-white/[0.02] p-1.5">
                  {activeFieldMeta?.operators.map((op) => {
                    const isActive =
                      (draftRule?.operator ?? draftOperator) === op;
                    return (
                      <button
                        key={op}
                        type="button"
                        onClick={() => handleDraftOperatorChange(op)}
                        className={`rounded-md px-2 py-0.5 text-[10px] font-medium transition ${
                          isActive
                            ? "bg-indigo-600 text-white"
                            : "bg-white/[0.05] text-zinc-400 hover:text-zinc-100"
                        }`}
                      >
                        {formatOperatorMenuLabel(selectedField, op)}
                      </button>
                    );
                  })}
                </div>

                {selectedField === "text" ? (
                  <div className="space-y-2 p-2.5">
                    <input
                      ref={textDraftRef}
                      value={textDraft}
                      onChange={(e) => setTextDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleCommitTextDraft();
                        }
                      }}
                      placeholder="Match word or phrase..."
                      className="w-full rounded-lg border border-white/10 bg-[#090B10] px-2.5 py-1.5 text-xs text-white placeholder:text-zinc-500 focus:border-indigo-500 focus:outline-none"
                    />
                    <button
                      type="button"
                      disabled={!textDraft.trim()}
                      onClick={handleCommitTextDraft}
                      className="w-full rounded-lg bg-indigo-600 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                    >
                      Add Filter
                    </button>
                  </div>
                ) : (
                  <FilterValueChecklist
                    field={selectedField}
                    options={activeFieldOptions}
                    selectedValues={draftRule?.values ?? []}
                    onToggleValue={handleDraftToggleValue}
                    autoFocusSearch
                  />
                )}
              </>
            )}
          </div>
        )}
      </div>

      {rules.length >= 2 && (
        <button
          type="button"
          onClick={() =>
            onChangeMatchMode(matchMode === "all" ? "any" : "all")
          }
          title="Switch between matching all conditions (AND) or any condition (OR)"
          className="inline-flex h-7 items-center gap-1 rounded-lg border border-white/10 bg-[#12151F] px-2 text-[11px] font-medium text-zinc-300 transition hover:border-indigo-500/40 hover:text-white"
        >
          <span className="text-zinc-500">Match:</span>
          <span className="text-indigo-300">
            {matchMode === "all" ? "All (AND)" : "Any (OR)"}
          </span>
        </button>
      )}

      {hasAnyFilters && (
        <button
          type="button"
          onClick={onResetAll}
          className="rounded-md px-2 py-1 text-[11px] text-zinc-400 transition hover:bg-white/[0.05] hover:text-white"
        >
          Clear
        </button>
      )}
    </div>
  );
}
