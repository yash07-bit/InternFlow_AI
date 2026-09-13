/** Tracker helpers shared by the real and mock Notion providers. */
import type { TrackerRecord } from "@internflow/shared";
import type { TrackerInput } from "../types.js";

export const MAX_REQUIREMENTS = 10;
export const MAX_NOTES_CHARS = 2000;

/** Notion multi_select option names cannot contain commas and are limited to 100 chars. */
export function sanitizeRequirements(values: string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values ?? []) {
    const name = raw.replace(/,/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
    if (out.length === MAX_REQUIREMENTS) break;
  }
  return out;
}

export const clampNotes = (notes: string | undefined): string | undefined =>
  notes === undefined ? undefined : notes.slice(0, MAX_NOTES_CHARS);

export function sanitizeTrackerInput<T extends Partial<TrackerInput>>(input: T): T {
  const out = { ...input };
  if (out.requirements !== undefined) out.requirements = sanitizeRequirements(out.requirements);
  if (out.notes !== undefined) out.notes = clampNotes(out.notes);
  return out;
}

const compact = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url.trim());
    u.hash = "";
    return `${u.host.toLowerCase().replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}${u.search}`;
  } catch {
    return url.trim().toLowerCase().replace(/\/+$/, "");
  }
}

const looseMatch = (a: string, b: string): boolean => {
  const x = compact(a);
  const y = compact(b);
  return Boolean(x && y) && (x.includes(y) || y.includes(x));
};

/**
 * A record matches when its job URL is the same, or the company matches and (if a role was given) the role matches.
 * With an empty query every record matches.
 */
export function matchesTrackerQuery(record: TrackerRecord, query: { company?: string; role?: string; jobUrl?: string }): boolean {
  const { company, role, jobUrl } = query;
  if (!company && !role && !jobUrl) return true;
  if (jobUrl && record.jobUrl && normalizeUrl(jobUrl) === normalizeUrl(record.jobUrl)) return true;
  if (company) return looseMatch(record.company, company) && (!role || looseMatch(record.role, role));
  if (role && !jobUrl) return looseMatch(record.role, role);
  return false;
}
