import type { ApplicationStatus, ToolCallStatus, WorkflowStatus } from "@internflow/shared";

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Parses ISO timestamps and YYYY-MM-DD dates (as local dates, not UTC midnight). */
export function parseDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  if (DATE_ONLY.test(value)) {
    const [y, m, d] = value.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatRelative(value: string | undefined | null, now = Date.now()): string {
  const d = parseDate(value);
  if (!d) return "—";
  const diff = d.getTime() - now;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;
  if (abs < 45_000) return "just now";
  if (abs < hour) return rtf.format(Math.round(diff / min), "minute");
  if (abs < day) return rtf.format(Math.round(diff / hour), "hour");
  if (abs < 7 * day) return rtf.format(Math.round(diff / day), "day");
  return formatDate(value);
}

export function formatDate(value: string | undefined | null, opts: Intl.DateTimeFormatOptions = {}): string {
  const d = parseDate(value);
  if (!d) return value ?? "—";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }), ...opts });
}

export function formatLongDate(value: string | undefined | null): string {
  const d = parseDate(value);
  if (!d) return value ?? "—";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

export function formatTime(value: string | undefined | null, timeZone?: string): string {
  const d = parseDate(value);
  if (!d) return "—";
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", ...(timeZone ? { timeZone } : {}) });
}

export function formatClock(value: string | undefined | null): string {
  const d = parseDate(value);
  if (!d) return "--:--:--";
  return d.toLocaleTimeString(undefined, { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function formatSlot(start: string, end?: string, timeZone?: string): string {
  const s = parseDate(start);
  if (!s) return start;
  const date = s.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", ...(timeZone ? { timeZone } : {}) });
  const time = formatTime(start, timeZone);
  const endTime = end ? ` – ${formatTime(end, timeZone)}` : "";
  return `${date} · ${time}${endTime}`;
}

export function formatDuration(ms: number | undefined | null): string {
  if (ms == null || Number.isNaN(ms)) return "—";
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  const s = ms / 1000;
  if (s < 10) return `${s.toFixed(1)}s`;
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m ${rem.toString().padStart(2, "0")}s`;
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export const WORKFLOW_STATUS_LABELS: Record<WorkflowStatus, string> = {
  IDLE: "Queued",
  ANALYZING_JOB: "Analyzing job",
  FINDING_RESUME: "Finding resume",
  MATCHING_RESUME: "Matching resume",
  SEARCHING_EMAIL: "Checking email",
  GENERATING_MATERIAL: "Writing materials",
  UPDATING_TRACKER: "Updating tracker",
  CHECKING_CALENDAR: "Checking calendar",
  WAITING_FOR_APPROVAL: "Waiting for approval",
  COMPLETED: "Completed",
  FAILED: "Failed",
};

export function workflowStatusLabel(status: WorkflowStatus | undefined): string {
  return status ? (WORKFLOW_STATUS_LABELS[status] ?? humanize(status)) : "—";
}

export function isActiveStatus(status: WorkflowStatus | undefined): boolean {
  return !!status && status !== "COMPLETED" && status !== "FAILED" && status !== "WAITING_FOR_APPROVAL";
}

export function isTerminalStatus(status: WorkflowStatus | undefined): boolean {
  return status === "COMPLETED" || status === "FAILED";
}

export const TOOL_STATUS_LABELS: Record<ToolCallStatus, string> = {
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  awaiting_approval: "Awaiting approval",
  rejected: "Rejected",
};

export function humanize(value: string): string {
  const s = value.replace(/[_-]+/g, " ").toLowerCase().trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function workModeLabel(mode: string | undefined): string | undefined {
  if (!mode) return undefined;
  return mode === "onsite" ? "On-site" : humanize(mode);
}

export const APPLICATION_STATUS_TONE: Record<ApplicationStatus, "neutral" | "accent" | "info" | "warning" | "success" | "danger"> = {
  Preparing: "neutral",
  "Ready to apply": "accent",
  Applied: "info",
  Interviewing: "warning",
  Offer: "success",
  Rejected: "danger",
};

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** ISO → value for <input type="datetime-local"> in the viewer's local timezone. */
export function isoToLocalInput(iso: string | undefined): string {
  const d = parseDate(iso);
  if (!d) return "";
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function localInputToIso(value: string): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function hostnameOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}
