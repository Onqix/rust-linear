import { useMemo, useState } from "react";
import { BarChart3, FolderKanban, Layers, X } from "lucide-react";
import type { LinearIssue, WorkspaceMetadata } from "../types";
import { getWorkflowStageRank } from "../lib/viewFilters";
import { DarkSelect, type DarkSelectOption } from "./DarkSelect";
import { PriorityIcon, StateIcon } from "./Icons";
import { ColumnChart, HBarChart, LineChart } from "./charts";

interface InsightsViewProps {
  issues: LinearIssue[];
  workspaceMeta: WorkspaceMetadata;
  onSelectIdentifier: (identifier: string) => void;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function isOpenIssue(issue: LinearIssue): boolean {
  const st = issue.state_type.toLowerCase();
  return st !== "completed" && st !== "canceled" && st !== "cancelled";
}

function getEffectiveCompletedAt(issue: LinearIssue): string | null {
  if (issue.completed_at) return issue.completed_at;
  if (issue.state_type.toLowerCase() === "completed") {
    return issue.updated_at;
  }
  return null;
}

function formatWeekLabel(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function getMedian(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

interface DrilldownSelection {
  title: string;
  issues: LinearIssue[];
}

export function InsightsView({
  issues,
  workspaceMeta,
  onSelectIdentifier,
}: InsightsViewProps) {
  const [teamFilter, setTeamFilter] = useState<string>("ALL");
  const [projectFilter, setProjectFilter] = useState<string>("ALL");
  const [drilldown, setDrilldown] = useState<DrilldownSelection | null>(null);

  const teamOptions: DarkSelectOption[] = useMemo(
    () => [
      {
        value: "ALL",
        label: "All teams",
        icon: <Layers className="h-3.5 w-3.5 text-zinc-400" />,
      },
      ...[...workspaceMeta.teams]
        .sort((a, b) => a.key.localeCompare(b.key))
        .map((t) => ({
          value: t.key,
          label: `${t.key} · ${t.name}`,
        })),
    ],
    [workspaceMeta.teams]
  );

  const projectOptions: DarkSelectOption[] = useMemo(() => {
    const names = new Set<string>();
    for (const p of workspaceMeta.projects) {
      if (p.name.trim()) names.add(p.name.trim());
    }
    for (const i of issues) {
      if (i.project_name?.trim()) names.add(i.project_name.trim());
    }
    const sorted = Array.from(names).sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase())
    );
    return [
      {
        value: "ALL",
        label: "All projects",
        icon: <FolderKanban className="h-3.5 w-3.5 text-zinc-400" />,
      },
      {
        value: "__NONE__",
        label: "No project",
      },
      ...sorted.map((name) => ({
        value: name,
        label: name,
      })),
    ];
  }, [workspaceMeta.projects, issues]);

  const filteredIssues = useMemo(() => {
    return issues.filter((issue) => {
      if (teamFilter !== "ALL" && issue.team_key !== teamFilter) {
        return false;
      }
      if (projectFilter === "__NONE__") {
        if (issue.project_name?.trim()) return false;
      } else if (projectFilter !== "ALL") {
        if ((issue.project_name?.trim() || "") !== projectFilter) return false;
      }
      return true;
    });
  }, [issues, teamFilter, projectFilter]);

  const openIssues = useMemo(
    () => filteredIssues.filter(isOpenIssue),
    [filteredIssues]
  );

  const summaryStats = useMemo(() => {
    const now = Date.now();
    const cutoff30d = now - 30 * DAY_MS;

    let created30d = 0;
    let completed30d = 0;
    const openAgesDays: number[] = [];

    for (const issue of filteredIssues) {
      const createdMs = new Date(issue.created_at).getTime();
      if (!Number.isNaN(createdMs) && createdMs >= cutoff30d) {
        created30d += 1;
      }

      const completedIso = getEffectiveCompletedAt(issue);
      if (completedIso) {
        const completedMs = new Date(completedIso).getTime();
        if (!Number.isNaN(completedMs) && completedMs >= cutoff30d) {
          completed30d += 1;
        }
      }

      if (isOpenIssue(issue) && !Number.isNaN(createdMs)) {
        openAgesDays.push(Math.max(0, (now - createdMs) / DAY_MS));
      }
    }

    const medianAge = getMedian(openAgesDays);

    return {
      openCount: openIssues.length,
      created30d,
      completed30d,
      medianAgeDays: medianAge,
    };
  }, [filteredIssues, openIssues.length]);

  const weeklyTrend = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const day = today.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const currentMonday = new Date(today);
    currentMonday.setDate(today.getDate() + diffToMonday);

    const weeks: { startMs: number; endMs: number; label: string }[] = [];
    for (let i = 11; i >= 0; i--) {
      const start = new Date(currentMonday);
      start.setDate(currentMonday.getDate() - i * 7);
      const end = new Date(start);
      end.setDate(start.getDate() + 7);
      weeks.push({
        startMs: start.getTime(),
        endMs: end.getTime(),
        label: formatWeekLabel(start),
      });
    }

    const createdCounts = new Array<number>(12).fill(0);
    const completedCounts = new Array<number>(12).fill(0);
    const minStart = weeks[0].startMs;
    const maxEnd = weeks[11].endMs;

    for (const issue of filteredIssues) {
      const cMs = new Date(issue.created_at).getTime();
      if (!Number.isNaN(cMs) && cMs >= minStart && cMs < maxEnd) {
        const idx = Math.floor((cMs - minStart) / (7 * DAY_MS));
        if (idx >= 0 && idx < 12) createdCounts[idx] += 1;
      }

      const doneIso = getEffectiveCompletedAt(issue);
      if (doneIso) {
        const dMs = new Date(doneIso).getTime();
        if (!Number.isNaN(dMs) && dMs >= minStart && dMs < maxEnd) {
          const idx = Math.floor((dMs - minStart) / (7 * DAY_MS));
          if (idx >= 0 && idx < 12) completedCounts[idx] += 1;
        }
      }
    }

    return {
      xLabels: weeks.map((w) => w.label),
      series: [
        {
          name: "Created",
          colorVar: "--viz-series-1",
          values: createdCounts,
        },
        {
          name: "Completed",
          colorVar: "--viz-series-2",
          values: completedCounts,
        },
      ],
    };
  }, [filteredIssues]);

  const statusRows = useMemo(() => {
    const positionByName = new Map<string, number>();
    for (const team of workspaceMeta.teams) {
      for (const st of team.states) {
        if (!positionByName.has(st.name)) {
          positionByName.set(st.name, st.position);
        }
      }
    }

    const groups = new Map<
      string,
      { stateType: string; color: string; issues: LinearIssue[] }
    >();
    for (const issue of openIssues) {
      const existing = groups.get(issue.state_name);
      if (existing) {
        existing.issues.push(issue);
      } else {
        groups.set(issue.state_name, {
          stateType: issue.state_type,
          color: issue.state_color,
          issues: [issue],
        });
      }
    }

    return Array.from(groups.entries())
      .sort((a, b) => {
        const rankDiff =
          getWorkflowStageRank(a[1].stateType) -
          getWorkflowStageRank(b[1].stateType);
        if (rankDiff !== 0) return rankDiff;
        const posA = positionByName.get(a[0]) ?? 9999;
        const posB = positionByName.get(b[0]) ?? 9999;
        if (posA !== posB) return posA - posB;
        return a[0].localeCompare(b[0]);
      })
      .map(([name, info]) => ({
        label: name,
        value: info.issues.length,
        icon: (
          <StateIcon
            stateType={info.stateType}
            color={info.color}
            className="h-3.5 w-3.5"
          />
        ),
        onClick: () =>
          setDrilldown({
            title: `Open issues in "${name}"`,
            issues: info.issues,
          }),
      }));
  }, [openIssues, workspaceMeta.teams]);

  const assigneeRows = useMemo(() => {
    const namedMap = new Map<string, LinearIssue[]>();
    const unassigned: LinearIssue[] = [];

    for (const issue of openIssues) {
      const name = issue.assignee_name?.trim();
      if (!name) {
        unassigned.push(issue);
      } else {
        const list = namedMap.get(name);
        if (list) list.push(issue);
        else namedMap.set(name, [issue]);
      }
    }

    const sortedNamed = Array.from(namedMap.entries()).sort(
      (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])
    );

    const top8 = sortedNamed.slice(0, 8);
    const rest = sortedNamed.slice(8);
    const otherIssues = rest.flatMap(([, list]) => list);

    const combined: { label: string; issues: LinearIssue[] }[] = top8.map(
      ([name, list]) => ({ label: name, issues: list })
    );
    if (otherIssues.length > 0) {
      combined.push({ label: "Other", issues: otherIssues });
    }
    if (unassigned.length > 0) {
      combined.push({ label: "Unassigned", issues: unassigned });
    }

    combined.sort(
      (a, b) => b.issues.length - a.issues.length || a.label.localeCompare(b.label)
    );

    return combined.map((entry) => ({
      label: entry.label,
      value: entry.issues.length,
      onClick: () =>
        setDrilldown({
          title: `Open issues · ${entry.label}`,
          issues: entry.issues,
        }),
    }));
  }, [openIssues]);

  const priorityRows = useMemo(() => {
    const order: { priority: number; label: string }[] = [
      { priority: 1, label: "Urgent" },
      { priority: 2, label: "High" },
      { priority: 3, label: "Medium" },
      { priority: 4, label: "Low" },
      { priority: 0, label: "No priority" },
    ];
    const buckets = new Map<number, LinearIssue[]>();
    for (const item of order) buckets.set(item.priority, []);

    for (const issue of openIssues) {
      const key = buckets.has(issue.priority) ? issue.priority : 0;
      buckets.get(key)!.push(issue);
    }

    return order.map((item) => {
      const list = buckets.get(item.priority) ?? [];
      return {
        label: item.label,
        value: list.length,
        icon: <PriorityIcon priority={item.priority} className="h-3.5 w-3.5" />,
        onClick:
          list.length > 0
            ? () =>
                setDrilldown({
                  title: `Open ${item.label.toLowerCase()} priority issues`,
                  issues: list,
                })
            : undefined,
      };
    });
  }, [openIssues]);

  const ageColumns = useMemo(() => {
    const now = Date.now();
    const counts = [0, 0, 0, 0, 0, 0];
    const labels = ["<1w", "1–2w", "2–4w", "1–3mo", "3–6mo", ">6mo"];

    for (const issue of openIssues) {
      const createdMs = new Date(issue.created_at).getTime();
      if (Number.isNaN(createdMs)) continue;
      const ageDays = Math.max(0, (now - createdMs) / DAY_MS);
      if (ageDays < 7) counts[0] += 1;
      else if (ageDays < 14) counts[1] += 1;
      else if (ageDays < 28) counts[2] += 1;
      else if (ageDays < 90) counts[3] += 1;
      else if (ageDays < 180) counts[4] += 1;
      else counts[5] += 1;
    }

    return labels.map((label, idx) => ({
      label,
      value: counts[idx],
    }));
  }, [openIssues]);

  if (issues.length === 0) {
    return (
      <main className="surface-glow flex flex-1 items-center justify-center overflow-y-auto p-6">
        <div className="max-w-md rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center dark:border-white/12 dark:bg-[#10131B]/70">
          <BarChart3 className="mx-auto mb-3 h-8 w-8 text-indigo-500/75 dark:text-indigo-400/75" />
          <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
            No synced issues yet
          </p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Add your Linear API key in Settings and click Sync to populate
            velocity, status, and backlog age charts.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="surface-glow flex-1 overflow-y-auto px-6 py-6">
      <div className="mx-auto max-w-6xl space-y-5">
        {/* Header & Filter Row */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-zinc-900 dark:text-white">
              <BarChart3 className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
              Insights
            </h1>
            <p className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
              Throughput, backlog distribution, and age metrics from your local
              Linear cache.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <DarkSelect
              value={teamFilter}
              options={teamOptions}
              onChange={(val) => {
                setTeamFilter(val);
                setDrilldown(null);
              }}
              compact
            />
            <DarkSelect
              value={projectFilter}
              options={projectOptions}
              onChange={(val) => {
                setProjectFilter(val);
                setDrilldown(null);
              }}
              align="right"
              compact
            />
          </div>
        </div>

        {/* Stat Tiles Row */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-white/8 dark:bg-[#10131B]">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Open issues
            </div>
            <div className="mt-1 font-mono text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
              {summaryStats.openCount}
            </div>
            <div className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
              Not completed or canceled
            </div>
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-white/8 dark:bg-[#10131B]">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Created (30d)
            </div>
            <div className="mt-1 font-mono text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
              {summaryStats.created30d}
            </div>
            <div className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
              New issues in last 30 days
            </div>
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-white/8 dark:bg-[#10131B]">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Completed (30d)
            </div>
            <div className="mt-1 font-mono text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
              {summaryStats.completed30d}
            </div>
            <div className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
              Resolved in last 30 days
            </div>
          </div>

          <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 dark:border-white/8 dark:bg-[#10131B]">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
              Median open age
            </div>
            <div className="mt-1 font-mono text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
              {summaryStats.medianAgeDays === null
                ? "—"
                : summaryStats.medianAgeDays < 10
                ? `${summaryStats.medianAgeDays.toFixed(1)}d`
                : `${Math.round(summaryStats.medianAgeDays)}d`}
            </div>
            <div className="mt-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
              Days since creation
            </div>
          </div>
        </div>

        {/* Drilldown bar if a chart row was clicked */}
        {drilldown && (
          <div className="rounded-xl border border-indigo-200 bg-white p-4 dark:border-indigo-500/30 dark:bg-[#10131B]">
            <div className="mb-2.5 flex items-center justify-between gap-2">
              <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                {drilldown.title}{" "}
                <span className="ml-1 font-mono text-[11px] font-normal text-zinc-500">
                  ({drilldown.issues.length})
                </span>
              </div>
              <button
                type="button"
                onClick={() => setDrilldown(null)}
                className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-white/5 dark:hover:text-zinc-200"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="grid max-h-48 gap-1.5 overflow-y-auto sm:grid-cols-2">
              {drilldown.issues.slice(0, 24).map((issue) => (
                <button
                  key={issue.id}
                  type="button"
                  onClick={() => onSelectIdentifier(issue.identifier)}
                  className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-left text-xs transition hover:border-indigo-400 hover:bg-indigo-50/40 dark:border-white/8 dark:bg-[#0B0D13] dark:hover:border-indigo-500/40 dark:hover:bg-[#141824]"
                >
                  <PriorityIcon priority={issue.priority} className="h-3 w-3 shrink-0" />
                  <StateIcon
                    stateType={issue.state_type}
                    color={issue.state_color}
                    className="h-3 w-3 shrink-0"
                  />
                  <span className="shrink-0 font-mono text-[11px] font-semibold text-indigo-600 dark:text-indigo-400">
                    {issue.identifier}
                  </span>
                  <span className="truncate text-zinc-800 dark:text-zinc-200">
                    {issue.title}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Charts Grid */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Created vs completed, last 12 weeks */}
          <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-white/8 dark:bg-[#10131B] lg:col-span-2">
            <div className="mb-3">
              <h2 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                Created vs completed, last 12 weeks
              </h2>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Weekly Monday-start buckets comparing incoming volume with
                completed issues.
              </p>
            </div>
            <LineChart
              series={weeklyTrend.series}
              xLabels={weeklyTrend.xLabels}
              height={220}
            />
          </section>

          {/* Open issues by status */}
          <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-white/8 dark:bg-[#10131B]">
            <div className="mb-3">
              <h2 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                Open issues by status
              </h2>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Active workflow stages ordered from backlog through in progress.
              </p>
            </div>
            <HBarChart rows={statusRows} colorVar="--viz-series-1" />
          </section>

          {/* Open issues by assignee */}
          <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-white/8 dark:bg-[#10131B]">
            <div className="mb-3">
              <h2 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                Open issues by assignee
              </h2>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Current open workload across top assignees and unassigned queue.
              </p>
            </div>
            <HBarChart rows={assigneeRows} colorVar="--viz-series-1" />
          </section>

          {/* Open issues by priority */}
          <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-white/8 dark:bg-[#10131B]">
            <div className="mb-3">
              <h2 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                Open issues by priority
              </h2>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Distribution from urgent through low and unprioritized issues.
              </p>
            </div>
            <HBarChart rows={priorityRows} colorVar="--viz-series-1" />
          </section>

          {/* Age of open issues */}
          <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-white/8 dark:bg-[#10131B]">
            <div className="mb-3">
              <h2 className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                Age of open issues
              </h2>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Time elapsed since creation for currently open issues.
              </p>
            </div>
            <ColumnChart
              columns={ageColumns}
              colorVar="--viz-series-1"
              height={200}
            />
          </section>
        </div>

        {/* Footer Note */}
        <div className="pt-1 text-center text-[11px] text-zinc-500 dark:text-zinc-500">
          Based on {issues.length} synced issues (most recently updated first;
          Linear Pulse syncs up to ~2,800).
        </div>
      </div>
    </main>
  );
}
