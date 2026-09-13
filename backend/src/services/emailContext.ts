/**
 * Builds EmailContext from Gmail search results: keeps messages related to the company,
 * identifies the most recent inbound recruiter, and writes a short factual summary.
 */
import type { EmailAddress, EmailContext, EmailMessage } from "@internflow/shared";
import { relativeDays } from "../utils/time.js";
import { escapeRegex } from "../utils/text.js";

export interface EmailContextInput {
  query: string;
  company: string;
  userEmail?: string;
  jobUrl?: string;
  messages: EmailMessage[];
  now?: Date;
}

const GENERIC_DOMAINS = new Set(["gmail.com", "outlook.com", "yahoo.com", "hotmail.com", "example.com", "icloud.com"]);

function companyMatcher(company: string, jobUrl?: string) {
  const tokens = company
    .split(/\s+/)
    .filter((t) => t.length > 1)
    .map(escapeRegex);
  const nameRe = tokens.length ? new RegExp(`\\b${tokens.join("\\s+")}\\b`, "i") : undefined;
  let domain: string | undefined;
  try {
    const host = jobUrl ? new URL(jobUrl).hostname.replace(/^(?:www|jobs|careers)\./, "") : undefined;
    if (host && !GENERIC_DOMAINS.has(host)) domain = host;
  } catch {
    /* ignore */
  }
  return (m: EmailMessage) => {
    const hay = [m.from.name, m.from.email, m.subject, m.snippet, ...m.to.map((t) => `${t.name ?? ""} ${t.email}`)].join(" ");
    if (nameRe?.test(hay)) return true;
    return Boolean(domain && [m.from.email, ...m.to.map((t) => t.email)].some((e) => e.toLowerCase().endsWith(`@${domain}`)));
  };
}

export function buildEmailContext(input: EmailContextInput): EmailContext {
  const now = input.now ?? new Date();
  const isRelated = companyMatcher(input.company, input.jobUrl);
  const related = input.messages.filter(isRelated).sort((a, b) => b.date.localeCompare(a.date));
  const me = input.userEmail?.toLowerCase();

  if (!related.length) {
    return { query: input.query, found: false, messages: [], summary: `No previous communication with ${input.company} found.` };
  }

  const inbound = related.find((m) => m.from.email.toLowerCase() !== me);
  const recruiter: EmailAddress | undefined = inbound ? { name: inbound.from.name, email: inbound.from.email } : undefined;
  const latest = related[0]!;
  const sent = related.filter((m) => m.from.email.toLowerCase() === me).length;
  const received = related.length - sent;

  const parts = [
    `Previous communication found: ${related.length} message${related.length === 1 ? "" : "s"} with ${input.company}`,
    `(${sent} sent, ${received} received).`,
  ];
  if (recruiter && inbound) {
    parts.push(`Most recent reply from ${recruiter.name ?? recruiter.email} <${recruiter.email}> ${relativeDays(inbound.date, now)}: "${inbound.subject}".`);
  } else {
    parts.push(`Your last message was ${relativeDays(latest.date, now)} with no reply yet.`);
  }

  return {
    query: input.query,
    found: true,
    messages: related.slice(0, 10),
    recruiter,
    lastContactAt: latest.date,
    lastSubject: latest.subject,
    summary: parts.join(" "),
  };
}
