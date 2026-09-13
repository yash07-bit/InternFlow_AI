import { memo, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { AgentMessage, AgentRun, SecurityFlag, ToolCallRecord } from "@internflow/shared";
import {
  ArrowRight,
  ChevronDown,
  CircleCheck,
  CircleX,
  Hourglass,
  Info,
  LoaderCircle,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Flag,
} from "lucide-react";
import { AppIcon, appMeta } from "@/lib/apps";
import { buildTimeline, type TimelineEntry } from "@/lib/workflow";
import { formatClock, formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ToolDetails } from "@/components/run/ToolDetails";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/misc";

const enter = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.28, ease: [0.16, 1, 0.3, 1] as const },
};

export function ActivityTimeline({ run, followLive = true }: { run: AgentRun; followLive?: boolean }) {
  const entries = buildTimeline(run);
  const endRef = useRef<HTMLDivElement>(null);
  const lastCount = useRef(entries.length);
  const active = run.status !== "COMPLETED" && run.status !== "FAILED";

  // Gently keep the newest item in view while the agent works, only if the user is near it already.
  useEffect(() => {
    if (!followLive || !active || entries.length <= lastCount.current) {
      lastCount.current = entries.length;
      return;
    }
    lastCount.current = entries.length;
    const el = endRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const nearBottom = rect.top < window.innerHeight + 280;
    if (nearBottom) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [entries.length, active, followLive]);

  return (
    <div>
      <ol className="relative" aria-label="Agent activity" aria-live="polite" aria-relevant="additions">
        <AnimatePresence initial={false}>
          {entries.map((entry, i) => (
            <motion.li key={entry.id} {...enter} className="relative pb-3 last:pb-0">
              {i < entries.length - 1 && <span aria-hidden="true" className="absolute top-8 bottom-0 left-[15px] w-px bg-line" />}
              <TimelineEntryView entry={entry} run={run} />
            </motion.li>
          ))}
        </AnimatePresence>
        {active && <ThinkingRow hasEntries={entries.length > 0} run={run} />}
      </ol>
      <div ref={endRef} />
    </div>
  );
}

function ThinkingRow({ hasEntries, run }: { hasEntries: boolean; run: AgentRun }) {
  const busy = run.toolCalls.some((c) => c.status === "running");
  if (busy || run.status === "WAITING_FOR_APPROVAL") return null;
  return (
    <li className={cn("relative flex items-center gap-3", hasEntries && "pt-3")}>
      <span className="relative flex size-8 shrink-0 items-center justify-center rounded-full border border-accent-muted bg-accent-soft">
        <span className="absolute inset-0 animate-soft-ping rounded-full border border-accent/40" />
        <Sparkles className="size-3.5 text-accent" />
      </span>
      <span className="text-[13px] text-ink-3">{hasEntries ? "Agent is deciding the next step…" : "Agent is planning the workflow…"}</span>
    </li>
  );
}

const TimelineEntryView = memo(function TimelineEntryView({ entry, run }: { entry: TimelineEntry; run: AgentRun }) {
  if (entry.kind === "message") return <MessageItem message={entry.message} />;
  if (entry.kind === "security") return <SecurityFlagItem flag={entry.flag} />;
  return <ToolItem toolCall={entry.toolCall} run={run} />;
});

// ---------------------------------------------------------------------------

function ToolStatusIcon({ status }: { status: ToolCallRecord["status"] }) {
  switch (status) {
    case "running":
      return <LoaderCircle className="size-4 animate-spin text-accent" aria-label="Running" />;
    case "completed":
      return <CircleCheck className="size-4 text-emerald-600" aria-label="Completed" />;
    case "failed":
      return <TriangleAlert className="size-4 text-rose-500" aria-label="Failed" />;
    case "awaiting_approval":
      return <Hourglass className="size-4 text-amber-500" aria-label="Awaiting approval" />;
    case "rejected":
      return <CircleX className="size-4 text-ink-4" aria-label="Rejected" />;
  }
}

function useTicker(active: boolean, startedAt: string) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(t);
  }, [active]);
  return Math.max(0, now - Date.parse(startedAt));
}

