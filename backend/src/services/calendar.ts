/**
 * Follow-up slot recommendation: the first weekday ≥ 7 days from now with a free 18:00–18:30 slot
 * in the user's timezone, plus two alternatives. All wall-clock math is timezone-aware.
 */
import type { CalendarEvent, CalendarRecommendation, TimeSlot } from "@internflow/shared";
import {
  addDays,
  formatLongDay,
  formatTime,
  isValidTimeZone,
  isWeekend,
  localDateOf,
  toIsoDate,
  zonedTimeToUtc,
  type LocalDate,
} from "../utils/time.js";

export interface RecommendOptions {
  now?: Date;
  timezone: string;
  minDaysAhead?: number;
  searchDays?: number;
  hour?: number;
  minute?: number;
  durationMinutes?: number;
}

const overlaps = (a: TimeSlot, b: { start: string; end: string }) =>
  new Date(a.start).getTime() < new Date(b.end).getTime() && new Date(b.start).getTime() < new Date(a.end).getTime();

function slotOn(day: LocalDate, o: Required<Pick<RecommendOptions, "hour" | "minute" | "durationMinutes" | "timezone">>): TimeSlot {
  const start = zonedTimeToUtc(day, o.hour, o.minute, o.timezone);
  return { start: start.toISOString(), end: new Date(start.getTime() + o.durationMinutes * 60_000).toISOString() };
}

const ORDINAL_WEEKS: Record<number, string> = { 7: "one week", 14: "two weeks", 21: "three weeks" };

export function recommendFollowUpSlot(events: CalendarEvent[], opts: RecommendOptions): CalendarRecommendation | null {
  const timezone = isValidTimeZone(opts.timezone) ? opts.timezone : "UTC";
  const o = {
    now: opts.now ?? new Date(),
    timezone,
    minDaysAhead: opts.minDaysAhead ?? 7,
    searchDays: opts.searchDays ?? 21,
    hour: opts.hour ?? 18,
    minute: opts.minute ?? 0,
    durationMinutes: opts.durationMinutes ?? 30,
  };
  const today = localDateOf(o.now, timezone);
  const free: { slot: TimeSlot; offset: number }[] = [];
  let skipped: { day: string; title: string } | undefined;

  for (let offset = o.minDaysAhead; offset <= o.searchDays + o.minDaysAhead && free.length < 3; offset++) {
    const day = addDays(today, offset);
    if (isWeekend(day)) continue;
    const slot = slotOn(day, o);
    const conflict = events.find((e) => overlaps(slot, e));
    if (conflict) {
      if (!free.length && !skipped) skipped = { day: formatLongDay(new Date(slot.start), timezone), title: conflict.title };
      continue;
    }
    free.push({ slot, offset });
  }
  const best = free[0];
  if (!best) return null;

  const start = new Date(best.slot.start);
  const when = ORDINAL_WEEKS[best.offset] ?? (best.offset <= 10 ? "about a week" : `${best.offset} days`);
  const conflictNote = skipped ? ` (${skipped.day} is busy with "${skipped.title}")` : "";
  return {
    slot: best.slot,
    reason: `You're free ${formatLongDay(start, timezone)} at ${formatTime(start, timezone)} — ${when} after preparing this application${conflictNote}.`,
    alternatives: free.slice(1).map((f) => f.slot),
    timezone,
    eventsConsidered: events.length,
  };
}

/** YYYY-MM-DD of an instant in a timezone. */
export const isoDateIn = (iso: string, timezone: string): string => toIsoDate(localDateOf(new Date(iso), timezone));

/** Fallback follow-up date when the calendar is unavailable: first weekday ≥ 7 days out. */
export function fallbackFollowUpDate(timezone: string, now = new Date()): string {
  const tz = isValidTimeZone(timezone) ? timezone : "UTC";
  let day = addDays(localDateOf(now, tz), 7);
  while (isWeekend(day)) day = addDays(day, 1);
  return toIsoDate(day);
}
