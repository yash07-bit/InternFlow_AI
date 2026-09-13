/**
 * Heuristic job-posting parser. Works on visible page text or pasted descriptions and returns
 * structured JobData only — raw page text never leaves this module on the heuristic path.
 */
import type { JobData } from "@internflow/shared";
import { stripInjectedSegments } from "./injection.js";
import { CLOUD_PROVIDERS, findSkills, getSkill } from "./skills.js";
import { collapseWhitespace, EMAIL_RE, joinList, stripTrailingPunctuation, truncate } from "../utils/text.js";

type SectionKind = "responsibilities" | "requirements" | "preferred" | "about" | "apply" | "benefits" | "other";

const HEADINGS: { kind: SectionKind; re: RegExp }[] = [
  { kind: "preferred", re: /^(?:preferred(?:\s+(?:qualifications|skills|experience|requirements))?|nice[\s-]to[\s-]haves?|bonus(?:\s+points)?|good[\s-]to[\s-]have|pluses|it'?s a plus|additional (?:qualifications|skills)|desired (?:qualifications|skills))\b/i },
  { kind: "responsibilities", re: /^(?:what you['’]?ll do|what you will do|responsibilities|key responsibilities|your responsibilities|your role|the role|role overview|duties|day[\s-]to[\s-]day|in this role(?: you will)?|what you['’]?ll work on|job description)\b/i },
  { kind: "requirements", re: /^(?:requirements|minimum qualifications|basic qualifications|required qualifications|qualifications|must[\s-]haves?|what we['’]?re looking for|what you['’]?ll need|what you need|you have|you should have|required skills|skills(?: required)?|who you are|eligibility|about you)\b/i },
  { kind: "apply", re: /^(?:how to apply|to apply|application process|apply now)\b/i },
  { kind: "benefits", re: /^(?:benefits|perks|what we offer|compensation|why join us)\b/i },
  { kind: "about", re: /^about\b/i },
];

const ROLE_WORDS = /\b(?:intern(?:ship)?|engineer(?:ing)?|developer|analyst|designer|scientist|manager|associate|specialist|trainee|fellow(?:ship)?|researcher|architect|consultant|apprentice|programmer|administrator|lead)\b/i;
const QUALIFICATION_WORDS = /\b(?:degree|bachelor'?s?|master'?s?|b\.?\s?tech|b\.?\s?e\b|b\.?sc|m\.?tech|ph\.?d|pursuing|graduat\w*|enrolled|student|gpa|cgpa|university|college|eligib\w*|authori[sz]ed to work|visa)\b/i;
const BULLET = /^\s*(?:[-*•●▪◦·–—]|\d+[.)])\s+/;
const MONTHS = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

export interface ParseJobInput {
  text: string;
  pageTitle?: string;
  url?: string;
  source: "url" | "text";
}

interface Section {
  kind: SectionKind;
  heading: string;
  lines: string[];
}

// ---------------------------------------------------------------------------

/** If the text was whitespace-collapsed into one line, re-insert line breaks before headings and bullets. */
function restoreStructure(text: string): string {
  if ((text.match(/\n/g)?.length ?? 0) >= 5 || text.length < 200) return text;
  const headingPhrases = [
    "What you'll do", "What you’ll do", "What you will do", "Key responsibilities", "Responsibilities", "Preferred qualifications",
    "Preferred skills", "Nice to have", "Nice-to-have", "Minimum qualifications", "Basic qualifications", "Requirements", "Qualifications",
    "Must have", "What we're looking for", "How to apply", "Benefits", "Perks", "About",
  ];
  let out = text.replace(/\s*[•●▪]\s*/g, "\n");
  // "About Example AI Example AI builds…" → heading "About Example AI"
  out = out.replace(/\s(About)\s+((?:[A-Z][\w&.'-]*\s+){1,5})/g, (_m, about: string, caps: string) => {
    const words = caps.trim().split(/\s+/);
    for (let n = 1; n <= Math.floor(words.length / 2); n++) {
      if (words.slice(0, n).join(" ") === words.slice(n, 2 * n).join(" ")) {
        return `\n${about} ${words.slice(0, n).join(" ")}\n${words.slice(n).join(" ")} `;
      }
    }
    return `\n${about} ${words.slice(0, -1).join(" ") || words[0]}\n${words.length > 1 ? words[words.length - 1] : ""} `;
  });
  for (const phrase of headingPhrases.filter((p) => p !== "About")) {
    const re = new RegExp(`\\s(${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?=\\s+[A-Z])`, "g");
    out = out.replace(re, "\n$1\n");
  }
  return out;
}

/** Split a whitespace-collapsed section body into items at "lowercase word → Capitalized non-skill word" boundaries. */
function splitCollapsedItems(body: string): string[] {
  const words = body.split(/\s+/);
  const items: string[] = [];
  let current: string[] = [];
  const keepCapitalized = /^(?:[A-Z]{2,}|Computer|Science|Engineering|Bachelor|Master|I|AI|API|APIs|[A-Z][a-z]+\.js|GitHub)/;
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    const prev = current[current.length - 1];
    const isBoundary =
      prev !== undefined &&
      (/[a-z0-9)]$/.test(prev) || Boolean(getSkill(prev.replace(/[^\w.+#]/g, "")))) &&
      /^[A-Z][a-z]/.test(w) &&
      !keepCapitalized.test(w) &&
      !getSkill(w.replace(/[^\w.+#]/g, "")) &&
      !/^(?:in|of|with|and|or|the|a|an|to|for|on|at|by)$/i.test(prev);
    if (isBoundary && current.length >= 2) {
      items.push(current.join(" "));
      current = [];
    }
    current.push(w);
  }
  if (current.length) items.push(current.join(" "));
  return items;
}

function headingKind(line: string): SectionKind | undefined {
  const clean = line.replace(/[:：]\s*$/, "").trim();
  if (clean.length > 60 || /[.!?]$/.test(clean)) return undefined;
  return HEADINGS.find((h) => h.re.test(clean))?.kind;
}

function toSections(lines: string[]): { preamble: string[]; sections: Section[] } {
  const preamble: string[] = [];
  const sections: Section[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    // Inline heading: "Requirements: React, Node.js"
    const inline = /^([A-Za-z' ’-]{3,40})[:：]\s+(.+)$/.exec(line);
    const kind = headingKind(line) ?? (inline ? headingKind(inline[1]!) : undefined);
    if (kind) {
      sections.push({ kind, heading: inline && headingKind(inline[1]!) ? inline[1]! : line, lines: inline && headingKind(inline[1]!) ? [inline[2]!] : [] });
      continue;
    }
    const target = sections[sections.length - 1];
    if (target) target.lines.push(line);
    else preamble.push(line);
  }
  return { preamble, sections };
}

function sectionItems(section: Section | undefined, collapsed: boolean): string[] {
  if (!section) return [];
  const items: string[] = [];
  for (const line of section.lines) {
    const cleaned = line.replace(BULLET, "").trim();
    if (!cleaned) continue;
    if (collapsed && cleaned.length > 120 && !BULLET.test(line)) items.push(...splitCollapsedItems(cleaned));
    else if (/;\s/.test(cleaned) && cleaned.length > 80) items.push(...cleaned.split(/;\s+/));
    else items.push(cleaned);
  }
  return items.map((i) => stripTrailingPunctuation(collapseWhitespace(i))).filter((i) => i.length > 1);
}

// ---------------------------------------------------------------------------

/** Turn one requirement line into canonical skill entries ("JavaScript / TypeScript", "Cloud (AWS / GCP)"). */
export function skillsFromItem(item: string): string[] {
  const hits = findSkills(item);
  const names = hits.map((h) => h.name);
  const clouds = names.filter((n) => CLOUD_PROVIDERS.includes(n));
  const out: string[] = [];
  const consumed = new Set<string>();
  let pendingCloud: string | undefined;

  const cloudIndex = hits.find((h) => CLOUD_PROVIDERS.includes(h.name))?.index ?? -1;
  const cloudInsertAt = () => hits.filter((h) => h.index < cloudIndex && !CLOUD_PROVIDERS.includes(h.name)).length;
  if (/\bcloud\b/i.test(item) || clouds.length >= 2) {
    if (clouds.length) pendingCloud = `Cloud (${clouds.join(" / ")})`;
    else if (/\bcloud\s+(?:platforms?|experience|services|computing|infrastructure)|experience\s+(?:with|in)\s+(?:the\s+)?cloud/i.test(item)) out.push("Cloud");
    clouds.forEach((c) => consumed.add(c));
  }

  for (let i = 0; i < hits.length; i++) {
    const a = hits[i]!;
    if (consumed.has(a.name)) continue;
    const b = hits[i + 1];
    if (b && !consumed.has(b.name)) {
      const between = item.slice(a.index + a.length, b.index);
      if (/^\s*(?:\/|\bor\b|,?\s*or\b)\s*$/i.test(between)) {
        out.push(`${a.name} / ${b.name}`);
        consumed.add(a.name).add(b.name);
        i++;
        continue;
      }
    }
    // "Git" and "GitHub" together → keep only Git as the requirement.
    if (a.name === "GitHub" && names.includes("Git")) continue;
    out.push(a.name);
    consumed.add(a.name);
  }
  if (pendingCloud) out.splice(Math.min(cloudInsertAt(), out.length), 0, pendingCloud);
  return out;
}

const dedupe = (list: string[]) => {
  const seen = new Set<string>();
  return list.filter((x) => {
    const k = x.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

function extractTitle(input: ParseJobInput, lines: string[]): string | undefined {
  const label = /^(?:job\s+title|title|role|position)\s*[:：-]\s*(.+)$/im.exec(input.text);
  if (label) return truncate(collapseWhitespace(label[1]!), 90);
  const fromTitle = input.pageTitle?.split(/\s+[—–|]\s+|\s+-\s+|\s+at\s+/)[0]?.trim();
  if (fromTitle && ROLE_WORDS.test(fromTitle) && fromTitle.length <= 90) return fromTitle;
  const prefix = /^(.{3,60}?\b(?:Intern|Engineer|Developer|Analyst|Designer|Scientist|Researcher|Trainee))\b/.exec(lines[0] ?? "");
  const candidate = lines.slice(0, 8).find((l) => ROLE_WORDS.test(l) && l.length <= 80 && !/[.!?]$/.test(l) && !headingKind(l));
  if (candidate) return collapseWhitespace(candidate.replace(/^(?:we['’]re hiring|hiring|now hiring)\s*[:：-]?\s*/i, ""));
  if (prefix && !headingKind(prefix[1]!)) return prefix[1]!.trim();
  const sentence = /\b(?:hiring|looking for|seeking)\s+(?:an?\s+)?([A-Z][\w-]*(?:\s+[A-Z][\w-]*){0,4}\s+(?:Intern|Engineer|Developer|Analyst|Designer|Scientist))\b/.exec(input.text);
  return sentence?.[1];
}

function cleanCompany(s: string): string {
  return collapseWhitespace(s.replace(/\b(?:careers?|jobs?|hiring|job board|recruiting|talent)\b/gi, "").replace(/[|·—–-]+\s*$/, ""));
}

function extractCompany(input: ParseJobInput, lines: string[], title: string | undefined, sections: Section[]): string | undefined {
  const label = /^(?:company|organi[sz]ation|employer|company name)\s*[:：-]\s*(.+)$/im.exec(input.text);
  if (label) return cleanCompany(label[1]!);

  const parts = input.pageTitle?.split(/\s+[—–|]\s+|\s+-\s+|\s+at\s+/) ?? [];
  if (parts.length > 1) {
    const c = cleanCompany(parts[parts.length - 1]!);
    if (c && !ROLE_WORDS.test(c)) return c;
  }

  // A short capitalized line right after the title line (e.g. "<p class=company>Example AI</p>").
  if (title) {
    const idx = lines.findIndex((l) => l.includes(title));
    const next = idx >= 0 ? lines[idx + 1] : undefined;
    if (next && next.length <= 40 && /^[A-Z0-9]/.test(next) && !/\d{2,}|[·|,.:]/.test(next) && !ROLE_WORDS.test(next) && !headingKind(next)) {
      return next.trim();
    }
  }

  const about = sections.find((s) => s.kind === "about");
  if (about) {
    const name = about.heading.replace(/^about\s+(?:us|the\s+(?:role|team|company|job))?/i, "").replace(/[:：]$/, "").trim();
    if (name) return name;
  }

  const hiring = /\b([A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,3})\s+(?:is|are)\s+(?:hiring|looking|seeking)\b/.exec(input.text);
  if (hiring && !/^(?:We|The|Our)$/.test(hiring[1]!)) return hiring[1]!.split(/\.(?:\s|$)/)[0];
  const join = /\b(?:join|at)\s+((?:[A-Z][\w&.'-]*)(?:\s+[A-Z][\w&.'-]*){0,3})/.exec(input.text);
  if (join && !ROLE_WORDS.test(join[1]!) && !/^(?:Our|The|Us)\b/.test(join[1]!)) return join[1]!.split(/\.(?:\s|$)/)[0];

  if (input.url) {
    try {
      const host = new URL(input.url).hostname.replace(/^(?:www|jobs|careers|boards)\./, "");
      const label = host.split(".")[0];
      if (label && !["example", "localhost", "greenhouse", "lever", "workday", "linkedin", "indeed"].includes(label)) {
        return label[0]!.toUpperCase() + label.slice(1);
      }
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

function extractMeta(text: string, lines: string[]) {
  const head = lines.slice(0, 12).join("\n");
  const firstMatch = (res: [RegExp, string][], hay: string) => {
    let best: { idx: number; value: string } | undefined;
    for (const [re, value] of res) {
      const m = re.exec(hay);
      if (m && (!best || m.index < best.idx)) best = { idx: m.index, value };
    }
    return best?.value;
  };

  const modeRes: [RegExp, string][] = [
    [/\bhybrid\b/i, "hybrid"],
    [/\b(?:fully\s+)?remote\b(?!\s+(?:not|isn't))/i, "remote"],
    [/\bon[\s-]?site\b|\bin[\s-]office\b|\bin[\s-]person\b/i, "onsite"],
  ];
  const workMode = (firstMatch(modeRes, head) ?? firstMatch(modeRes, text)) as JobData["workMode"] | undefined;

  const typeRes: [RegExp, string][] = [
    [/\binternship\b|\bintern\b/i, "Internship"],
    [/\bfull[\s-]?time\b/i, "Full-time"],
    [/\bpart[\s-]?time\b/i, "Part-time"],
    [/\bcontract(?:or)?\b/i, "Contract"],
  ];
  const employmentType = firstMatch(typeRes, head) ?? firstMatch(typeRes, text);

  const durationM = /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|twelve)[\s-]*(?:to\s*\d+\s*)?(months?|weeks?)\b/i.exec(text);
  const duration = durationM ? `${durationM[1]} ${durationM[2]!.toLowerCase().replace(/^(month|week)$/, "$1s")}` : undefined;

  let location: string | undefined;
  const locLabel = /^(?:location|based in|office)\s*[:：-]\s*(.+)$/im.exec(text);
  if (locLabel) location = collapseWhitespace(locLabel[1]!.split(/[·|•(]/)[0]!);
  if (!location) {
    for (const line of lines.slice(0, 15)) {
      for (const seg of line.split(/\s*[·|•]\s*/)) {
        if (/^[A-Z][A-Za-zÀ-ÿ .'-]+,\s*[A-Z][A-Za-zÀ-ÿ .'-]+$/.test(seg.trim()) && seg.length <= 50 && !ROLE_WORDS.test(seg)) {
          location = seg.trim();
          break;
        }
      }
      if (location) break;
    }
  }
  if (!location) {
    const beforeDot = /([A-Z][a-zÀ-ÿ]+(?:\s[A-Z][a-zÀ-ÿ]+)?,\s*[A-Z][a-zÀ-ÿ]+(?:\s[A-Z][a-zÀ-ÿ]+)?)\s*[·|•]/.exec(text);
    if (beforeDot) location = beforeDot[1];
  }
  if (!location) {
    const inCity = /\b(?:in|from)\s+([A-Z][a-zÀ-ÿ]+(?:\s[A-Z][a-zÀ-ÿ]+)?,\s*[A-Z][a-zÀ-ÿ]+(?:\s[A-Z][a-zÀ-ÿ]+)?)\b/.exec(text);
    if (inCity) location = inCity[1];
  }
  if (!location && workMode === "remote") location = "Remote";

  return { workMode, employmentType, duration, location };
}

function extractDeadline(text: string): string | undefined {
  const date = `(${MONTHS}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}|\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTHS}\\.?,?\\s+\\d{4}|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}/\\d{1,2}/\\d{4})`;
  const re = new RegExp(
    `(?:apply\\s+(?:by|before)|deadline(?:\\s+to\\s+apply)?|applications?\\s+(?:close|closes|are\\s+due|due)(?:\\s+on|\\s+by)?|closing\\s+date|last\\s+date(?:\\s+to\\s+apply)?|apply\\s+no\\s+later\\s+than)\\s*[:：-]?\\s*(?:on\\s+)?${date}`,
    "i",
  );
  return re.exec(text)?.[1]?.replace(/\s+/g, " ");
}

function extractContactEmail(text: string): string | undefined {
  return (text.match(EMAIL_RE) ?? []).find((e) => !/no-?reply|donotreply/i.test(e));
}

// ---------------------------------------------------------------------------

export function parseJobText(input: ParseJobInput): JobData {
  const safeText = stripInjectedSegments(input.text ?? "");
  const collapsed = (safeText.match(/\n/g)?.length ?? 0) < 5 && safeText.length >= 200;
  const structured = restoreStructure(safeText);
  const lines = structured.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const { preamble, sections } = toSections(lines);

  const title = extractTitle({ ...input, text: structured }, lines) ?? "Untitled role";
  const company = extractCompany({ ...input, text: structured }, lines, title, sections) ?? "Unknown company";
  const meta = extractMeta(structured, lines);

  const reqSections = sections.filter((s) => s.kind === "requirements");
  const prefSections = sections.filter((s) => s.kind === "preferred");
  const reqItems = reqSections.flatMap((s) => sectionItems(s, collapsed));
  const prefItems = prefSections.flatMap((s) => sectionItems(s, collapsed));
  const responsibilities = sections.filter((s) => s.kind === "responsibilities").flatMap((s) => sectionItems(s, collapsed));

  let requirements: string[] = [];
  let preferred: string[] = [];
  const qualifications: string[] = [];
  let graduationRequirement: string | undefined;

  for (const item of reqItems) {
    const skills = skillsFromItem(item);
    if (QUALIFICATION_WORDS.test(item) && skills.length === 0) {
      qualifications.push(item);
      if (!graduationRequirement && /graduat|degree|pursuing|bachelor|master|b\.?\s?tech|enrolled/i.test(item)) graduationRequirement = item;
    } else if (skills.length) {
      requirements.push(...skills);
    } else {
      qualifications.push(item);
    }
  }
  for (const item of prefItems) {
    const skills = skillsFromItem(item);
    if (skills.length) preferred.push(...skills);
    else qualifications.push(`${item} (preferred)`);
  }

  // No explicit requirements section → every skill mentioned outside "preferred" counts as required.
  if (!reqItems.length) {
    const prefText = prefSections.flatMap((s) => s.lines).join("\n");
    const other = [...preamble, ...sections.filter((s) => s.kind !== "preferred" && s.kind !== "benefits").flatMap((s) => s.lines)];
    requirements = other.flatMap((l) => skillsFromItem(l)).filter((s) => !prefText || !skillsFromItem(prefText).includes(s));
    for (const l of other) {
      if (!graduationRequirement && /graduat\w*\s+(?:in|by)|pursuing\s+(?:a\s+)?(?:bachelor|master|degree|b\.?\s?tech)/i.test(l)) {
        graduationRequirement = stripTrailingPunctuation(l.replace(BULLET, ""));
        qualifications.push(graduationRequirement);
      }
    }
  }

  requirements = dedupe(requirements);
  const reqLower = new Set(requirements.flatMap((r) => r.toLowerCase().split(/\s*\/\s*/)));
  preferred = dedupe(preferred).filter((p) => !requirements.includes(p) && !reqLower.has(p.toLowerCase()));

  const job: JobData = {
    company,
    title,
    location: meta.location,
    workMode: meta.workMode,
    employmentType: meta.employmentType,
    duration: meta.duration,
    graduationRequirement,
    requirements,
    preferred,
    responsibilities: dedupe(responsibilities).slice(0, 12),
    qualifications: dedupe(qualifications).slice(0, 10),
    deadline: extractDeadline(structured),
    contactEmail: extractContactEmail(safeText),
    url: input.url,
    source: input.source,
    extractedWith: "heuristic",
  };
  job.summary = summarizeJob(job);
  return job;
}

export function summarizeJob(job: JobData): string {
  const where = [job.workMode ? job.workMode[0]!.toUpperCase() + job.workMode.slice(1) : undefined, job.location].filter(Boolean).join(", ");
  const length = job.duration ? ` for ${job.duration}` : "";
  const skills = job.requirements.length ? ` Key requirements: ${joinList(job.requirements.slice(0, 6))}.` : "";
  return `${job.company} is hiring a ${job.title}${where ? ` (${where})` : ""}${length}.${skills}`;
}
