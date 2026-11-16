import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  CircleDot,
  Flag,
  FolderKanban,
  Layers,
  MessageSquare,
  Search,
  Tag,
  Type,
  User,
} from "lucide-react";
import type {
  FilterField,
  FilterRule,
  LinearIssue,
  WorkspaceMetadata,
} from "../types";
import {
  buildFieldOptions,
  formatOptionLabel,
  isUnaryOperator,
  type FieldOption,
} from "../lib/viewFilters";
import { AuthorAvatar, PriorityIcon, StateIcon } from "./Icons";

export function FieldIcon({
  field,
  className = "h-3 w-3",
}: {
  field: FilterField;
  className?: string;
}) {
  switch (field) {
    case "status":
      return <CircleDot className={`${className} text-indigo-400`} />;
    case "state_type":
      return <Layers className={`${className} text-violet-400`} />;
    case "priority":
      return <Flag className={`${className} text-amber-400`} />;
    case "assignee":
      return <User className={`${className} text-sky-400`} />;
    case "label":
      return <Tag className={`${className} text-emerald-400`} />;
    case "project":
      return <FolderKanban className={`${className} text-indigo-300`} />;
    case "team":
      return <Layers className={`${className} text-zinc-300`} />;
    case "unread":
      return <MessageSquare className={`${className} text-indigo-400`} />;
    case "text":
      return <Type className={`${className} text-zinc-400`} />;
  }
}

export function OptionLeadingIcon({
  field,
  option,
}: {
  field: FilterField;
  option: FieldOption;
}) {
  if (field === "priority" && option.priority !== undefined) {
    return <PriorityIcon priority={option.priority} className="h-3.5 w-3.5" />;
  }
  if (
    (field === "status" || field === "state_type") &&
    option.stateType !== undefined
  ) {
    return (
      <StateIcon
        stateType={option.stateType}
        color={option.color}
        className="h-3.5 w-3.5"
      />
    );
  }
  if (field === "label" && option.color) {
    return (
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: option.color }}
      />
    );
  }
  if (field === "assignee") {
    if (option.value === "__UNASSIGNED__") {
      return <User className="h-3.5 w-3.5 text-zinc-500" />;
    }
    if (option.value === "__VIEWER__") {
      return <User className="h-3.5 w-3.5 text-indigo-400" />;
    }
    return <AuthorAvatar name={option.label} size="sm" />;
  }
  if (field === "project") {
    return <FolderKanban className="h-3.5 w-3.5 text-zinc-500" />;
  }
  if (field === "unread") {
    return (
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${
          option.value === "unread" ? "bg-indigo-400" : "bg-zinc-600"
        }`}
      />
    );
  }
  return null;
}

export function FilterValueChecklist({
  field,
  options,
  selectedValues,
  onToggleValue,
  autoFocusSearch = false,
}: {
  field: FilterField;
  options: FieldOption[];
  selectedValues: string[];
  onToggleValue: (value: string) => void;
  autoFocusSearch?: boolean;
}) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedSet = useMemo(() => new Set(selectedValues), [selectedValues]);

  useEffect(() => {
    if (autoFocusSearch && options.length > 5) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [autoFocusSearch, options.length]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  return (
    <div>
      {options.length > 5 && (
        <div className="border-b border-white/8 p-1.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-2 h-3 w-3 text-zinc-500" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter options..."
              className="w-full rounded-md border border-white/10 bg-[#090B10] py-1 pl-6 pr-2 text-[11px] text-zinc-100 placeholder:text-zinc-500 focus:border-indigo-500/50 focus:outline-none"
            />
          </div>
        </div>
      )}
      <div className="max-h-56 overflow-y-auto p-1">
        {filtered.length === 0 ? (
          <div className="px-2.5 py-2 text-[11px] text-zinc-500">
            No matching values
          </div>
        ) : (
          filtered.map((opt) => {
            const checked = selectedSet.has(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => onToggleValue(opt.value)}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition ${
                  checked
                    ? "bg-indigo-500/18 text-white"
                    : "text-zinc-200 hover:bg-white/[0.06]"
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span
                    className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                      checked
                        ? "border-indigo-400 bg-indigo-500 text-white"
                        : "border-white/20 bg-black/30"
                    }`}
                  >
                    {checked && <Check className="h-2.5 w-2.5" />}
                  </span>
                  <OptionLeadingIcon field={field} option={opt} />
                  <span className="truncate">{opt.label}</span>
                </span>
                <span className="shrink-0 font-mono text-[10px] text-zinc-500">
                  {opt.count}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

export function RuleValuesPicker({
  rule,
  issues,
  meta,
  viewerName,
  onChangeValues,
  className = "",
}: {
  rule: FilterRule;
  issues: LinearIssue[];
  meta: WorkspaceMetadata;
  viewerName?: string | null;
  onChangeValues: (nextValues: string[]) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

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

  const options = useMemo(
    () => buildFieldOptions(rule.field, issues, meta, viewerName),
    [rule.field, issues, meta, viewerName]
  );

  if (isUnaryOperator(rule.operator)) {
    return null;
  }

  if (rule.field === "text") {
    return (
      <input
        value={rule.values[0] ?? ""}
        onChange={(e) => onChangeValues([e.target.value])}
        placeholder="keyword..."
        className={`h-full min-w-[110px] bg-transparent px-2 text-[11px] text-zinc-100 placeholder:text-zinc-500 focus:outline-none ${className}`}
      />
    );
  }

  function toggleValue(val: string) {
    if (rule.values.includes(val)) {
      onChangeValues(rule.values.filter((v) => v !== val));
    } else {
      onChangeValues([...rule.values, val]);
    }
  }

  const displaySummary =
    rule.values.length === 0
      ? "Select..."
      : rule.values.length === 1
      ? formatOptionLabel(rule.field, rule.values[0], viewerName)
      : `${formatOptionLabel(rule.field, rule.values[0], viewerName)} +${
          rule.values.length - 1
        }`;

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className="flex h-full items-center gap-1 px-2 py-1 text-[11px] font-medium text-zinc-100 transition hover:bg-white/[0.06]"
      >
        <span className="max-w-[160px] truncate">{displaySummary}</span>
        <ChevronDown className="h-2.5 w-2.5 text-zinc-500" />
      </button>

      {open && (
        <div className="absolute left-0 z-50 mt-1.5 min-w-[235px] overflow-hidden rounded-xl border border-white/12 bg-[#11141E] shadow-2xl shadow-black/80">
          <FilterValueChecklist
            field={rule.field}
            options={options}
            selectedValues={rule.values}
            onToggleValue={toggleValue}
            autoFocusSearch
          />
        </div>
      )}
    </div>
  );
}
