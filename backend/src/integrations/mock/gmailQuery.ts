/**
 * A small Gmail-search emulator for Demo Mode. Supports quoted phrases, OR (also `|` and `{a b}`), `-negation`,
 * from:/to:/subject:, in:/label:, newer_than:/older_than:, after:/before:, and bare words over names, subject,
 * snippet and addresses. Company names also match sender domains ("Example AI" ↔ example.com).
 */
import type { EmailAddress, EmailMessage } from "@internflow/shared";

interface Term {
  field?: string;
  value: string;
  negate: boolean;
}

/** Clauses are AND-ed; the terms inside a clause are OR-ed. */
export function parseGmailQuery(query: string): Term[][] {
  const clauses: Term[][] = [];
  let pendingOr = false;
  let braceGroup: Term[] | undefined;
  const re = /(\{)|(\})|(-)?(?:([a-z_]+):)?(?:"([^"]*)"|([^\s(){}"]+))/gi;
  const cleaned = query.replace(/[()]/g, " ");
  for (let m = re.exec(cleaned); m; m = re.exec(cleaned)) {
    if (m[1]) {
      braceGroup = [];
      continue;
    }
    if (m[2]) {
      if (braceGroup?.length) clauses.push(braceGroup);
      braceGroup = undefined;
      continue;
    }
    const [, , , neg, field, quoted, bare] = m;
    if (!field && quoted === undefined && (bare === "OR" || bare === "|")) {
      pendingOr = clauses.length > 0;
      continue;
    }
    const value = (quoted ?? bare ?? "").trim();
    if (!value) continue;
    const term: Term = { field: field?.toLowerCase(), value, negate: Boolean(neg) };
    if (braceGroup) braceGroup.push(term);
    else if (pendingOr) clauses[clauses.length - 1]?.push(term);
    else clauses.push([term]);
    pendingOr = false;
  }
  if (braceGroup?.length) clauses.push(braceGroup);
  return clauses;
}

const GENERIC_COMPANY_WORDS = new Set([
  "ai", "inc", "co", "corp", "corporation", "company", "llc", "ltd", "limited", "labs", "lab", "technologies",
  "technology", "tech", "group", "hq", "io", "software", "systems", "careers", "recruiting", "talent", "team",
]);

const words = (text: string): string[] => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

function containsPhrase(haystack: string[], needle: string[]): boolean {
  if (!needle.length) return false;
  outer: for (let i = 0; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

/** Domain labels without the TLD, compacted: "careers@another-co.example" → ["anotherco"]. */
const domainLabels = (email: string): string[] => {
  const domain = email.toLowerCase().split("@")[1] ?? "";
  return domain
    .split(".")
    .slice(0, -1)
    .map((l) => l.replace(/[^a-z0-9]/g, ""))
    .filter(Boolean);
};

function matchesAddress(value: string, addr: EmailAddress): boolean {
  const v = value.toLowerCase();
  const email = addr.email.toLowerCase();
  if (v.includes("@")) return email.includes(v);
  if (v.includes(".") && !v.includes(" ")) return email.endsWith(`@${v}`) || email.endsWith(`.${v}`);
  const needle = words(v);
  if (containsPhrase(words(addr.name ?? ""), needle)) return true;
  if (needle.length === 1 && email.split("@")[0] === needle[0]) return true;
  // Company name ↔ domain: "Example AI" → example.com, "Another Co" → anotherco.example
  const labels = domainLabels(email);
  const full = needle.join("");
  const core = needle.filter((w) => !GENERIC_COMPANY_WORDS.has(w)).join("");
  return labels.some((l) => l === full || (core.length >= 3 && l === core));
}

const DURATION_MS: Record<string, number> = { d: 86_400_000, m: 30 * 86_400_000, y: 365 * 86_400_000 };

function matchesTerm(term: Term, msg: EmailMessage, ownerEmail: string, now: Date): boolean {
  const owner = ownerEmail.toLowerCase();
  const isOwner = (a: EmailAddress) => a.email.toLowerCase() === owner;
  const value = term.value;
  switch (term.field) {
    case "from":
      return value.toLowerCase() === "me" ? isOwner(msg.from) : matchesAddress(value, msg.from);
    case "to":
    case "cc":
      return value.toLowerCase() === "me" ? msg.to.some(isOwner) : msg.to.some((a) => matchesAddress(value, a));
    case "subject":
      return containsPhrase(words(msg.subject), words(value));
    case "in":
    case "label":
      return value.toLowerCase() === "anywhere" || (msg.labels ?? []).some((l) => l.toLowerCase() === value.toLowerCase());
    case "newer_than":
    case "older_than": {
      const m = /^(\d+)([dmy])$/i.exec(value);
      if (!m) return true;
      const cutoff = now.getTime() - Number(m[1]) * (DURATION_MS[(m[2] as string).toLowerCase()] as number);
      const t = new Date(msg.date).getTime();
      return term.field === "newer_than" ? t >= cutoff : t < cutoff;
    }
    case "after":
    case "before": {
      const d = new Date(value.replace(/\//g, "-"));
      if (Number.isNaN(d.getTime())) return true;
      return term.field === "after" ? msg.date >= d.toISOString() : msg.date < d.toISOString();
    }
    case undefined: {
      const needle = words(value);
      const counterparts = [msg.from, ...msg.to].filter((a) => !isOwner(a));
      const text = words(`${msg.subject}\n${msg.snippet}`);
      return containsPhrase(text, needle) || counterparts.some((a) => matchesAddress(value, a));
    }
    default:
      return true; // unsupported operators (has:, is:, category:…) don't filter in the demo
  }
}

export function filterEmails(messages: EmailMessage[], query: string, ownerEmail: string, now = new Date()): EmailMessage[] {
  const clauses = parseGmailQuery(query);
  return messages.filter((msg) =>
    clauses.every((clause) =>
      clause.some((term) => {
        const hit = matchesTerm(term, msg, ownerEmail, now);
        return term.negate ? !hit : hit;
      }),
    ),
  );
}
