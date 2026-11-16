import React from "react";

export function BrandLogo({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1024 1024"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="lpBg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#111322" />
          <stop offset="50%" stopColor="#312E81" />
          <stop offset="100%" stopColor="#5B21B6" />
        </linearGradient>
      </defs>
      <rect x="48" y="48" width="928" height="928" rx="224" fill="url(#lpBg)" />
      <rect
        x="52"
        y="52"
        width="920"
        height="920"
        rx="220"
        fill="none"
        stroke="rgba(255,255,255,0.22)"
        strokeWidth="12"
      />
      <g
        fill="none"
        stroke="#FFFFFF"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="512" cy="512" r="276" strokeWidth="50" strokeOpacity="0.24" />
        <path d="M276 594 L430 748" strokeWidth="56" strokeOpacity="0.9" />
        <path d="M254 468 L556 770" strokeWidth="56" strokeOpacity="0.95" />
        <path d="M312 372 L450 510 L536 424 L696 584" strokeWidth="60" />
        <circle cx="716" cy="308" r="38" fill="#A5B4FC" stroke="none" />
      </g>
    </svg>
  );
}

export function PriorityIcon({
  priority,
  className = "h-3.5 w-3.5",
}: {
  priority: number;
  className?: string;
}) {
  if (priority === 1) {
    // Urgent
    return (
      <svg
        viewBox="0 0 16 16"
        className={`${className} text-rose-400`}
        fill="currentColor"
        aria-label="Urgent"
      >
        <rect x="1.5" y="1.5" width="13" height="13" rx="3" fillOpacity="0.2" />
        <rect
          x="1.5"
          y="1.5"
          width="13"
          height="13"
          rx="3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
        />
        <path d="M8 4.2v4.6M8 11.1v.9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    );
  }

  if (priority === 2 || priority === 3 || priority === 4) {
    const activeBars = priority === 2 ? 3 : priority === 3 ? 2 : 1;
    const colorCls =
      priority === 2
        ? "text-amber-400"
        : priority === 3
        ? "text-sky-400"
        : "text-zinc-400";
    return (
      <svg
        viewBox="0 0 16 16"
        className={`${className} ${colorCls}`}
        fill="currentColor"
        aria-label={`Priority ${priority}`}
      >
        <rect x="2.2" y="9.5" width="2.4" height="4" rx="0.7" opacity={activeBars >= 1 ? 1 : 0.25} />
        <rect x="6.8" y="6.2" width="2.4" height="7.3" rx="0.7" opacity={activeBars >= 2 ? 1 : 0.25} />
        <rect x="11.4" y="2.8" width="2.4" height="10.7" rx="0.7" opacity={activeBars >= 3 ? 1 : 0.25} />
      </svg>
    );
  }

  // No priority
  return (
    <svg
      viewBox="0 0 16 16"
      className={`${className} text-zinc-600`}
      fill="currentColor"
      aria-label="No priority"
    >
      <circle cx="3.5" cy="8" r="1.1" />
      <circle cx="8" cy="8" r="1.1" />
      <circle cx="12.5" cy="8" r="1.1" />
    </svg>
  );
}

export function StateIcon({
  stateType,
  color,
  className = "h-3.5 w-3.5",
}: {
  stateType: string;
  color?: string;
  className?: string;
}) {
  const strokeColor = color || "#818cf8";
  const t = stateType.toLowerCase();

  if (t === "completed") {
    return (
      <svg viewBox="0 0 16 16" className={className} style={{ color: strokeColor }}>
        <circle cx="8" cy="8" r="6" fill="currentColor" fillOpacity="0.18" stroke="currentColor" strokeWidth="1.4" />
        <path
          d="M5.3 8.2L7.2 10l3.6-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (t === "canceled" || t === "cancelled") {
    return (
      <svg viewBox="0 0 16 16" className={className} style={{ color: strokeColor }}>
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.4" opacity="0.65" />
        <path
          d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  if (t === "started") {
    // Half/partial fill ring for In Progress / In Review
    return (
      <svg viewBox="0 0 16 16" className={className} style={{ color: strokeColor }}>
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 3.6a4.4 4.4 0 0 1 0 8.8z" fill="currentColor" />
      </svg>
    );
  }

  if (t === "backlog" || t === "triage") {
    return (
      <svg viewBox="0 0 16 16" className={className} style={{ color: strokeColor }}>
        <circle
          cx="8"
          cy="8"
          r="5.8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeDasharray="2.2 2"
        />
      </svg>
    );
  }

  // unstarted / Todo
  return (
    <svg viewBox="0 0 16 16" className={className} style={{ color: strokeColor }}>
      <circle cx="8" cy="8" r="5.8" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

const AVATAR_TONES = [
  "bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-500/20 dark:text-indigo-300 dark:border-indigo-500/30",
  "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-500/20 dark:text-emerald-300 dark:border-emerald-500/30",
  "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-500/20 dark:text-amber-300 dark:border-amber-500/30",
  "bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-500/20 dark:text-sky-300 dark:border-sky-500/30",
  "bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-500/20 dark:text-violet-300 dark:border-violet-500/30",
  "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-500/20 dark:text-rose-300 dark:border-rose-500/30",
];

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function AuthorAvatar({
  name,
  size = "md",
}: {
  name: string;
  size?: "sm" | "md";
}): React.ReactElement {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  const tone = AVATAR_TONES[hash % AVATAR_TONES.length];
  const dims = size === "sm" ? "h-4 w-4 text-[8px]" : "h-6 w-6 text-[10px]";

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full border font-semibold ${dims} ${tone}`}
      title={name}
    >
      {getInitials(name)}
    </span>
  );
}
