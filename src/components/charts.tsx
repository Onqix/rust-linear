import React, { useEffect, useMemo, useRef, useState } from "react";

function useContainerWidth(fallback = 420): [React.RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const update = () => {
      const next = el.clientWidth;
      if (next > 0) {
        setWidth(next);
      }
    };

    update();
    if (typeof ResizeObserver === "undefined") return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.floor(entry.contentRect.width);
        if (w > 0) setWidth(w);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, width];
}

function toCssColor(colorVar?: string): string {
  if (!colorVar) return "var(--viz-series-1)";
  return colorVar.startsWith("var(") ? colorVar : `var(${colorVar})`;
}

function computeNiceMaxAndTicks(rawMax: number, targetSteps = 4): {
  max: number;
  ticks: number[];
} {
  if (rawMax <= 0) {
    return { max: 4, ticks: [0, 1, 2, 3, 4] };
  }
  const roughStep = rawMax / targetSteps;
  const pow10 = Math.pow(10, Math.floor(Math.log10(roughStep)));
  const fraction = roughStep / pow10;
  let niceFraction = 1;
  if (fraction <= 1) niceFraction = 1;
  else if (fraction <= 2) niceFraction = 2;
  else if (fraction <= 2.5) niceFraction = 2.5;
  else if (fraction <= 5) niceFraction = 5;
  else niceFraction = 10;

  let step = Math.max(1, Math.ceil(niceFraction * pow10));
  if (step * targetSteps < rawMax) {
    step = Math.ceil(rawMax / targetSteps);
  }
  const niceMax = step * targetSteps;
  const ticks: number[] = [];
  for (let i = 0; i <= targetSteps; i++) {
    ticks.push(i * step);
  }
  return { max: niceMax, ticks };
}

function roundedTopRectPath(
  x: number,
  y: number,
  w: number,
  h: number,
  radius = 4
): string {
  if (w <= 0 || h <= 0) return "";
  const r = Math.min(radius, w / 2, h);
  return [
    `M ${x} ${y + h}`,
    `L ${x} ${y + r}`,
    `Q ${x} ${y} ${x + r} ${y}`,
    `L ${x + w - r} ${y}`,
    `Q ${x + w} ${y} ${x + w} ${y + r}`,
    `L ${x + w} ${y + h}`,
    "Z",
  ].join(" ");
}

function roundedRightRectPath(
  x: number,
  y: number,
  w: number,
  h: number,
  radius = 4
): string {
  if (w <= 0 || h <= 0) return "";
  const r = Math.min(radius, w, h / 2);
  return [
    `M ${x} ${y}`,
    `L ${x + w - r} ${y}`,
    `Q ${x + w} ${y} ${x + w} ${y + r}`,
    `L ${x + w} ${y + h - r}`,
    `Q ${x + w} ${y + h} ${x + w - r} ${y + h}`,
    `L ${x} ${y + h}`,
    "Z",
  ].join(" ");
}

export interface LineSeries {
  name: string;
  colorVar: string;
  values: number[];
}

export interface LineChartProps {
  series: LineSeries[];
  xLabels: string[];
  height?: number;
}

