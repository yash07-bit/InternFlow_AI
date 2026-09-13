import type { TrackerRecord } from "@internflow/shared";
import { matchesTrackerQuery, sanitizeTrackerInput } from "../notion/tracker.js";
import { IntegrationError, type NotionProvider, type TrackerInput } from "../types.js";
import { demoTrackerSeed } from "./demoData.js";
import { demoDelay } from "./latency.js";

interface UserTracker {
  records: Map<string, TrackerRecord>;
  nextId: number;
}

const trackers = new Map<string, UserTracker>();

const pageUrl = (id: string) => `https://www.notion.so/demo/${id}`;

function trackerFor(userId: string): UserTracker {
  let tracker = trackers.get(userId);
  if (!tracker) {
    tracker = { records: new Map(), nextId: 1 };
    const syncedAt = new Date().toISOString();
    for (const seed of demoTrackerSeed()) {
      const id = `notion-demo-${tracker.nextId++}`;
      tracker.records.set(id, { ...seed, externalId: id, url: pageUrl(id), provider: "notion", syncedAt });
    }
    trackers.set(userId, tracker);
  }
  return tracker;
}

export function resetMockNotion(): void {
  trackers.clear();
}

export class MockNotionProvider implements NotionProvider {
  constructor(private readonly userId: string) {}

  async findApplications(query: { company?: string; role?: string; jobUrl?: string }): Promise<TrackerRecord[]> {
    await demoDelay();
    return [...trackerFor(this.userId).records.values()]
      .filter((r) => matchesTrackerQuery(r, query))
      .sort((a, b) => b.syncedAt.localeCompare(a.syncedAt))
      .map((r) => ({ ...r, requirements: [...r.requirements] }));
  }

  async createApplication(input: TrackerInput): Promise<TrackerRecord> {
    await demoDelay();
    if (!input.company?.trim()) throw new IntegrationError("notion", "INVALID_INPUT", "Company is required for a tracker record.");
    const tracker = trackerFor(this.userId);
    const id = `notion-demo-${tracker.nextId++}`;
    const record: TrackerRecord = {
      ...sanitizeTrackerInput(input),
      externalId: id,
      url: pageUrl(id),
      provider: "notion",
      syncedAt: new Date().toISOString(),
    };
    tracker.records.set(id, record);
    return { ...record, requirements: [...record.requirements] };
  }

  async updateApplication(externalId: string, patch: Partial<TrackerInput>): Promise<TrackerRecord> {
    await demoDelay();
    const tracker = trackerFor(this.userId);
    const existing = tracker.records.get(externalId);
    if (!existing) throw new IntegrationError("notion", "NOT_FOUND", `Notion page "${externalId}" was not found.`);
    const defined = Object.fromEntries(Object.entries(sanitizeTrackerInput(patch)).filter(([, v]) => v !== undefined));
    const record: TrackerRecord = { ...existing, ...defined, syncedAt: new Date().toISOString() };
    tracker.records.set(externalId, record);
    return { ...record, requirements: [...record.requirements] };
  }
}
