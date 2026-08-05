import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { TiltCard } from "./GlassPanel";

const toneMap = {
  cyan: { bar: "bg-gradient-cyan", glow: "glow-cyan", text: "text-neon-cyan" },
  emerald: { bar: "bg-gradient-emerald", glow: "glow-emerald", text: "text-neon-emerald" },
  pink: { bar: "bg-gradient-pink", glow: "glow-pink", text: "text-neon-pink" },
} as const;

export function MetricCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "cyan",
  progress,
  loading,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: LucideIcon;
  tone?: keyof typeof toneMap;
  progress?: number;
  loading?: boolean;
}) {
  const t = toneMap[tone];

  return (
    <TiltCard className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-muted-foreground font-mono text-[0.6rem] tracking-[0.22em] uppercase">
            {label}
          </p>
          {loading ? (
            <div className="skeleton-shimmer mt-3 h-8 w-24 rounded-md" />
          ) : (
            <p className="tilt-layer mt-1 truncate text-2xl font-bold sm:text-3xl">{value}</p>
          )}
          {hint ? <p className="text-muted-foreground mt-1 text-xs">{hint}</p> : null}
        </div>
        <span
          className={cn("grid size-10 shrink-0 place-items-center rounded-xl sm:size-11", t.bar, t.glow)}
        >
          <Icon className="text-primary-foreground size-5" />
        </span>
      </div>
      <div className="bg-muted/60 mt-4 h-1.5 overflow-hidden rounded-full">
        <div
          className={cn("h-full rounded-full transition-all duration-700", t.bar)}
          style={{ width: `${Math.min(100, Math.max(4, progress ?? 100))}%` }}
        />
      </div>
    </TiltCard>
  );
}