export function LineChart({
  series,
  xLabels,
  height = 220,
}: LineChartProps) {
  const [containerRef, width] = useContainerWidth(460);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const count = xLabels.length;
  const maxRaw = useMemo(
    () => Math.max(0, ...series.flatMap((s) => s.values)),
    [series]
  );
  const { max: yMax, ticks } = useMemo(
    () => computeNiceMaxAndTicks(maxRaw, 4),
    [maxRaw]
  );

  const padLeft = 34;
  const padRight = series.length >= 2 ? 90 : 52;
  const padTop = 14;
  const padBottom = 26;
  const plotW = Math.max(80, width - padLeft - padRight);
  const plotH = Math.max(60, height - padTop - padBottom);

  const xForIndex = (idx: number) => {
    if (count <= 1) return padLeft + plotW / 2;
    return padLeft + (idx / (count - 1)) * plotW;
  };

  const yForValue = (val: number) => {
    const ratio = yMax > 0 ? Math.max(0, Math.min(1, val / yMax)) : 0;
    return padTop + plotH - ratio * plotH;
  };

  const endLabels = useMemo(() => {
    if (count === 0) return [];
    const lastIdx = count - 1;
    const raw = series.map((s) => {
      const val = s.values[lastIdx] ?? 0;
      return {
        name: s.name,
        value: val,
        y: yForValue(val),
        x: xForIndex(lastIdx),
      };
    });
    // Sort by y ascending and nudge apart if two labels sit too close vertically
    const indexed = raw.map((item, idx) => ({ ...item, idx }));
    indexed.sort((a, b) => a.y - b.y);
    for (let i = 1; i < indexed.length; i++) {
      const prev = indexed[i - 1];
      const curr = indexed[i];
      if (curr.y - prev.y < 14) {
        curr.y = Math.min(padTop + plotH, prev.y + 14);
      }
    }
    return indexed;
  }, [series, count, yMax, plotW, plotH]);

  function handlePointerMove(e: React.MouseEvent<SVGSVGElement>) {
    if (count === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    if (relX < padLeft - 12 || relX > padLeft + plotW + 12) {
      setHoverIdx(null);
      return;
    }
    if (count === 1) {
      setHoverIdx(0);
      return;
    }
    const clamped = Math.max(padLeft, Math.min(padLeft + plotW, relX));
    const idx = Math.round(((clamped - padLeft) / plotW) * (count - 1));
    setHoverIdx(Math.max(0, Math.min(count - 1, idx)));
  }

  const labelStep = count > 8 ? 2 : 1;

  return (
    <div ref={containerRef} className="relative w-full select-none">
      {series.length >= 2 && (
        <div className="mb-2 flex flex-wrap items-center gap-4 text-[11px]">
          {series.map((s) => (
            <div key={s.name} className="flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded-xs"
                style={{ backgroundColor: toCssColor(s.colorVar) }}
              />
              <span className="font-medium text-[var(--viz-ink)]">{s.name}</span>
            </div>
          ))}
        </div>
      )}

      <div className="relative">
        <svg
          width={width}
          height={height}
          className="block overflow-visible"
          onMouseMove={handlePointerMove}
          onMouseLeave={() => setHoverIdx(null)}
        >
          {/* Horizontal gridlines & y-axis labels */}
          {ticks.map((tick) => {
            const y = yForValue(tick);
            const isBase = tick === 0;
            return (
              <g key={tick}>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={padLeft + plotW}
                  y2={y}
                  stroke={isBase ? "var(--viz-axis)" : "var(--viz-grid)"}
                  strokeWidth={1}
                />
                <text
                  x={padLeft - 8}
                  y={y + 3}
                  textAnchor="end"
                  fontSize={10}
                  fill="var(--viz-label)"
                  className="font-mono"
                >
                  {tick}
                </text>
              </g>
            );
          })}

          {/* X-axis tick labels */}
          {xLabels.map((lbl, idx) => {
            const show =
              idx === 0 || idx === count - 1 || idx % labelStep === 0;
            if (!show) return null;
            const x = xForIndex(idx);
            return (
              <text
                key={`${lbl}-${idx}`}
                x={x}
                y={padTop + plotH + 17}
                textAnchor={
                  idx === 0
                    ? "start"
                    : idx === count - 1
                    ? "end"
                    : "middle"
                }
                fontSize={10}
                fill="var(--viz-label)"
              >
                {lbl}
              </text>
            );
          })}

          {/* Crosshair on hover */}
          {hoverIdx !== null && (
            <line
              x1={xForIndex(hoverIdx)}
              y1={padTop}
              x2={xForIndex(hoverIdx)}
              y2={padTop + plotH}
              stroke="var(--viz-axis)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          )}

          {/* Series paths */}
          {series.map((s) => {
            if (count === 0) return null;
            const d = s.values
              .slice(0, count)
              .map((val, idx) => {
                const cmd = idx === 0 ? "M" : "L";
                return `${cmd} ${xForIndex(idx)} ${yForValue(val)}`;
              })
              .join(" ");
            return (
              <path
                key={s.name}
                d={d}
                fill="none"
                stroke={toCssColor(s.colorVar)}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            );
          })}

          {/* Markers shown only on hover (>= 8px diameter -> r >= 4) */}
          {hoverIdx !== null &&
            series.map((s) => {
              const val = s.values[hoverIdx] ?? 0;
              return (
                <circle
                  key={`marker-${s.name}`}
                  cx={xForIndex(hoverIdx)}
                  cy={yForValue(val)}
                  r={4.5}
                  fill={toCssColor(s.colorVar)}
                  stroke="var(--viz-ink)"
                  strokeWidth={1.5}
                />
              );
            })}

          {/* Direct labels at the line ends */}
          {endLabels.map((lbl) => (
            <text
              key={`end-${lbl.name}`}
              x={lbl.x + 8}
              y={lbl.y + 3}
              textAnchor="start"
              fontSize={10}
              fontWeight={500}
              fill="var(--viz-ink)"
            >
              {series.length >= 2
                ? `${lbl.name} · ${lbl.value}`
                : `${lbl.value}`}
            </text>
          ))}
        </svg>

        {hoverIdx !== null && count > 0 && (
          <div
            className="pointer-events-none absolute top-2 z-20 min-w-[140px] rounded-lg border border-zinc-200 bg-white/95 px-2.5 py-2 text-[11px] shadow-lg backdrop-blur-xs dark:border-white/12 dark:bg-[#11141E]/95"
            style={{
              left:
                xForIndex(hoverIdx) > padLeft + plotW * 0.62
                  ? Math.max(8, xForIndex(hoverIdx) - 156)
                  : xForIndex(hoverIdx) + 12,
            }}
          >
            <div className="mb-1 font-medium text-zinc-900 dark:text-zinc-100">
              Week of {xLabels[hoverIdx]}
            </div>
            <div className="space-y-0.5">
              {series.map((s) => (
                <div
                  key={s.name}
                  className="flex items-center justify-between gap-3"
                >
                  <span className="flex items-center gap-1.5 text-zinc-600 dark:text-zinc-400">
                    <span
                      className="h-2 w-2 rounded-xs"
                      style={{ backgroundColor: toCssColor(s.colorVar) }}
                    />
                    {s.name}
                  </span>
                  <span className="font-mono font-semibold text-zinc-900 dark:text-zinc-100">
                    {s.values[hoverIdx] ?? 0}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export interface HBarRow {
  label: string;
  value: number;
  icon?: React.ReactNode;
  onClick?: () => void;
}

export interface HBarChartProps {
  rows: HBarRow[];
  colorVar?: string;
  valueFormatter?: (value: number) => string;
}

export function HBarChart({
  rows,
  colorVar = "--viz-series-1",
  valueFormatter = (v) => String(v),
}: HBarChartProps) {
  const [trackRef, trackWidth] = useContainerWidth(240);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const maxValue = useMemo(
    () => Math.max(1, ...rows.map((r) => r.value)),
    [rows]
  );
  const totalValue = useMemo(
    () => rows.reduce((sum, r) => sum + r.value, 0),
    [rows]
  );

  const barColor = toCssColor(colorVar);
  const labelReserve = 48;
  const usableTrackW = Math.max(40, trackWidth - labelReserve);

  if (rows.length === 0) {
    return (
      <div className="py-6 text-center text-xs text-zinc-500">
        No matching issues.
      </div>
    );
  }

  return (
    <div className="relative w-full select-none space-y-1">
      {rows.map((row, idx) => {
        const barW =
          row.value > 0
            ? Math.max(4, (row.value / maxValue) * usableTrackW)
            : 0;
        const isHovered = hoverIdx === idx;
        const clickable = Boolean(row.onClick);
        const barPath = roundedRightRectPath(0, 5, barW, 14, 4);

        return (
          <div
            key={`${row.label}-${idx}`}
            onMouseEnter={() => setHoverIdx(idx)}
            onMouseLeave={() => setHoverIdx(null)}
            onClick={row.onClick}
            role={clickable ? "button" : undefined}
            tabIndex={clickable ? 0 : undefined}
            onKeyDown={
              clickable
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      row.onClick?.();
                    }
                  }
                : undefined
            }
            className={`group flex h-7 items-center gap-2.5 rounded-md px-1.5 transition ${
              isHovered
                ? "bg-zinc-100/80 dark:bg-white/[0.04]"
                : ""
            } ${clickable ? "cursor-pointer" : ""}`}
          >
            <div className="flex w-36 shrink-0 items-center gap-1.5 truncate text-[11px]">
              {row.icon && <span className="shrink-0">{row.icon}</span>}
              <span
                className="truncate font-medium text-[var(--viz-ink)]"
                title={row.label}
              >
                {row.label}
              </span>
            </div>

            <div
              ref={idx === 0 ? trackRef : undefined}
              className="relative flex-1 overflow-hidden"
            >
              <svg width={trackWidth} height={24} className="block">
                <line
                  x1={0}
                  y1={2}
                  x2={0}
                  y2={22}
                  stroke="var(--viz-axis)"
                  strokeWidth={1}
                />
                {barPath && <path d={barPath} fill={barColor} />}
                <text
                  x={barW + 7}
                  y={16}
                  fontSize={10}
                  fontWeight={500}
                  fill="var(--viz-ink)"
                  className="font-mono"
                >
                  {valueFormatter(row.value)}
                </text>
              </svg>
            </div>
          </div>
        );
      })}

      {hoverIdx !== null && rows[hoverIdx] && (
        <div
          className="pointer-events-none absolute right-2 z-20 rounded-lg border border-zinc-200 bg-white/95 px-2.5 py-1.5 text-[11px] shadow-lg backdrop-blur-xs dark:border-white/12 dark:bg-[#11141E]/95"
          style={{
            top: Math.max(0, hoverIdx * 32 - 6),
          }}
        >
          <div className="font-medium text-zinc-900 dark:text-zinc-100">
            {rows[hoverIdx].label}
          </div>
          <div className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
            <span className="font-mono font-semibold text-zinc-900 dark:text-zinc-100">
              {valueFormatter(rows[hoverIdx].value)}
            </span>
            {totalValue > 0 && (
              <span>
                ({Math.round((rows[hoverIdx].value / totalValue) * 100)}%)
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export interface ColumnChartItem {
  label: string;
  value: number;
}

export interface ColumnChartProps {
  columns: ColumnChartItem[];
  colorVar?: string;
  height?: number;
}

export function ColumnChart({
  columns,
  colorVar = "--viz-series-1",
  height = 200,
}: ColumnChartProps) {
  const [containerRef, width] = useContainerWidth(420);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const count = columns.length;
  const maxRaw = useMemo(
    () => Math.max(0, ...columns.map((c) => c.value)),
    [columns]
  );
  const { max: yMax, ticks } = useMemo(
    () => computeNiceMaxAndTicks(maxRaw, 4),
    [maxRaw]
  );
  const totalValue = useMemo(
    () => columns.reduce((sum, c) => sum + c.value, 0),
    [columns]
  );

  const padLeft = 34;
  const padRight = 12;
  const padTop = 14;
  const padBottom = 28;
  const plotW = Math.max(80, width - padLeft - padRight);
  const plotH = Math.max(60, height - padTop - padBottom);
  const slotW = count > 0 ? plotW / count : plotW;
  const gap = Math.max(4, Math.min(16, slotW * 0.25));
  const barW = Math.max(8, Math.min(36, slotW - gap));
  const barColor = toCssColor(colorVar);

  const yForValue = (val: number) => {
    const ratio = yMax > 0 ? Math.max(0, Math.min(1, val / yMax)) : 0;
    return padTop + plotH - ratio * plotH;
  };

  return (
    <div ref={containerRef} className="relative w-full select-none">
      <svg width={width} height={height} className="block overflow-visible">
        {/* Horizontal gridlines & y-axis labels */}
        {ticks.map((tick) => {
          const y = yForValue(tick);
          const isBase = tick === 0;
          return (
            <g key={tick}>
              <line
                x1={padLeft}
                y1={y}
                x2={padLeft + plotW}
                y2={y}
                stroke={isBase ? "var(--viz-axis)" : "var(--viz-grid)"}
                strokeWidth={1}
              />
              <text
                x={padLeft - 8}
                y={y + 3}
                textAnchor="end"
                fontSize={10}
                fill="var(--viz-label)"
                className="font-mono"
              >
                {tick}
              </text>
            </g>
          );
        })}

        {columns.map((col, idx) => {
          const slotX = padLeft + idx * slotW;
          const barX = slotX + (slotW - barW) / 2;
          const barY = yForValue(col.value);
          const barH = Math.max(0, padTop + plotH - barY);
          const path = roundedTopRectPath(barX, barY, barW, barH, 4);
          const isHovered = hoverIdx === idx;

          return (
            <g
              key={col.label}
              onMouseEnter={() => setHoverIdx(idx)}
              onMouseLeave={() => setHoverIdx(null)}
            >
              {/* Full-column hit target */}
              <rect
                x={slotX}
                y={padTop}
                width={slotW}
                height={plotH + padBottom}
                fill={isHovered ? "var(--viz-grid)" : "transparent"}
                fillOpacity={isHovered ? 0.35 : 0}
                rx={4}
              />

              {path && <path d={path} fill={barColor} />}

              <text
                x={slotX + slotW / 2}
                y={padTop + plotH + 17}
                textAnchor="middle"
                fontSize={10}
                fill="var(--viz-label)"
              >
                {col.label}
              </text>
            </g>
          );
        })}
      </svg>

      {hoverIdx !== null && columns[hoverIdx] && (
        <div
          className="pointer-events-none absolute top-2 z-20 rounded-lg border border-zinc-200 bg-white/95 px-2.5 py-1.5 text-[11px] shadow-lg backdrop-blur-xs dark:border-white/12 dark:bg-[#11141E]/95"
          style={{
            left: Math.min(
              Math.max(8, padLeft + hoverIdx * slotW + slotW / 2 - 48),
              Math.max(8, width - 130)
            ),
          }}
        >
          <div className="font-medium text-zinc-900 dark:text-zinc-100">
            Age {columns[hoverIdx].label}
          </div>
          <div className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
            <span className="font-mono font-semibold text-zinc-900 dark:text-zinc-100">
              {columns[hoverIdx].value}
            </span>
            {totalValue > 0 && (
              <span>
                ({Math.round((columns[hoverIdx].value / totalValue) * 100)}%)
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
