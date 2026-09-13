import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { ApplicationStatus, RiskLevel, SkillMatchStatus, WorkflowStatus } from "@internflow/shared";
import { CircleAlert, CircleCheck, CircleX, RefreshCw, ShieldAlert, ShieldCheck, TriangleAlert, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InternFlowGlyph } from "@/lib/apps";
import { APPLICATION_STATUS_TONE, isActiveStatus, workflowStatusLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

export function Logo({ to = "/", subtitle = false, className }: { to?: string; subtitle?: boolean; className?: string }) {
  return (
    <Link to={to} className={cn("group flex items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40", className)}>
      <InternFlowGlyph className="size-7 transition-transform group-hover:scale-[1.04]" />
      <span className="flex flex-col leading-none">
        <span className="text-[15px] font-semibold tracking-[-0.015em] text-ink">
          InternFlow <span className="text-accent">AI</span>
        </span>
        {subtitle && <span className="mt-1 hidden text-[11px] text-ink-3 sm:block">AI Internship Application Agent</span>}
      </span>
    </Link>
  );
}

// ---------------------------------------------------------------------------

const RUN_TONE: Record<WorkflowStatus, { cls: string; dot: string }> = {
  IDLE: { cls: "border-line bg-sunken text-ink-2", dot: "bg-ink-4" },
  ANALYZING_JOB: { cls: "border-accent-muted bg-accent-soft text-accent", dot: "bg-accent" },
  FINDING_RESUME: { cls: "border-accent-muted bg-accent-soft text-accent", dot: "bg-accent" },
  MATCHING_RESUME: { cls: "border-accent-muted bg-accent-soft text-accent", dot: "bg-accent" },
  SEARCHING_EMAIL: { cls: "border-accent-muted bg-accent-soft text-accent", dot: "bg-accent" },
  GENERATING_MATERIAL: { cls: "border-accent-muted bg-accent-soft text-accent", dot: "bg-accent" },
  UPDATING_TRACKER: { cls: "border-accent-muted bg-accent-soft text-accent", dot: "bg-accent" },
  CHECKING_CALENDAR: { cls: "border-accent-muted bg-accent-soft text-accent", dot: "bg-accent" },
  WAITING_FOR_APPROVAL: { cls: "border-amber-200 bg-amber-50 text-amber-800", dot: "bg-amber-500" },
  COMPLETED: { cls: "border-emerald-200 bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" },
  FAILED: { cls: "border-rose-200 bg-rose-50 text-rose-700", dot: "bg-rose-500" },
};

export function RunStatusPill({ status, size = "md", className }: { status: WorkflowStatus; size?: "sm" | "md"; className?: string }) {
  const tone = RUN_TONE[status] ?? RUN_TONE.IDLE;
  const pulsing = isActiveStatus(status) || status === "WAITING_FOR_APPROVAL";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-medium whitespace-nowrap",
        size === "sm" ? "h-5 px-2 text-[11px]" : "h-6 px-2.5 text-xs",
        tone.cls,
        className,
      )}
    >
      <span className="relative flex size-1.5">
        {pulsing && <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-60", tone.dot)} />}
        <span className={cn("relative inline-flex size-1.5 rounded-full", tone.dot)} />
      </span>
      {workflowStatusLabel(status)}
    </span>
  );
}

export function ApplicationStatusBadge({ status, className }: { status: ApplicationStatus; className?: string }) {
  return (
    <Badge tone={APPLICATION_STATUS_TONE[status] ?? "neutral"} size="sm" className={className}>
      {status}
    </Badge>
  );
}

export function RiskBadge({ risk, className }: { risk: RiskLevel; className?: string }) {
  if (risk === "read")
    return (
      <Badge tone="outline" size="sm" className={className}>
        <ShieldCheck /> Read-only
      </Badge>
    );
  if (risk === "write")
    return (
      <Badge tone="info" size="sm" className={className}>
        Low-risk write
      </Badge>
    );
  return (
    <Badge tone="warning" size="sm" className={className}>
      <ShieldAlert /> Requires approval
    </Badge>
  );
}

// ---------------------------------------------------------------------------

