import type { ComponentType, SVGProps } from "react";
import type { AppId, IntegrationStatus, ProviderId } from "@internflow/shared";
import { APP_LABELS } from "@internflow/shared";
import { cn } from "@/lib/utils";

type GlyphProps = SVGProps<SVGSVGElement>;

/* Small, original app glyphs (not official logos) that evoke each app's identity. */

function GmailGlyph(props: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" stroke="#EA4335" strokeWidth="1.8" />
      <path d="M3.5 6.5 12 13l8.5-6.5" stroke="#EA4335" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DriveGlyph(props: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M8.6 3.5h6.8l6.1 10.6h-6.8L8.6 3.5Z" fill="#FFBA00" />
      <path d="M8.6 3.5 2.5 14.1l3.4 5.9 6.1-10.6-3.4-5.9Z" fill="#1FA463" />
      <path d="M5.9 20h12.2l3.4-5.9H9.3L5.9 20Z" fill="#4285F4" />
    </svg>
  );
}

function CalendarGlyph(props: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <rect x="3" y="4.5" width="18" height="16" rx="2.5" stroke="#4285F4" strokeWidth="1.8" />
      <path d="M3 9.5h18" stroke="#4285F4" strokeWidth="1.8" />
      <path d="M8 2.8v3.4M16 2.8v3.4" stroke="#4285F4" strokeWidth="1.8" strokeLinecap="round" />
      <rect x="7" y="12.5" width="3" height="3" rx="0.6" fill="#4285F4" />
      <rect x="14" y="12.5" width="3" height="3" rx="0.6" fill="#4285F4" fillOpacity="0.35" />
    </svg>
  );
}

function NotionGlyph(props: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <rect x="3" y="3" width="18" height="18" rx="3.5" fill="#FFFFFF" stroke="#111111" strokeWidth="1.8" />
      <path d="M8.5 16.5v-9l7 9v-9" stroke="#111111" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function WebGlyph(props: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r="9" stroke="#57534E" strokeWidth="1.8" />
      <path d="M3 12h18M12 3c2.5 2.6 3.7 5.6 3.7 9s-1.2 6.4-3.7 9c-2.5-2.6-3.7-5.6-3.7-9S9.5 5.6 12 3Z" stroke="#57534E" strokeWidth="1.6" />
    </svg>
  );
}

export function InternFlowGlyph({ inverted = false, ...props }: GlyphProps & { inverted?: boolean }) {
  const fg = inverted ? "#0F766E" : "#FFFFFF";
  const bg = inverted ? "#FFFFFF" : "#0F766E";
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <rect width="24" height="24" rx="6" fill={bg} />
      <path d="M6.8 8.6h4.9a2.2 2.2 0 0 1 2.2 2.2v2.4a2.2 2.2 0 0 0 2.2 2.2h1.1" stroke={fg} strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="6.8" cy="8.6" r="2" fill={fg} />
      <circle cx="17.2" cy="15.4" r="2" fill={fg} />
    </svg>
  );
}

export interface AppMeta {
  id: AppId;
  label: string;
  short: string;
  color: string;
  /** Soft tinted background for glyph tiles. */
  tint: string;
  Glyph: ComponentType<GlyphProps>;
  /** What the agent does in this app. */
  role: string;
  description: string;
  capabilities: string[];
}

