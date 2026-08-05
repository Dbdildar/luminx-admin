import { Clock, Eye, Film, TrendingUp } from "lucide-react";

import { formatCount, formatDuration } from "@/lib/media";
import { MetricCard } from "./MetricCard";

type LiteRow = {
  id: string;
  title: string;
  views: number;
  duration_seconds: number;
  created_at: string;
};

/** Top-of-page snapshot: total videos, total views and this-month momentum. */
export function StatsHeader({ rows, loading }: { rows: LiteRow[]; loading?: boolean }) {
  const totalVideos = rows.length;
  const totalViews = rows.reduce((acc, r) => acc + Number(r.views ?? 0), 0);
  const totalRuntime = rows.reduce((acc, r) => acc + Number(r.duration_seconds ?? 0), 0);

  const thisMonth = new Date().toISOString().slice(0, 7);
  const monthRows = rows.filter((r) => r.created_at.slice(0, 7) === thisMonth);
  const monthViews = monthRows.reduce((acc, r) => acc + Number(r.views ?? 0), 0);

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <MetricCard
        label="Total videos"
        value={formatCount(totalVideos)}
        hint={`${formatCount(monthRows.length)} added this month`}
        icon={Film}
      />
      <MetricCard
        label="Total views"
        value={formatCount(totalViews)}
        hint={`${formatCount(monthViews)} on this month's uploads`}
        icon={Eye}
        tone="pink"
      />
      <MetricCard
        label="Avg views / video"
        value={formatCount(totalVideos ? Math.round(totalViews / totalVideos) : 0)}
        hint="Library-wide average"
        icon={TrendingUp}
        tone="emerald"
      />
      <MetricCard
        label="Total runtime"
        value={formatDuration(totalRuntime)}
        hint="Across every asset"
        icon={Clock}
        loading={Boolean(loading)}
      />
    </div>
  );
}
