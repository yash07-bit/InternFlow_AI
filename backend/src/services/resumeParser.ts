/**
 * Heuristic resume parser for plain-text resumes (Drive exports, PDFs converted to text, pasted text).
 * Recognizes common section headings (EDUCATION, SKILLS, PROJECTS, EXPERIENCE, …).
 */
import type { ProviderId, ResumeData, ResumeEducation, ResumeExperience, ResumeProject } from "@internflow/shared";
import { skillNames } from "./skills.js";
import { collapseWhitespace, stripTrailingPunctuation, titleCase, truncate } from "../utils/text.js";
import { nowIso } from "../utils/ids.js";

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

type ResumeSection = "education" | "skills" | "projects" | "experience" | "summary" | "other";

const SECTION_HEADINGS: { kind: ResumeSection; re: RegExp }[] = [
  { kind: "education", re: /^(?:education|academic background|academics|education & certifications)$/i },
  { kind: "skills", re: /^(?:skills|technical skills|core skills|skills & tools|technologies|tech stack|tools & technologies)$/i },
  { kind: "projects", re: /^(?:projects|personal projects|academic projects|selected projects|key projects)$/i },
  { kind: "experience", re: /^(?:experience|work experience|professional experience|employment|internships?|work history|leadership & experience)$/i },
  { kind: "summary", re: /^(?:summary|profile|objective|about me|professional summary)$/i },
  { kind: "other", re: /^(?:certifications?|awards|achievements|publications|activities|interests|languages|volunteering)$/i },
];

const MAX_RAW_TEXT = 20_000;
const BULLET = /^\s*(?:[-*•●▪◦–]|\d+[.)])\s+/;

function sectionOf(line: string): ResumeSection | undefined {
  const clean = line.replace(/[:：]\s*$/, "").trim();
  if (clean.length > 40) return undefined;
  return SECTION_HEADINGS.find((s) => s.re.test(clean))?.kind;
}

function parseEducation(lines: string[]): ResumeEducation[] {
  const out: ResumeEducation[] = [];
  for (const line of lines) {
    const grad = /(?:expected\s+)?graduat(?:ion|ing|ed)\s*[:：-]?\s*(.+)$/i.exec(line) ?? /^(?:class of)\s+(\d{4})/i.exec(line);
    const last = out[out.length - 1];
    if (grad && last) {
      last.graduation = stripTrailingPunctuation(grad[1]!);
      continue;
    }
    const parts = line.split(/\s+[—–|]\s+|\s+-\s+/);
    if (parts.length >= 2) {
      const [a, b] = [parts[0]!.trim(), parts.slice(1).join(" — ").trim()];
      const aIsDegree = /\b(?:b\.?\s?tech|b\.?e\.?|b\.?sc|bachelor|master|m\.?tech|m\.?sc|ph\.?d|diploma|degree|associate)\b/i.test(a);
      out.push(aIsDegree ? { institution: b, degree: a } : { institution: a, degree: b });
      const yearInline = /\b(20\d{2})\b(?!.*\b20\d{2}\b)/.exec(line);
      if (yearInline && /expected|graduat|class of|–\s*20\d{2}|-\s*20\d{2}/i.test(line)) out[out.length - 1]!.graduation = yearInline[1];
    } else if (last && !last.details) {
      last.details = line;
    } else if (!last) {
      out.push({ institution: line, degree: "" });
    }
  }
  return out;
}

function parseSkills(lines: string[]): string[] {
  const skills: string[] = [];
  for (const line of lines) {
    const body = line.includes(":") ? line.slice(line.indexOf(":") + 1) : line.replace(BULLET, "");
    for (const raw of body.split(/[,;|•]/)) {
      const s = collapseWhitespace(raw);
      if (s && s.length <= 40) skills.push(s);
    }
  }
  return [...new Set(skills)];
}