export const APPS: Record<AppId, AppMeta> = {
  web: {
    id: "web",
    label: APP_LABELS.web,
    short: "Web",
    color: "#57534E",
    tint: "#F5F5F4",
    Glyph: WebGlyph,
    role: "Job analysis",
    description: "Reads the job posting and extracts requirements — as untrusted data.",
    capabilities: ["Fetch job page", "Extract requirements", "Detect prompt injection"],
  },
  google_drive: {
    id: "google_drive",
    label: APP_LABELS.google_drive,
    short: "Drive",
    color: "#1FA463",
    tint: "#EEF8F2",
    Glyph: DriveGlyph,
    role: "Resume retrieval",
    description: "Finds your most recent resume and extracts skills, projects and experience.",
    capabilities: ["Search files", "Read resume text"],
  },
  gmail: {
    id: "gmail",
    label: APP_LABELS.gmail,
    short: "Gmail",
    color: "#EA4335",
    tint: "#FDF0EF",
    Glyph: GmailGlyph,
    role: "Email search + drafts",
    description: "Checks for previous recruiter conversations and prepares follow-up drafts — never sends.",
    capabilities: ["Search threads", "Create drafts (approval)"],
  },
  notion: {
    id: "notion",
    label: APP_LABELS.notion,
    short: "Notion",
    color: "#111111",
    tint: "#F4F4F3",
    Glyph: NotionGlyph,
    role: "Application tracking",
    description: "Creates and updates a row in your application tracker database.",
    capabilities: ["Search tracker", "Create / update records"],
  },
  google_calendar: {
    id: "google_calendar",
    label: APP_LABELS.google_calendar,
    short: "Calendar",
    color: "#4285F4",
    tint: "#EFF4FE",
    Glyph: CalendarGlyph,
    role: "Scheduling + reminders",
    description: "Reads your availability and proposes a follow-up time that fits your week.",
    capabilities: ["Read availability", "Create reminders (approval)"],
  },
  internflow: {
    id: "internflow",
    label: APP_LABELS.internflow,
    short: "Engine",
    color: "#0F766E",
    tint: "#F0FDFA",
    Glyph: InternFlowGlyph,
    role: "Matching + writing",
    description: "Scores your resume against the job and writes grounded application materials.",
    capabilities: ["Resume match", "Cover letter", "Application answers"],
  },
};

/** Display order for the five external apps. */
export const APP_ORDER: ProviderId[] = ["web", "google_drive", "gmail", "notion", "google_calendar"];

export function appMeta(id: AppId | string | undefined): AppMeta {
  return (id && APPS[id as AppId]) || APPS.internflow;
}

const SIZE = {
  xs: { box: "size-5 rounded-[5px]", icon: "size-3" },
  sm: { box: "size-7 rounded-md", icon: "size-4" },
  md: { box: "size-9 rounded-lg", icon: "size-5" },
  lg: { box: "size-11 rounded-xl", icon: "size-6" },
} as const;

export function AppIcon({
  app,
  size = "sm",
  className,
  bare = false,
}: {
  app: AppId;
  size?: keyof typeof SIZE;
  className?: string;
  bare?: boolean;
}) {
  const meta = appMeta(app);
  const s = SIZE[size];
  if (app === "internflow") {
    return <InternFlowGlyph className={cn(s.box.split(" ")[0], className)} aria-label={meta.label} role="img" />;
  }
  if (bare) return <meta.Glyph className={cn(s.icon, className)} />;
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center border border-black/5", s.box, className)}
      style={{ backgroundColor: meta.tint }}
      role="img"
      aria-label={meta.label}
    >
      <meta.Glyph className={s.icon} />
    </span>
  );
}

export type IntegrationTone = "connected" | "demo" | "ready" | "disconnected" | "error";

export const INTEGRATION_STATUS: Record<IntegrationStatus["status"], { label: string; dot: string; text: string; hollow?: boolean }> = {
  connected: { label: "Connected", dot: "bg-emerald-500", text: "text-emerald-700" },
  demo: { label: "Demo", dot: "bg-accent", text: "text-accent" },
  ready: { label: "Ready", dot: "bg-sky-500", text: "text-sky-700" },
  disconnected: { label: "Disconnected", dot: "border border-ink-4 bg-transparent", text: "text-ink-3", hollow: true },
  error: { label: "Error", dot: "bg-rose-500", text: "text-rose-700" },
};

export function StatusDot({ status, className }: { status: IntegrationStatus["status"]; className?: string }) {
  const s = INTEGRATION_STATUS[status] ?? INTEGRATION_STATUS.disconnected;
  return <span aria-hidden="true" className={cn("inline-block size-2 shrink-0 rounded-full", s.dot, className)} />;
}
