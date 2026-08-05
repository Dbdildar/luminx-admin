import { useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatCount, formatDuration } from "@/lib/media";
import type { CategoryStat } from "@/lib/lumix-data";
import { GlassPanel, SectionHeading } from "./GlassPanel";

const NEON = [
  "var(--neon-cyan)",
  "var(--neon-emerald)",
  "var(--neon-pink)",
  "var(--neon-violet)",
  "var(--neon-amber)",
];

type LiteRow = {
  id: string;
  title: string;
  category: string;
  views: number;
  duration_seconds: number;
  created_at: string;
};

function tooltipStyle() {
  return {
    contentStyle: {
      background: "var(--popover)",
      border: "1px solid var(--border)",
      borderRadius: "0.9rem",
      backdropFilter: "blur(16px) saturate(180%)",
      color: "var(--popover-foreground)",
      fontSize: 12,
      boxShadow: "var(--shadow-lift)",
    },
    labelStyle: { color: "var(--muted-foreground)", fontSize: 11 },
  };
}

export function AnalyticsPanel({ rows, stats }: { rows: LiteRow[]; stats: CategoryStat[] }) {
  const timeline = useMemo(() => {
    const buckets = new Map<string, { day: string; uploads: number; views: number }>();
    rows.forEach((row) => {
      const day = new Date(row.created_at).toISOString().slice(0, 10);
      const entry = buckets.get(day) ?? { day, uploads: 0, views: 0 };
      entry.uploads += 1;
      entry.views += Number(row.views ?? 0);
      buckets.set(day, entry);
    });
    return Array.from(buckets.values())
      .sort((a, b) => a.day.localeCompare(b.day))
      .slice(-14)
      .map((entry) => ({ ...entry, label: entry.day.slice(5) }));
  }, [rows]);

  const monthly = useMemo(() => {
    const buckets = new Map<string, { key: string; uploads: number; views: number }>();
    rows.forEach((row) => {
      const key = new Date(row.created_at).toISOString().slice(0, 7);
      const entry = buckets.get(key) ?? { key, uploads: 0, views: 0 };
      entry.uploads += 1;
      entry.views += Number(row.views ?? 0);
      buckets.set(key, entry);
    });
    return Array.from(buckets.values())
      .sort((a, b) => a.key.localeCompare(b.key))
      .slice(-12)
      .map((entry) => ({
        ...entry,
        label: new Date(`${entry.key}-01T00:00:00Z`).toLocaleDateString(undefined, {
          month: "short",
          year: "2-digit",
          timeZone: "UTC",
        }),
      }));
  }, [rows]);

  const perVideo = useMemo(() => {
    const max = Math.max(1, ...rows.map((r) => Number(r.views ?? 0)));
    return [...rows]
      .sort((a, b) => Number(b.views) - Number(a.views))
      .map((row) => ({
        id: row.id,
        title: row.title,
        category: row.category,
        duration_seconds: Number(row.duration_seconds ?? 0),
        views: Number(row.views ?? 0),
        pct: Math.round((Number(row.views ?? 0) / max) * 100),
        month: new Date(row.created_at).toLocaleDateString(undefined, {
          month: "short",
          year: "numeric",
        }),
      }));
  }, [rows]);

  const distribution = useMemo(
    () =>
      stats.slice(0, 6).map((stat, index) => ({
        name: stat.category,
        value: Number(stat.total),
        views: Number(stat.total_views),
        fill: NEON[index % NEON.length],
      })),
    [stats],
  );

  const topViewed = useMemo(
    () =>
      [...rows]
        .sort((a, b) => Number(b.views) - Number(a.views))
        .slice(0, 6)
        .map((row, index) => ({
          name: row.title.length > 18 ? `${row.title.slice(0, 18)}…` : row.title,
          views: Number(row.views),
          fill: NEON[index % NEON.length],
        })),
    [rows],
  );

  const storage = useMemo(() => {
    // Estimated storage from runtime at a 2.4 Mbps average HLS ladder.
    const totals = stats.slice(0, 5).map((stat, index) => ({
      name: stat.category,
      gb: Number(((Number(stat.total_duration) * 2.4) / 8 / 1024).toFixed(2)),
      fill: NEON[index % NEON.length],
    }));
    const max = Math.max(1, ...totals.map((t) => t.gb));
    return totals.map((t) => ({ ...t, pct: Math.round((t.gb / max) * 100) }));
  }, [stats]);

  const totalRuntime = stats.reduce((acc, s) => acc + Number(s.total_duration), 0);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <GlassPanel className="p-4 sm:p-5 lg:col-span-2">
        <SectionHeading eyebrow="Signal" title="Views & uploads · last 14 active days" />
        <div className="h-[220px] w-full sm:h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={timeline} margin={{ top: 6, right: 6, left: -22, bottom: 0 }}>
              <defs>
                <linearGradient id="viewsFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--neon-cyan)" stopOpacity={0.7} />
                  <stop offset="100%" stopColor="var(--neon-cyan)" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="uploadsFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--neon-pink)" stopOpacity={0.6} />
                  <stop offset="100%" stopColor="var(--neon-pink)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 6" vertical={false} />
              <XAxis
                dataKey="label"
                stroke="var(--muted-foreground)"
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                stroke="var(--muted-foreground)"
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip {...tooltipStyle()} />
              <Area
                type="monotone"
                dataKey="views"
                name="Views"
                stroke="var(--neon-cyan)"
                strokeWidth={2.5}
                fill="url(#viewsFill)"
              />
              <Area
                type="monotone"
                dataKey="uploads"
                name="Uploads"
                stroke="var(--neon-pink)"
                strokeWidth={2}
                fill="url(#uploadsFill)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </GlassPanel>

      <GlassPanel className="p-4 sm:p-5 lg:col-span-2">
        <SectionHeading eyebrow="Monthly" title="Views consolidated month by month" />
        <div className="h-[220px] w-full sm:h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={monthly} margin={{ top: 6, right: 6, left: -22, bottom: 0 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 6" vertical={false} />
              <XAxis
                dataKey="label"
                stroke="var(--muted-foreground)"
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                stroke="var(--muted-foreground)"
                tick={{ fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip {...tooltipStyle()} />
              <Legend wrapperStyle={{ fontSize: 11, color: "var(--muted-foreground)" }} />
              <Bar dataKey="views" name="Views" fill="var(--neon-cyan)" radius={[6, 6, 0, 0]} />
              <Bar dataKey="uploads" name="Uploads" fill="var(--neon-pink)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {monthly.slice(-6).map((month) => (
            <li key={month.label} className="glass flex items-center gap-2 px-3 py-2 text-sm">
              <span className="flex-1 truncate">{month.label}</span>
              <span className="text-muted-foreground text-xs">{month.uploads} videos</span>
              <span className="font-mono text-xs">{formatCount(month.views)} views</span>
            </li>
          ))}
        </ul>
      </GlassPanel>

      <GlassPanel className="p-4 sm:p-5 lg:col-span-2">
        <SectionHeading eyebrow="Video-wise" title={`Views per video · ${formatCount(rows.length)} assets`} />
        <ul className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
          {perVideo.length === 0 ? (
            <li className="text-muted-foreground text-sm">No media yet.</li>
          ) : null}
          {perVideo.map((row, index) => (
            <li key={row.id} className="glass px-3 py-2">
              <div className="flex items-center gap-3">
                <span className="text-muted-foreground w-6 shrink-0 font-mono text-xs">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">{row.title}</span>
                <span className="font-mono text-xs whitespace-nowrap">
                  {formatCount(row.views)} views
                </span>
              </div>
              <div className="bg-muted mt-2 h-1.5 overflow-hidden rounded-full">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${row.pct}%`,
                    background: NEON[index % NEON.length],
                  }}
                />
              </div>
              <p className="text-muted-foreground mt-1 font-mono text-[0.65rem]">
                {row.month} · {formatDuration(row.duration_seconds)} · {row.category}
              </p>
            </li>
          ))}
        </ul>
      </GlassPanel>

      <GlassPanel className="p-4 sm:p-5">
        <SectionHeading eyebrow="Mix" title="Category distribution" />
        <div className="h-[240px] w-full sm:h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Tooltip {...tooltipStyle()} />
              <Legend
                verticalAlign="bottom"
                iconType="circle"
                wrapperStyle={{ fontSize: 11, color: "var(--muted-foreground)" }}
              />
              <Pie
                data={distribution}
                dataKey="value"
                nameKey="name"
                innerRadius="52%"
                outerRadius="82%"
                paddingAngle={3}
                stroke="var(--background)"
                strokeWidth={2}
              >
                {distribution.map((entry) => (
                  <Cell key={entry.name} fill={entry.fill} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>
      </GlassPanel>

      <GlassPanel className="p-4 sm:p-5">
        <SectionHeading eyebrow="Leaders" title="Most watched titles" />
        <div className="h-[240px] w-full sm:h-[280px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={topViewed} layout="vertical" margin={{ left: 4, right: 12 }}>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 6" horizontal={false} />
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="name"
                width={92}
                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip {...tooltipStyle()} />
              <Bar dataKey="views" name="Views" radius={[6, 6, 6, 6]} barSize={14}>
                {topViewed.map((entry) => (
                  <Cell key={entry.name} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </GlassPanel>

      <GlassPanel className="p-4 sm:p-5 lg:col-span-2">
        <SectionHeading
          eyebrow="Storage"
          title={`Estimated CDN footprint · ${formatDuration(totalRuntime)} runtime`}
        />
        <div className="grid gap-4 md:grid-cols-2">
          <div className="h-[220px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <RadialBarChart
                data={storage}
                innerRadius="26%"
                outerRadius="100%"
                startAngle={200}
                endAngle={-20}
              >
                <Tooltip {...tooltipStyle()} />
                <RadialBar dataKey="pct" background cornerRadius={10}>
                  {storage.map((entry) => (
                    <Cell key={entry.name} fill={entry.fill} />
                  ))}
                </RadialBar>
              </RadialBarChart>
            </ResponsiveContainer>
          </div>
          <ul className="space-y-2 self-center">
            {storage.length === 0 ? (
              <li className="text-muted-foreground text-sm">No media yet.</li>
            ) : null}
            {storage.map((entry) => (
              <li key={entry.name} className="glass flex items-center gap-3 px-3 py-2">
                <span className="size-2.5 rounded-full" style={{ background: entry.fill }} />
                <span className="flex-1 truncate text-sm">{entry.name}</span>
                <span className="font-mono text-xs">{entry.gb} GB</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-muted-foreground mt-3 text-xs">
          Totals across {formatCount(rows.length)} assets, estimated from runtime at a 2.4 Mbps
          adaptive ladder.
        </p>
      </GlassPanel>
    </div>
  );
}
