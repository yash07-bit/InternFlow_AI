import * as React from "react";
import { cn } from "@/lib/utils";

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div aria-hidden="true" className={cn("animate-shimmer rounded-md bg-stone-200/70", className)} {...props} />;
}

export function Progress({
  value,
  className,
  indicatorClassName,
  label,
}: {
  value: number;
  className?: string;
  indicatorClassName?: string;
  label?: string;
}) {
  const v = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v)}
      aria-label={label}
      className={cn("relative h-1.5 w-full overflow-hidden rounded-full bg-stone-200/80", className)}
    >
      <div
        className={cn("h-full rounded-full bg-accent transition-[width] duration-700 ease-out", indicatorClassName)}
        style={{ width: `${v}%` }}
      />
    </div>
  );
}

export function Separator({ className, vertical = false }: { className?: string; vertical?: boolean }) {
  return <div role="separator" className={cn(vertical ? "h-full w-px" : "h-px w-full", "bg-line", className)} />;
}

export function Kbd({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return (
    <kbd
      className={cn("inline-flex h-5 items-center rounded border border-line bg-sunken px-1.5 font-mono text-[10px] text-ink-3", className)}
      {...props}
    />
  );
}
