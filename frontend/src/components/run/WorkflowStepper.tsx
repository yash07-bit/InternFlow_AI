import type { AgentRun } from "@internflow/shared";
import { Check, Hourglass, TriangleAlert, Minus } from "lucide-react";
import { deriveStages, type StageState } from "@/lib/workflow";
import { cn } from "@/lib/utils";

const STATE_LABEL: Record<StageState, string> = {
  pending: "Not started",
  active: "In progress",
  done: "Done",
  warning: "Needs attention",
  waiting: "Waiting for approval",
  skipped: "Skipped",
};

export function WorkflowStepper({ run }: { run: AgentRun }) {
  const stages = deriveStages(run);
  const doneCount = stages.filter((s) => s.state === "done").length;

  return (
    <div className="rounded-card border border-line bg-surface px-3 py-3 shadow-card sm:px-4">
      <ol className="flex items-center overflow-x-auto pb-0.5 [scrollbar-width:thin]" aria-label={`Workflow progress: ${doneCount} of ${stages.length} stages done`}>
        {stages.map((stage, i) => (
          <li key={stage.id} className="flex min-w-0 flex-1 items-center">
            <div className="flex min-w-[64px] flex-col items-center gap-1.5 px-1" aria-label={`${stage.label}: ${STATE_LABEL[stage.state]}`}>
              <StageDot state={stage.state} index={i + 1} />
              <span
                className={cn(
                  "text-[11.5px] font-medium whitespace-nowrap",
                  stage.state === "pending" || stage.state === "skipped" ? "text-ink-4" : "text-ink-2",
                  stage.state === "active" && "text-accent",
                  stage.state === "waiting" && "text-amber-700",
                  stage.state === "warning" && "text-amber-700",
                )}
              >
                {stage.label}
              </span>
            </div>
            {i < stages.length - 1 && (
              <div className="relative mx-0.5 mb-5 h-px min-w-3 flex-1 bg-line">
                <div
                  className={cn(
                    "absolute inset-y-0 left-0 bg-accent transition-[width] duration-500",
                    stage.state === "done" || stage.state === "warning" ? "w-full" : "w-0",
                  )}
                />
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function StageDot({ state, index }: { state: StageState; index: number }) {
  const base = "relative flex size-6 items-center justify-center rounded-full border text-[11px] font-semibold tabular";
  switch (state) {
    case "done":
      return (
        <span className={cn(base, "border-accent bg-accent text-white")}>
          <Check className="size-3.5" strokeWidth={3} />
        </span>
      );
    case "active":
      return (
        <span className={cn(base, "border-accent bg-accent-soft text-accent")}>
          <span className="absolute inset-0 animate-soft-ping rounded-full border-2 border-accent/50" />
          <span className="size-2 rounded-full bg-accent" />
        </span>
      );
    case "waiting":
      return (
        <span className={cn(base, "border-amber-400 bg-amber-50 text-amber-600")}>
          <span className="absolute inset-0 animate-soft-ping rounded-full border-2 border-amber-400/60" />
          <Hourglass className="size-3" />
        </span>
      );
    case "warning":
      return (
        <span className={cn(base, "border-amber-300 bg-amber-50 text-amber-600")}>
          <TriangleAlert className="size-3" />
        </span>
      );
    case "skipped":
      return (
        <span className={cn(base, "border-dashed border-line-strong bg-surface text-ink-4")}>
          <Minus className="size-3" />
        </span>
      );
    default:
      return <span className={cn(base, "border-line bg-canvas text-ink-4")}>{index}</span>;
  }
}
