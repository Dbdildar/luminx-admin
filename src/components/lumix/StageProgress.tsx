import { cn } from "@/lib/utils";

export type StageState = "idle" | "active" | "done" | "error";

export function StageProgress({
  label,
  detail,
  pct,
  state,
  tone = "cyan",
}: {
  label: string;
  detail?: string | undefined;
  pct: number;
  state: StageState;
  tone?: "cyan" | "emerald" | "pink";
}) {
  const bar =
    state === "error"
      ? "bg-destructive"
      : tone === "emerald"
        ? "bg-gradient-emerald"
        : tone === "pink"
          ? "bg-gradient-pink"
          : "bg-gradient-cyan";

  return (
    <div className={cn("glass px-3 py-2.5", state === "idle" && "opacity-55")}>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="truncate font-medium">{label}</span>
        <span className="font-mono text-[0.7rem]">
          {state === "error" ? "failed" : `${Math.round(pct)}%`}
        </span>
      </div>
      <div className="bg-muted/60 mt-2 h-1.5 overflow-hidden rounded-full">
        <div
          className={cn("h-full rounded-full transition-[width] duration-500 ease-out", bar)}
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
      {detail ? <p className="text-muted-foreground mt-1.5 text-[0.7rem]">{detail}</p> : null}
    </div>
  );
}