function ToolItem({ toolCall, run }: { toolCall: ToolCallRecord; run: AgentRun }) {
  const [open, setOpen] = useState(false);
  const meta = appMeta(toolCall.app);
  const running = toolCall.status === "running";
  const elapsed = useTicker(running, toolCall.startedAt);
  const panelId = `tool-${toolCall.id}`;

  const line =
    toolCall.status === "running"
      ? toolCall.activity
      : toolCall.status === "failed"
        ? (toolCall.summary ?? toolCall.error?.message ?? "Tool failed")
        : toolCall.status === "awaiting_approval"
          ? (toolCall.summary ?? "Prepared — waiting for your approval")
          : toolCall.status === "rejected"
            ? (toolCall.summary ?? "Skipped — not approved")
            : (toolCall.summary ?? toolCall.activity);

  return (
    <div className="flex gap-3">
      <div className="relative z-[1] mt-0.5 shrink-0">
        <span
          className={cn(
            "flex size-8 items-center justify-center rounded-full border bg-surface",
            running ? "border-accent/50 ring-4 ring-accent/10" : "border-line",
            toolCall.status === "awaiting_approval" && "border-amber-300 ring-4 ring-amber-100",
          )}
        >
          <AppIcon app={toolCall.app} size="xs" bare={toolCall.app !== "internflow"} className={toolCall.app === "internflow" ? "size-[18px]" : "size-4"} />
        </span>
      </div>

      <div
        className={cn(
          "min-w-0 flex-1 rounded-card border bg-surface shadow-card transition-colors",
          running ? "border-accent/35" : "border-line",
          toolCall.status === "failed" && "border-rose-200",
          toolCall.status === "awaiting_approval" && "border-amber-200",
        )}
      >
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={panelId}
          className="flex w-full items-start gap-3 rounded-card px-3.5 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="text-[13px] font-medium text-ink">{meta.label}</span>
              <span className="text-ink-4">·</span>
              <code className="rounded bg-sunken px-1.5 py-px font-mono text-[11.5px] text-ink-2">{toolCall.tool}</code>
              {toolCall.riskLevel !== "read" && (
                <Badge size="sm" tone={toolCall.riskLevel === "dangerous" ? "warning" : "outline"} className="h-[18px] px-1.5 text-[10.5px]">
                  {toolCall.riskLevel === "dangerous" ? "approval" : "write"}
                </Badge>
              )}
            </div>
            <div className="mt-1 flex items-start gap-1.5">
              <span className="mt-0.5">
                <ToolStatusIcon status={toolCall.status} />
              </span>
              <p
                className={cn(
                  "min-w-0 text-[13px] leading-5",
                  running ? "text-ink-2" : "text-ink-2",
                  toolCall.status === "failed" && "text-rose-700",
                  toolCall.status === "rejected" && "text-ink-3 line-through decoration-ink-4/60",
                )}
              >
                {line}
                {running && <span className="ml-0.5 inline-block animate-pulse text-accent">▍</span>}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1 pt-0.5">
            <span className="font-mono text-[11px] text-ink-4 tabular">{formatClock(toolCall.startedAt)}</span>
            <span className={cn("font-mono text-[11px] tabular", running ? "text-accent" : "text-ink-3")}>
              {running ? formatDuration(elapsed) : formatDuration(toolCall.durationMs)}
            </span>
          </div>
          <ChevronDown className={cn("mt-1 size-4 shrink-0 text-ink-4 transition-transform", open && "rotate-180")} aria-hidden="true" />
        </button>
        <AnimatePresence initial={false}>
          {open && (
            <motion.div
              id={panelId}
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="px-3.5 pb-3.5">
                <ToolDetails toolCall={toolCall} run={run} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function MessageItem({ message }: { message: AgentMessage }) {
  if (message.kind === "decision") {
    return (
      <div className="flex gap-3">
        <span className="relative z-[1] mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border border-accent-muted bg-accent-soft">
          <Sparkles className="size-3.5 text-accent" />
        </span>
        <div className="min-w-0 flex-1 rounded-card border border-accent-muted/80 bg-gradient-to-b from-accent-soft/70 to-surface px-3.5 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-semibold tracking-[0.06em] text-accent uppercase">Agent decision</span>
            <span className="font-mono text-[11px] text-ink-4 tabular">{formatClock(message.createdAt)}</span>
          </div>
          <p className="mt-1 text-[13.5px] leading-[1.45rem] text-ink">“{message.text}”</p>
          {message.using && message.using.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-[11.5px] text-ink-3">Using:</span>
              {message.using.map((u, i) => (
                <span
                  key={`${u.app}-${u.label}-${i}`}
                  className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-1.5 py-0.5 text-[12px] text-ink-2"
                >
                  <AppIcon app={u.app} size="xs" bare={u.app !== "internflow"} className={u.app === "internflow" ? "size-3.5" : "size-3.5"} />
                  {appMeta(u.app).label}
                  <ArrowRight className="size-3 text-ink-4" />
                  <span className="font-medium text-ink">{u.label}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  const tone =
    message.kind === "warning"
      ? { ring: "border-amber-200 bg-amber-50", icon: <TriangleAlert className="size-3.5 text-amber-600" />, text: "text-amber-900", card: "border-amber-200 bg-amber-50/60" }
      : message.kind === "final"
        ? { ring: "border-emerald-200 bg-emerald-50", icon: <Flag className="size-3.5 text-emerald-600" />, text: "text-ink", card: "border-emerald-200 bg-emerald-50/50" }
        : { ring: "border-line bg-surface", icon: <Info className="size-3.5 text-ink-3" />, text: "text-ink-2", card: "border-transparent bg-transparent" };

  return (
    <div className="flex gap-3">
      <span className={cn("relative z-[1] mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border", tone.ring)}>{tone.icon}</span>
      <div className={cn("flex min-w-0 flex-1 items-start justify-between gap-3 rounded-card border px-3.5 py-2", tone.card, message.kind === "info" && "px-1")}>
        <p className={cn("pt-0.5 text-[13px] leading-5", tone.text)}>
          {message.kind === "warning" && <span className="font-semibold">Recovered: </span>}
          {message.text}
        </p>
        <span className="shrink-0 pt-0.5 font-mono text-[11px] text-ink-4 tabular">{formatClock(message.createdAt)}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function SecurityFlagItem({ flag }: { flag: SecurityFlag }) {
  const meta = appMeta(flag.source);
  const title =
    flag.type === "prompt_injection" ? "Untrusted instruction ignored" : flag.type === "suspicious_link" ? "Suspicious link ignored" : "Untrusted content truncated";
  return (
    <div className="flex gap-3">
      <span className="relative z-[1] mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border border-stone-300 bg-stone-100">
        <ShieldCheck className="size-4 text-ink-2" />
      </span>
      <div className="min-w-0 flex-1 overflow-hidden rounded-card border border-stone-300 bg-surface shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-stone-50 px-3.5 py-2">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-ink">{title}</span>
            <Badge size="sm" tone="outline" className="font-mono text-[10.5px]">
              {flag.type}
            </Badge>
          </div>
          <span className="font-mono text-[11px] text-ink-4 tabular">{formatClock(flag.createdAt)}</span>
        </div>
        <div className="space-y-2 px-3.5 py-3">
          <div className="flex items-center gap-2 text-[12.5px] text-ink-3">
            <span>Source</span>
            <span className="inline-flex items-center gap-1.5 text-ink-2">
              <AppIcon app={flag.source} size="xs" bare={flag.source !== "internflow"} className="size-3.5" />
              {meta.label} content
            </span>
          </div>
          <blockquote className="rounded-md border-l-2 border-stone-300 bg-sunken px-3 py-2 font-mono text-[12px] leading-5 break-words text-ink-2">
            {flag.excerpt}
          </blockquote>
          <p className="flex items-start gap-1.5 text-[12.5px] text-ink-2">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
            <span>
              <span className="font-medium text-ink">{flag.action}</span>
              <span className="text-ink-3"> — external content is treated as data, never as instructions. No action was taken.</span>
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}

export function TimelineSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex gap-3">
          <Skeleton className="size-8 rounded-full" />
          <Skeleton className="h-16 flex-1 rounded-card" />
        </div>
      ))}
    </div>
  );
}
