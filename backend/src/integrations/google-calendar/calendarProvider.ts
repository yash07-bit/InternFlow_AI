/** Google Calendar (REST v3) provider: availability, timezone and reminder event creation. */
import type { CalendarEvent, TimeSlot } from "@internflow/shared";
import { config } from "../../config.js";
import type { GoogleClient } from "../google/oauth.js";
import { IntegrationError, type CalendarProvider, type CreateEventInput } from "../types.js";

const CALENDAR_API = "https://www.googleapis.com/calendar/v3/calendars/primary";

interface ApiEventTime {
  dateTime?: string;
  date?: string;
  timeZone?: string;
}

interface ApiEvent {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  htmlLink?: string;
  transparency?: string;
  start?: ApiEventTime;
  end?: ApiEventTime;
  attendees?: { self?: boolean; responseStatus?: string }[];
}

/** Offset (ms) of `timeZone` from UTC at the given instant. */
function tzOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - instant.getTime();
}

/** Converts an all-day `YYYY-MM-DD` to the ISO instant of local midnight in `timeZone`. */
export function localDateToIso(ymd: string, timeZone: string): string {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d);
  let instant = guess;
  try {
    instant = guess - tzOffsetMs(new Date(guess), timeZone);
    instant = guess - tzOffsetMs(new Date(instant), timeZone); // second pass settles DST transitions
  } catch {
    instant = guess; // unknown timezone → treat as UTC
  }
  return new Date(instant).toISOString();
}

export function toCalendarEvent(e: ApiEvent, calendarTimeZone: string): CalendarEvent | null {
  const toIso = (t?: ApiEventTime): string | undefined => {
    if (t?.dateTime) return new Date(t.dateTime).toISOString();
    if (t?.date) return localDateToIso(t.date, t.timeZone ?? calendarTimeZone);
    return undefined;
  };
  const start = toIso(e.start);
  const end = toIso(e.end);
  if (!start || !end) return null;
  return { id: e.id, title: e.summary?.trim() || "(busy)", start, end, description: e.description, htmlLink: e.htmlLink };
}

export class GoogleCalendarProvider implements CalendarProvider {
  constructor(private readonly google: GoogleClient) {}

  async listEvents(range: TimeSlot): Promise<CalendarEvent[]> {
    const timeMin = new Date(range.start);
    const timeMax = new Date(range.end);
    if (Number.isNaN(timeMin.getTime()) || Number.isNaN(timeMax.getTime()) || timeMin >= timeMax) {
      throw new IntegrationError("google_calendar", "INVALID_INPUT", "Invalid time range for listing events.");
    }
    const events: CalendarEvent[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 5; page++) {
      const params = new URLSearchParams({
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "250",
      });
      if (pageToken) params.set("pageToken", pageToken);
      const res = await this.google.json<{ items?: ApiEvent[]; timeZone?: string; nextPageToken?: string }>(
        "google_calendar",
        `${CALENDAR_API}/events?${params}`,
      );
      const tz = res.timeZone ?? config.userTimezone;
      for (const item of res.items ?? []) {
        // Only busy time matters for scheduling: skip cancelled, "free" and declined events.
        if (item.status === "cancelled" || item.transparency === "transparent") continue;
        if (item.attendees?.some((a) => a.self && a.responseStatus === "declined")) continue;
        const event = toCalendarEvent(item, tz);
        if (event) events.push(event);
      }
      pageToken = res.nextPageToken;
      if (!pageToken) break;
    }
    return events.sort((a, b) => a.start.localeCompare(b.start));
  }

  async getTimezone(): Promise<string> {
    try {
      const res = await this.google.json<{ timeZone?: string }>("google_calendar", CALENDAR_API);
      return res.timeZone || config.userTimezone;
    } catch {
      return config.userTimezone;
    }
  }

  async createEvent(input: CreateEventInput): Promise<CalendarEvent> {
    validateEventInput(input);
    const res = await this.google.json<ApiEvent>("google_calendar", `${CALENDAR_API}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        summary: input.title,
        description: input.description,
        start: { dateTime: new Date(input.start).toISOString() },
        end: { dateTime: new Date(input.end).toISOString() },
        reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 30 }] },
      }),
    });
    return (
      toCalendarEvent(res, config.userTimezone) ?? {
        id: res.id,
        title: input.title,
        start: input.start,
        end: input.end,
        description: input.description,
        htmlLink: res.htmlLink,
      }
    );
  }
}

export function validateEventInput(input: CreateEventInput): void {
  const start = new Date(input.start).getTime();
  const end = new Date(input.end).getTime();
  if (!input.title.trim()) throw new IntegrationError("google_calendar", "INVALID_INPUT", "An event title is required.");
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
    throw new IntegrationError("google_calendar", "INVALID_INPUT", "Event end must be a valid time after its start.");
  }
}
