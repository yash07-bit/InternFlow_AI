import type { CalendarEvent, TimeSlot } from "@internflow/shared";
import { config } from "../../config.js";
import { validateEventInput } from "../google-calendar/calendarProvider.js";
import { IntegrationError, type CalendarProvider, type CreateEventInput } from "../types.js";
import { demoCalendarEvents } from "./demoData.js";
import { demoDelay } from "./latency.js";

const createdByUser = new Map<string, CalendarEvent[]>();

export function resetMockCalendar(): void {
  createdByUser.clear();
}

export class MockCalendarProvider implements CalendarProvider {
  constructor(private readonly userId: string) {}

  async listEvents(range: TimeSlot): Promise<CalendarEvent[]> {
    await demoDelay();
    const start = new Date(range.start).getTime();
    const end = new Date(range.end).getTime();
    if (Number.isNaN(start) || Number.isNaN(end) || start >= end) {
      throw new IntegrationError("google_calendar", "INVALID_INPUT", "Invalid time range for listing events.");
    }
    return [...demoCalendarEvents(), ...(createdByUser.get(this.userId) ?? [])]
      .filter((e) => new Date(e.start).getTime() < end && new Date(e.end).getTime() > start)
      .sort((a, b) => a.start.localeCompare(b.start));
  }

  async createEvent(input: CreateEventInput): Promise<CalendarEvent> {
    await demoDelay();
    validateEventInput(input);
    const events = createdByUser.get(this.userId) ?? [];
    const id = `evt-demo-${events.length + 1}`;
    const event: CalendarEvent = {
      id,
      title: input.title,
      start: new Date(input.start).toISOString(),
      end: new Date(input.end).toISOString(),
      description: input.description,
      htmlLink: `https://calendar.google.com/calendar/event?eid=${id}`,
    };
    events.push(event);
    createdByUser.set(this.userId, events);
    return event;
  }

  async getTimezone(): Promise<string> {
    await demoDelay(0.3);
    return config.userTimezone;
  }
}