function parseProjects(lines: string[]): ResumeProject[] {
  const out: ResumeProject[] = [];
  for (const line of lines) {
    if (BULLET.test(line)) {
      const last = out[out.length - 1];
      if (last) last.highlights.push(stripTrailingPunctuation(line.replace(BULLET, "")) + ".");
      continue;
    }
    const [name, tech] = line.split(/\s+[|—–]\s+|\s*\|\s*/, 2);
    const technologies = tech ? tech.split(/[,;]/).map((t) => collapseWhitespace(t)).filter(Boolean) : skillNames(line);
    out.push({ name: collapseWhitespace(name ?? line), description: "", technologies, highlights: [] });
  }
  for (const p of out) {
    p.description = p.highlights[0] ?? "";
    // Technologies mentioned only in bullet points still count as project evidence.
    const extra = skillNames(p.highlights.join(" ")).filter((s) => !p.technologies.some((t) => t.toLowerCase() === s.toLowerCase()));
    p.technologies.push(...extra);
  }
  return out;
}

function parseExperience(lines: string[]): ResumeExperience[] {
  const out: ResumeExperience[] = [];
  for (const line of lines) {
    if (BULLET.test(line)) {
      out[out.length - 1]?.highlights.push(stripTrailingPunctuation(line.replace(BULLET, "")) + ".");
      continue;
    }
    const period = /\(([^)]*\d{4}[^)]*)\)\s*$/.exec(line)?.[1];
    const head = period ? line.replace(/\s*\([^)]*\)\s*$/, "") : line;
    const [a, b] = head.split(/\s+[—–|@]\s+|\s+-\s+|\s+at\s+/, 2);
    out.push({ title: collapseWhitespace(a ?? head), organization: collapseWhitespace(b ?? ""), period, highlights: [] });
  }
  return out;
}

export interface ParseResumeInput {
  text: string;
  fileName: string;
  fileId?: string;
  source: ProviderId | "upload";
  modifiedAt?: string;
}

export function parseResumeText(input: ParseResumeInput): ResumeData {
  const text = input.text.replace(/\r\n?/g, "\n");
  const lines = text.split("\n").map((l) => l.trim());
  const buckets: Record<ResumeSection, string[]> = { education: [], skills: [], projects: [], experience: [], summary: [], other: [] };
  const header: string[] = [];
  let current: ResumeSection | undefined;

  for (const line of lines) {
    if (!line) continue;
    const kind = sectionOf(line);
    if (kind) {
      current = kind;
      continue;
    }
    if (current) buckets[current].push(line);
    else header.push(line);
  }

  const nameLine = header[0] ?? "";
  const name = nameLine && nameLine === nameLine.toUpperCase() ? titleCase(nameLine) : nameLine;
  const email = EMAIL.exec(text)?.[0];
  const contactLine = header.find((l) => l.includes("|") || EMAIL.test(l)) ?? "";
  const contactParts = contactLine.split(/\s*\|\s*/);
  const links = contactParts.filter((p) => /(?:github|linkedin|gitlab|portfolio|\.dev|\.io|https?:\/\/)/i.test(p)).map((p) => p.trim());
  const location = contactParts.find((p) => /^[A-Z][A-Za-z .'-]+,\s*[A-Z][A-Za-z .'-]+$/.test(p.trim()))?.trim();
  const headline = header.find((l, i) => i > 0 && l !== contactLine && !l.startsWith("(") && l.length > 20);

  const projects = parseProjects(buckets.projects);
  const experience = parseExperience(buckets.experience);
  const skillList = parseSkills(buckets.skills);
  // Skills evidenced in projects/experience but not listed explicitly are added (they are still resume facts).
  const evidenced = skillNames(text);
  const skills = [...skillList];
  for (const s of evidenced) if (!skills.some((k) => k.toLowerCase() === s.toLowerCase())) skills.push(s);

  return {
    fileId: input.fileId,
    fileName: input.fileName,
    source: input.source,
    modifiedAt: input.modifiedAt,
    candidate: { name: name || "Candidate", email, location, links },
    headline,
    education: parseEducation(buckets.education),
    skills,
    projects,
    experience,
    rawText: truncate(text.trim(), MAX_RAW_TEXT),
    retrievedAt: nowIso(),
  };
}

/** Pick the best resume from Drive search results: newest file named resume/CV, skipping "old" copies. */
export function pickBestResume<T extends { name: string; modifiedTime: string }>(files: T[]): T | undefined {
  const named = files.filter((f) => /\b(?:resume|résumé|cv|curriculum vitae)\b/i.test(f.name));
  const fresh = named.filter((f) => !/\b(?:old|outdated|archive[d]?|backup|copy of|deprecated)\b/i.test(f.name));
  const pool = fresh.length ? fresh : named;
  return [...pool].sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime))[0];
}
