import { motion } from "framer-motion";
import type { AgentRun, AppId } from "@internflow/shared";
import { Check, Hourglass, TriangleAlert } from "lucide-react";
import { APP_ORDER, AppIcon, InternFlowGlyph, appMeta } from "@/lib/apps";
import { deriveAppActivity, type AppActivity } from "@/lib/workflow";
import { cn } from "@/lib/utils";

/**
 * Hub-and-spoke view: the agent in the middle, the five apps around it.
 * Nodes light up while their tool runs; connectors animate toward the active app.
 */
export function OrchestrationPanel({ run }: { run: AgentRun }) {
  const activity = deriveAppActivity(run);
  const engine = activity.internflow;
  const anyActive = Object.values(activity).some((a) => a.state === "active");
  const current = Object.values(activity).find((a) => a.state === "active")?.current;
  const W = 340;
  const hubY = 44;
  const nodeY = 128;
  const xs = APP_ORDER.map((_, i) => 34 + i * ((W - 68) / (APP_ORDER.length - 1)));

  return (
    <section className="rounded-card border border-line bg-surface shadow-card" aria-label="App orchestration">
      <div className="flex items-center justify-between px-4 pt-3.5">
        <h2 className="text-[13px] font-semibold text-ink">App orchestration</h2>
        <span className="font-mono text-[11px] text-ink-3 tabular">
          {run.toolCalls.length} call{run.toolCalls.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="relative mx-auto w-full max-w-[380px] px-2 pt-1 pb-5">
        <svg viewBox={`0 0 ${W} 150`} className="absolute inset-x-2 top-1 h-auto w-[calc(100%-1rem)]" aria-hidden="true">
          {APP_ORDER.map((app, i) => {
            const a = activity[app];
            const x = xs[i];
            const path = `M ${W / 2} ${hubY + 18} C ${W / 2} ${hubY + 50}, ${x} ${nodeY - 60}, ${x} ${nodeY - 24}`;
            const color = a.state === "active" ? "#0F766E" : a.state === "waiting" ? "#F59E0B" : a.state === "done" ? "#99F6E4" : a.state === "failed" ? "#FECDD3" : "#E7E5E4";
            return (
              <g key={app}>
                <path d={path} fill="none" stroke={color} strokeWidth={a.state === "active" ? 1.8 : 1.4} />
                {(a.state === "active" || a.state === "waiting") && (
                  <path d={path} fill="none" stroke="#FFFFFF" strokeWidth={2} strokeDasharray="3 13" className="animate-dash" />
                )}
              </g>
            );
          })}
        </svg>

        <div className="relative" style={{ aspectRatio: `${W} / 150` }}>
          {/* Hub */}
          <div className="absolute left-1/2 -translate-x-1/2" style={{ top: `${((hubY - 22) / 150) * 100}%` }}>
            <div
              className={cn(
                "relative flex items-center gap-2 rounded-full border bg-surface py-1 pr-3 pl-1 shadow-card",
                anyActive || engine.state === "active" ? "border-accent/40" : "border-line",
              )}
            >
              {(anyActive || engine.state === "active") && <span className="absolute inset-0 animate-soft-ping rounded-full border border-accent/30" />}
              <InternFlowGlyph className="size-7" />
              <span className="text-[12px] font-medium whitespace-nowrap text-ink">InternFlow Agent</span>
            </div>
          </div>

          {/* Nodes */}
          {APP_ORDER.map((app, i) => (
            <div
              key={app}
              className="absolute -translate-x-1/2"
              style={{ left: `${(xs[i] / W) * 100}%`, top: `${((nodeY - 24) / 150) * 100}%` }}
            >
              <AppNode activity={activity[app]} />
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 border-t border-line px-4 py-2.5">
        {current ? (
          <p className="flex items-center gap-2 truncate text-[12.5px] text-ink-2">
            <span className="relative flex size-1.5 shrink-0">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-60" />
              <span className="relative inline-flex size-1.5 rounded-full bg-accent" />
            </span>
            <span className="font-medium text-ink">{appMeta(current.app).short}</span>
            <span className="truncate text-ink-3">{current.activity}</span>
          </p>
        ) : engine.state === "active" && engine.current ? (
          <p className="flex items-center gap-2 truncate text-[12.5px] text-ink-3">
            <span className="size-1.5 shrink-0 rounded-full bg-accent" />
            <span className="font-medium text-ink">Engine</span> {engine.current.activity}
          </p>
        ) : (
          <p className="text-[12.5px] text-ink-3">
            {run.status === "COMPLETED"
              ? `Coordinated ${new Set(run.toolCalls.filter((c) => c.status === "completed" && c.app !== "internflow").map((c) => c.app)).size} apps in one workflow.`
              : run.status === "FAILED"
                ? "Workflow stopped."
                : run.status === "WAITING_FOR_APPROVAL"
                  ? "Paused — waiting for your approval."
                  : "Agent is choosing the next tool…"}
          </p>
        )}
      </div>
    </section>
  );
}

function AppNode({ activity }: { activity: AppActivity }) {
  const meta = appMeta(activity.app as AppId);
  const { state } = activity;
  return (
    <div className="flex w-[60px] flex-col items-center gap-1" aria-label={`${meta.label}: ${state}`}>
      <motion.div
        animate={state === "active" ? { scale: 1.08 } : { scale: 1 }}
        transition={{ type: "spring", stiffness: 380, damping: 22 }}
        className={cn(
          "relative flex size-11 items-center justify-center rounded-xl border bg-surface shadow-card transition-colors",
          state === "idle" && "border-line opacity-70 grayscale-[0.6]",
          state === "active" && "border-accent ring-4 ring-accent/15",
          state === "waiting" && "border-amber-400 ring-4 ring-amber-100",
          state === "done" && "border-accent-line",
          state === "failed" && "border-rose-300",
        )}
      >
        {state === "active" && <span className="absolute -inset-1 animate-soft-ping rounded-[14px] border-2 border-accent/40" />}
        <AppIcon app={activity.app} size="md" bare className="size-6" />
        {state === "done" && (
          <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-white ring-2 ring-surface">
            {activity.completed > 1 ? activity.completed : <Check className="size-2.5" strokeWidth={3.5} />}
          </span>
        )}
        {state === "waiting" && (
          <span className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-amber-500 text-white ring-2 ring-surface">
            <Hourglass className="size-2.5" />
          </span>
        )}
        {state === "failed" && (
          <span className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-rose-500 text-white ring-2 ring-surface">
            <TriangleAlert className="size-2.5" />
          </span>
        )}
      </motion.div>
      <span className={cn("text-[11px] font-medium whitespace-nowrap", state === "idle" ? "text-ink-4" : "text-ink-2", state === "active" && "text-accent")}>
        {meta.short}
      </span>
    </div>
  );
}
