/**
 * Timezone-safe date helpers built on Intl (no dependencies).
 * "Local" below always means "in the given IANA timezone", never the server's timezone.
 */

export interface LocalDate {
  year: number;
  month: number; // 1..12
  day: number;
}

const partsFormatter = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = partsFormatter.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsFormatter.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock components of `date` in `timeZone`. */
export function zonedParts(date: Date, timeZone: string) {
  const parts = Object.fromEntries(formatterFor(timeZone).formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Offset (ms) of `timeZone` from UTC at `date`. */
function tzOffsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Convert a wall-clock time in `timeZone` into a UTC Date (DST-safe). */
export function zonedTimeToUtc(d: LocalDate, hour: number, minute: number, timeZone: string): Date {
  const guess = Date.UTC(d.year, d.month - 1, d.day, hour, minute, 0);
  const first = guess - tzOffsetMs(new Date(guess), timeZone);
  const second = guess - tzOffsetMs(new Date(first), timeZone);
  return new Date(second);
}

export function localDateOf(date: Date, timeZone: string): LocalDate {
  const p = zonedParts(date, timeZone);
  return { year: p.year, month: p.month, day: p.day };
}

/** Calendar arithmetic on a local date (independent of any timezone). */
export function addDays(d: LocalDate, days: number): LocalDate {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + days));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

/** 0 = Sunday … 6 = Saturday */
export const dayOfWeek = (d: LocalDate): number => new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay();

export const isWeekend = (d: LocalDate): boolean => [0, 6].includes(dayOfWeek(d));

export const toIsoDate = (d: LocalDate): string =>
  `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;

/** "Tuesday, September 22" */
export function formatLongDay(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", month: "long", day: "numeric" }).format(date);
}

/** "6:00 PM" */
export function formatTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(date);
}

/** "Sep 12" */
export function formatShortDate(date: Date, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" }).format(date);
}

/** Whole days between two instants (rounded down). */
export const daysBetween = (a: Date, b: Date): number => Math.floor((b.getTime() - a.getTime()) / 86_400_000);

export function relativeDays(dateIso: string, now = new Date()): string {
  const days = daysBetween(new Date(dateIso), now);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}
