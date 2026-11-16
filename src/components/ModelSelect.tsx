import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import type { ClaudeModelOption } from "../types";

interface ModelSelectProps {
  value: string;
  options: ClaudeModelOption[];
  onChange: (modelId: string) => void;
  showId?: boolean;
  align?: "left" | "right";
  fullWidth?: boolean;
}

export function ModelSelect({
  value,
  options,
  onChange,
  showId = false,
  align = "left",
  fullWidth = false,
}: ModelSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const selected =
    options.find((o) => o.id === value) ??
    ({ id: value, display_name: value } as ClaudeModelOption);

  useEffect(() => {
    if (!open) return;

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

  return (
    <div
      ref={rootRef}
      className={`relative ${fullWidth ? "w-full" : "inline-block"}`}
    >
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className={`flex items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-left text-xs text-zinc-900 transition hover:border-indigo-400 focus:border-indigo-500 focus:outline-none dark:border-white/10 dark:bg-[#12151F] dark:text-zinc-100 dark:hover:border-indigo-500/40 ${
          fullWidth ? "w-full" : "min-w-[190px]"
        }`}
      >
        <span className="truncate font-medium">
          {selected.display_name}
          {showId && selected.display_name !== selected.id && (
            <span className="ml-1.5 font-mono text-[10px] font-normal text-zinc-500 dark:text-zinc-400">
              ({selected.id})
            </span>
          )}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-zinc-400 transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className={`absolute z-50 mt-1.5 max-h-64 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-1 shadow-xl shadow-black/10 dark:border-white/12 dark:bg-[#11141E] dark:shadow-2xl dark:shadow-black/80 ${
            fullWidth
              ? "left-0 right-0 w-full"
              : align === "right"
              ? "right-0 min-w-[260px]"
              : "left-0 min-w-[260px]"
          }`}
        >
          {options.map((m) => {
            const isSelected = m.id === value;
            return (
              <button
                key={m.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(m.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left transition ${
                  isSelected
                    ? "bg-indigo-50 text-indigo-950 dark:bg-indigo-500/18 dark:text-white"
                    : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-white/[0.06]"
                }`}
              >
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium text-zinc-900 dark:text-zinc-100">
                    {m.display_name}
                  </div>
                  <div className="truncate font-mono text-[10px] text-zinc-500 dark:text-zinc-400">
                    {m.id}
                  </div>
                </div>
                {isSelected && (
                  <Check className="h-3.5 w-3.5 shrink-0 text-indigo-600 dark:text-indigo-400" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
