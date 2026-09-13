export const collapseWhitespace = (s: string): string => s.replace(/\s+/g, " ").trim();

export const truncate = (s: string, max: number): string => (s.length <= max ? s : `${s.slice(0, Math.max(0, max - 1)).trimEnd()}…`);

export const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** ["a","b","c"] → "a, b and c" */
export function joinList(items: string[], conjunction = "and"): string {
  const list = items.filter(Boolean);
  if (list.length <= 1) return list[0] ?? "";
  if (list.length === 2) return `${list[0]} ${conjunction} ${list[1]}`;
  return `${list.slice(0, -1).join(", ")} ${conjunction} ${list[list.length - 1]}`;
}

export const titleCase = (s: string): string =>
  s.toLowerCase().replace(/(^|[\s\-'’])([a-z])/g, (_, sep: string, c: string) => sep + c.toUpperCase());

export const lowerFirst = (s: string): string => (s && /^[A-Z][a-z]/.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s);

export const stripTrailingPunctuation = (s: string): string => s.replace(/[\s.;:,]+$/, "");

export const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Remove emails and URLs from untrusted excerpts before showing or storing them. */
export const redactContacts = (s: string): string =>
  s.replace(EMAIL_RE, "[email redacted]").replace(/https?:\/\/\S+/g, "[link redacted]");

/** Deterministic small hash (for choosing phrasing variants). */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