export function ScoreRing({
  score,
  size = 112,
  stroke = 9,
  label = "match",
  className,
}: {
  score: number;
  size?: number;
  stroke?: number;
  label?: string;
  className?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, score));
  const color = v >= 75 ? "#0F766E" : v >= 55 ? "#D97706" : "#E11D48";
  return (
    <div className={cn("relative inline-flex shrink-0 items-center justify-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#E7E5E4" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v / 100)}
          style={{ transition: "stroke-dashoffset 900ms cubic-bezier(0.16,1,0.3,1)" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center" role="img" aria-label={`${Math.round(v)}% ${label}`}>
        <span className="tabular text-[28px] leading-none font-semibold tracking-[-0.03em] text-ink" style={{ fontSize: size * 0.27 }}>
          {Math.round(v)}
          <span className="text-[0.5em] font-medium text-ink-3">%</span>
        </span>
        {label && <span className="mt-1 text-[11px] text-ink-3">{label}</span>}
      </div>
    </div>
  );
}

export function MatchScoreChip({ score, className }: { score?: number; className?: string }) {
  if (score == null) return <span className={cn("text-ink-4", className)}>—</span>;
  const tone = score >= 75 ? "text-accent bg-accent-soft border-accent-muted" : score >= 55 ? "text-amber-800 bg-amber-50 border-amber-200" : "text-rose-700 bg-rose-50 border-rose-200";
  return (
    <span className={cn("tabular inline-flex h-6 items-center rounded-md border px-1.5 text-xs font-semibold", tone, className)}>{score}%</span>
  );
}

// ---------------------------------------------------------------------------

export const SKILL_STATUS: Record<SkillMatchStatus, { icon: LucideIcon; label: string; cls: string; chip: string }> = {
  found: { icon: CircleCheck, label: "Found in resume", cls: "text-emerald-600", chip: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  partial: { icon: TriangleAlert, label: "Potentially relevant", cls: "text-amber-500", chip: "border-amber-200 bg-amber-50 text-amber-900" },
  missing: { icon: CircleX, label: "Not found", cls: "text-rose-500", chip: "border-rose-200 bg-rose-50 text-rose-800" },
};

export function SkillIcon({ status, className }: { status: SkillMatchStatus; className?: string }) {
  const s = SKILL_STATUS[status];
  const Icon = s.icon;
  return <Icon className={cn("size-3.5 shrink-0", s.cls, className)} aria-label={s.label} />;
}

export function SkillLegend({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-3", className)}>
      {(Object.keys(SKILL_STATUS) as SkillMatchStatus[]).map((k) => (
        <span key={k} className="inline-flex items-center gap-1">
          <SkillIcon status={k} className="size-3" /> {SKILL_STATUS[k].label}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-10 text-center", className)}>
      <span className="mb-3 inline-flex size-10 items-center justify-center rounded-xl border border-line bg-canvas text-ink-3">
        <Icon className="size-5" />
      </span>
      <p className="text-sm font-medium text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-[13px] leading-5 text-ink-3">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title = "Couldn't load this",
  message,
  onRetry,
  className,
  compact = false,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div role="alert" className={cn("flex items-center gap-3 rounded-lg border border-rose-200 bg-rose-50/60 px-3 py-2.5 text-[13px]", className)}>
        <CircleAlert className="size-4 shrink-0 text-rose-600" />
        <span className="min-w-0 flex-1 text-rose-900">{message ?? title}</span>
        {onRetry && (
          <Button size="xs" variant="secondary" onClick={onRetry}>
            <RefreshCw /> Retry
          </Button>
        )}
      </div>
    );
  }
  return (
    <div role="alert" className={cn("flex flex-col items-center justify-center px-6 py-10 text-center", className)}>
      <span className="mb-3 inline-flex size-10 items-center justify-center rounded-xl border border-rose-200 bg-rose-50 text-rose-600">
        <CircleAlert className="size-5" />
      </span>
      <p className="text-sm font-medium text-ink">{title}</p>
      {message && <p className="mt-1 max-w-sm text-[13px] leading-5 text-ink-3">{message}</p>}
      {onRetry && (
        <Button size="sm" variant="secondary" className="mt-4" onClick={onRetry}>
          <RefreshCw /> Try again
        </Button>
      )}
    </div>
  );
}

export function SectionHeading({ title, description, action, className }: { title: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-[13px] text-ink-3">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, description, actions, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0">
        <h1 className="text-[22px] leading-8 font-semibold tracking-[-0.02em] text-ink">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-3">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
