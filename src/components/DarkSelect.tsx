import React, { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";

export interface DarkSelectOption {
  value: string;
  label: string;
  hint?: string;
  colorDot?: string;
  icon?: React.ReactNode;
}

interface DarkSelectProps {
  value: string;
  options: DarkSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  align?: "left" | "right";
  fullWidth?: boolean;
  compact?: boolean;
  disabled?: boolean;
}

export function DarkSelect({
  value,
  options,
  onChange,
  placeholder = "Select...",
  align = "left",
  fullWidth = false,
  compact = false,
  disabled = false,
}: DarkSelectProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value);

  const visibleOptions = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.hint && o.hint.toLowerCase().includes(q))
    );
  }, [options, filter]);

  useEffect(() => {
    if (!open) {
      setFilter("");
      return;
    }

    if (options.length > 8) {
      setTimeout(() => searchInputRef.current?.focus(), 0);
    }

    function handleMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    }

    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open, options.length]);

  return (
    <div
      ref={rootRef}
      className={`relative ${fullWidth ? "w-full" : "inline-block"}`}
    >
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className={`flex items-center justify-between gap-1.5 rounded-lg border border-white/10 bg-[#12151F] text-left text-zinc-100 transition hover:border-indigo-500/40 focus:border-indigo-500 focus:outline-none disabled:opacity-50 ${
          compact ? "px-2 py-1 text-[11px]" : "px-2.5 py-1.5 text-xs"
        } ${fullWidth ? "w-full" : ""}`}
      >
        <span className="flex min-w-0 items-center gap-1.5 truncate font-medium">
          {selected?.icon}
          {!selected?.icon && selected?.colorDot && (
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: selected.colorDot }}
            />
          )}
          <span className="truncate">{selected?.label ?? placeholder}</span>
        </span>
        <ChevronDown
          className={`h-3 w-3 shrink-0 text-zinc-400 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className={`absolute z-50 mt-1.5 overflow-hidden rounded-xl border border-white/12 bg-[#11141E] shadow-2xl shadow-black/80 ${
            fullWidth
              ? "left-0 right-0 min-w-[210px]"
              : align === "right"
              ? "right-0 min-w-[220px]"
              : "left-0 min-w-[220px]"
          }`}
        >
          {options.length > 8 && (
            <div className="border-b border-white/8 p-1.5">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-2 h-3 w-3 text-zinc-500" />
                <input
                  ref={searchInputRef}
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter..."
                  className="w-full rounded-md border border-white/10 bg-[#090B10] py-1 pl-6 pr-2 text-[11px] text-zinc-100 placeholder:text-zinc-500 focus:border-indigo-500/50 focus:outline-none"
                />
              </div>
            </div>
          )}

          <div className="max-h-60 overflow-y-auto p-1">
            {visibleOptions.length === 0 ? (
              <div className="px-2.5 py-2 text-[11px] text-zinc-500">
                No matches
              </div>
            ) : (
              visibleOptions.map((opt) => {
                const isSelected = opt.value === value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      onChange(opt.value);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left transition ${
                      isSelected
                        ? "bg-indigo-500/18 text-white"
                        : "text-zinc-200 hover:bg-white/[0.06]"
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      {opt.icon}
                      {!opt.icon && opt.colorDot && (
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: opt.colorDot }}
                        />
                      )}
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-medium text-zinc-100">
                          {opt.label}
                        </span>
                        {opt.hint && (
                          <span className="block truncate font-mono text-[10px] text-zinc-400">
                            {opt.hint}
                          </span>
                        )}
                      </span>
                    </span>
                    {isSelected && (
                      <Check className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface DarkMultiSelectProps {
  values: string[];
  options: DarkSelectOption[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  compact?: boolean;
  disabled?: boolean;
}

export function DarkMultiSelect({
  values,
  options,
  onChange,
  placeholder = "Labels",
  compact = false,
  disabled = false,
}: DarkMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  const selectedSet = useMemo(() => new Set(values), [values]);
  const selectedOptions = useMemo(
    () => options.filter((o) => selectedSet.has(o.value)),
    [options, selectedSet]
  );

  const visibleOptions = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, filter]);

  useEffect(() => {
    if (!open) {
      setFilter("");
      return;
    }

    function handleMouseDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    }

    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open]);

  function toggleValue(val: string) {
    if (selectedSet.has(val)) {
      onChange(values.filter((v) => v !== val));
    } else {
      onChange([...values, val]);
    }
  }

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((p) => !p)}
        className={`flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#12151F] text-zinc-200 transition hover:border-indigo-500/40 focus:border-indigo-500 focus:outline-none disabled:opacity-50 ${
          compact ? "px-2 py-1 text-[11px]" : "px-2.5 py-1.5 text-xs"
        }`}
      >
        <span className="truncate font-medium">
          {selectedOptions.length === 0
            ? placeholder
            : selectedOptions.length === 1
            ? selectedOptions[0].label
            : `${selectedOptions.length} labels`}
        </span>
        <ChevronDown
          className={`h-3 w-3 shrink-0 text-zinc-400 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <div className="absolute left-0 z-50 mt-1.5 min-w-[230px] overflow-hidden rounded-xl border border-white/12 bg-[#11141E] shadow-2xl shadow-black/80">
          {options.length > 6 && (
            <div className="border-b border-white/8 p-1.5">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-2 h-3 w-3 text-zinc-500" />
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter labels..."
                  className="w-full rounded-md border border-white/10 bg-[#090B10] py-1 pl-6 pr-2 text-[11px] text-zinc-100 placeholder:text-zinc-500 focus:border-indigo-500/50 focus:outline-none"
                />
              </div>
            </div>
          )}

          <div className="max-h-60 overflow-y-auto p-1">
            {visibleOptions.length === 0 ? (
              <div className="px-2.5 py-2 text-[11px] text-zinc-500">
                No labels found
              </div>
            ) : (
              visibleOptions.map((opt) => {
                const isSelected = selectedSet.has(opt.value);
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => toggleValue(opt.value)}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left transition ${
                      isSelected
                        ? "bg-indigo-500/18 text-white"
                        : "text-zinc-200 hover:bg-white/[0.06]"
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      {opt.colorDot && (
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: opt.colorDot }}
                        />
                      )}
                      <span className="truncate text-xs">{opt.label}</span>
                    </span>
                    {isSelected && (
                      <Check className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
