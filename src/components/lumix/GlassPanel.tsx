import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import { useTilt } from "@/hooks/use-tilt";

export function GlassPanel({
  children,
  className,
  raised,
}: {
  children: ReactNode;
  className?: string;
  raised?: boolean;
}) {
  return (
    <div className={cn(raised ? "glass-raised" : "glass", "neon-edge overflow-hidden", className)}>
      <div className="relative z-1">{children}</div>
    </div>
  );
}

export function TiltCard({
  children,
  className,
  maxDeg = 9,
}: {
  children: ReactNode;
  className?: string;
  maxDeg?: number;
}) {
  const tilt = useTilt(maxDeg);
  return (
    <div
      ref={tilt.ref}
      onMouseMove={tilt.onMouseMove}
      onMouseLeave={tilt.onMouseLeave}
      style={tilt.style}
      className={cn("glass neon-edge tilt-3d overflow-hidden", className)}
    >
      <div className="relative z-1">{children}</div>
    </div>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  action,
}: {
  eyebrow?: string;
  title: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        {eyebrow ? (
          <p className="font-mono text-[0.65rem] tracking-[0.28em] text-primary uppercase">
            {eyebrow}
          </p>
        ) : null}
        <h2 className="text-lg font-semibold sm:text-xl">{title}</h2>
      </div>
      {action}
    </div>
  );
}
