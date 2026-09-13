/**
 * Deterministic, explainable resume ↔ job matcher.
 *   score = round(65·R + 25·P + 10·E), found = 1, partial = 0.3, missing = 0
 * Every "found"/"partial" status carries evidence that cites a resume section. Nothing is inferred
 * beyond what the resume text actually contains.
 */
import type { JobData, MatchData, ResumeData, SkillMatch } from "@internflow/shared";
import { CLOUD_PROVIDERS, DEPLOYMENT_PLATFORMS, getSkill, mentionsSkill } from "./skills.js";
import { joinList } from "../utils/text.js";

const PARTIAL_WEIGHT = 0.3;

interface EvidenceSource {
  label: string; // "Skills", "Project: Route Optimization Platform"
  text: string;
}

/** Skills that are *potentially relevant* evidence for another skill (never counted as found). */
const RELATED: Record<string, (string | RegExp)[]> = {
  TypeScript: ["JavaScript"],
  JavaScript: ["TypeScript"],
  Docker: [/\bcontaineri[sz]\w*|\bcontainers?\b/i, "Kubernetes"],
  Kubernetes: ["Docker"],
  PostgreSQL: ["MySQL", "SQL"],
  MySQL: ["PostgreSQL", "SQL"],
  MongoDB: [/\bnosql\b/i, "Redis"],
  "Node.js": ["Express"],
  Express: ["Node.js"],
  "REST APIs": ["GraphQL", "Express", "FastAPI"],
  "Next.js": ["React"],
  React: ["Next.js"],
  Git: ["GitHub"],
  AWS: ["GCP", "Azure", ...DEPLOYMENT_PLATFORMS],
  GCP: ["AWS", "Azure", ...DEPLOYMENT_PLATFORMS],
  Azure: ["AWS", "GCP", ...DEPLOYMENT_PLATFORMS],
  CSS: ["Tailwind CSS"],
};

/** Skills whose presence implies another skill outright. */
const IMPLIES: Record<string, string[]> = {
  SQL: ["PostgreSQL", "MySQL"],
  Python: ["Django", "Flask", "FastAPI", "Pandas", "PyTorch", "TensorFlow"],
  JavaScript: ["React", "Node.js", "Next.js", "Vue", "Angular"],
  CSS: ["Tailwind CSS"],
};

function sectionText(raw: string, heading: RegExp): string | undefined {
  const lines = raw.split("\n");
  const start = lines.findIndex((l) => heading.test(l.trim()));
  if (start < 0) return undefined;
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^[A-Z][A-Z &]{3,30}$/.test(line.trim())) break;
    body.push(line);
  }
  return body.join("\n");
}

export function evidenceSources(resume: ResumeData): EvidenceSource[] {
  const sources: EvidenceSource[] = [];
  const skillsText = sectionText(resume.rawText, /^(?:technical\s+)?skills:?$/i) ?? resume.skills.join(", ");
  sources.push({ label: "Skills", text: skillsText });
  for (const p of resume.projects) {
    sources.push({ label: `Project: ${p.name}`, text: [p.name, p.technologies.join(", "), ...p.highlights].join("\n") });
  }
  for (const e of resume.experience) {
    sources.push({ label: `Experience: ${e.title}${e.organization ? ` (${e.organization})` : ""}`, text: [e.title, e.organization, ...e.highlights].join("\n") });
  }
  if (resume.education.length) {
    sources.push({ label: "Education", text: resume.education.map((e) => [e.degree, e.institution, e.details].join(" ")).join("\n") });
  }
  return sources;
}

const termIn = (text: string, term: string | RegExp): boolean => {
  if (term instanceof RegExp) return term.test(text);
  if (term === "Render") return /\bRender\b/.test(text);
  return getSkill(term) ? mentionsSkill(text, term) : new RegExp(`\\b${term}\\b`, "i").test(text);
};

const termLabel = (text: string, term: string | RegExp): string => {
  if (typeof term === "string") return term;
  return term.exec(text)?.[0] ?? "related experience";
};

/** "Cloud (AWS / GCP)" → alternatives + cloud flag; "JavaScript / TypeScript" → alternatives. */
export function parseRequirement(req: string): { alternatives: string[]; cloud: boolean } {
  const cloud = /^cloud\b/i.exec(req);
  if (cloud) {
    const inner = /\(([^)]*)\)/.exec(req)?.[1];
    return { alternatives: inner ? inner.split(/\s*\/\s*|\s+or\s+/).map((s) => s.trim()).filter(Boolean) : [], cloud: true };
  }
  return { alternatives: req.split(/\s+\/\s+/).map((s) => s.trim()).filter(Boolean), cloud: false };
}

function evaluate(req: string, category: SkillMatch["category"], sources: EvidenceSource[]): SkillMatch {
  const { alternatives, cloud } = parseRequirement(req);
  const found = new Set<string>();
  for (const alt of alternatives) {
    const impliedBy = IMPLIES[alt] ?? [];
    for (const src of sources) {
      if (termIn(src.text, alt)) found.add(src.label);
      else if (impliedBy.some((t) => termIn(src.text, t))) found.add(src.label);
    }
  }
  if (found.size) return { skill: req, category, status: "found", evidence: [...found] };

  const relatedTerms = new Set<string | RegExp>(alternatives.flatMap((a) => RELATED[a] ?? []));
  if (cloud) {
    DEPLOYMENT_PLATFORMS.forEach((p) => relatedTerms.add(p));
    CLOUD_PROVIDERS.filter((c) => !alternatives.includes(c)).forEach((c) => relatedTerms.add(c));
  }
  const partial: string[] = [];
  for (const src of sources) {
    const hits = [...relatedTerms].filter((t) => termIn(src.text, t)).map((t) => termLabel(src.text, t));
    if (hits.length) partial.push(`${src.label} — related: ${[...new Set(hits)].join(", ")}`);
  }
  if (partial.length) return { skill: req, category, status: "partial", evidence: partial };
  return { skill: req, category, status: "missing", evidence: [] };
}

function coverage(items: SkillMatch[]) {
  const found = items.filter((i) => i.status === "found").length;
  const partial = items.filter((i) => i.status === "partial").length;
  const total = items.length;
  const value = total === 0 ? 1 : (found + PARTIAL_WEIGHT * partial) / total;
  return { found, partial, missing: total - found - partial, total, coverage: Math.round(value * 1000) / 1000, raw: value };
}

const stripRaw = ({ raw: _raw, ...rest }: ReturnType<typeof coverage>) => rest;

// ---------------------------------------------------------------------------

export function eligibilityFit(job: JobData, resume: ResumeData): { score: number; note: string } {
  const requirement = job.graduationRequirement ?? job.qualifications.find((q) => /degree|graduat|pursuing|bachelor|master/i.test(q));
  if (!requirement) return { score: 1, note: "No specific education or graduation requirement was listed." };

  const notes: string[] = [];
  const edu = resume.education[0];
  const years = [...new Set(requirement.match(/\b20\d{2}\b/g) ?? [])];
  const gradYear = resume.education.map((e) => /\b(20\d{2})\b/.exec(e.graduation ?? "")?.[1]).find(Boolean);

  let gradFit = 1;
  if (years.length) {
    if (!gradYear) {
      gradFit = 0.5;
      notes.push("graduation year not stated on the resume");
    } else if (years.includes(gradYear)) {
      notes.push(`graduating ${edu?.graduation ?? gradYear} fits the ${years.join("–")} graduation window`);
    } else {
      gradFit = 0.3;
      notes.push(`graduation (${gradYear}) is outside the ${years.join("–")} window`);
    }
  }

  let degreeFit = 1;
  const degreeText = resume.education.map((e) => `${e.degree} ${e.details ?? ""}`).join(" ");
  const wantsCs = /computer science|software|information technology|computer engineering/i.test(requirement);
  if (wantsCs) {
    if (!degreeText.trim()) {
      degreeFit = 0.5;
      notes.push("degree not found on the resume");
    } else if (/computer science|software|information technology|computer engineering|\bcse\b|\bit\b/i.test(degreeText)) {
      notes.push(`${edu?.degree ?? "degree"} matches the field requirement`);
    } else if (/related field/i.test(requirement) && /engineering|technology|science|mathematics|electronics/i.test(degreeText)) {
      degreeFit = 0.8;
      notes.push(`${edu?.degree} may count as a related field`);
    } else {
      degreeFit = 0.4;
      notes.push(`${edu?.degree} is outside the requested field`);
    }
  }

  const score = Math.round((0.6 * gradFit + 0.4 * degreeFit) * 100) / 100;
  const note = notes.length ? notes.join("; ").replace(/^./, (c) => c.toUpperCase()) + "." : "Meets the education requirement.";
  return { score, note };
}

function strengthsFor(skills: SkillMatch[], resume: ResumeData): string[] {
  const found = new Set(skills.filter((s) => s.status === "found").flatMap((s) => parseRequirement(s.skill).alternatives.concat(s.skill)));
  const has = (n: string) => found.has(n);
  const hasFrontend = [...found].some((n) => getSkill(n)?.category === "frontend");
  const hasBackend = [...found].some((n) => getSkill(n)?.category === "backend");
  const out: string[] = [];
  if (hasFrontend && hasBackend) out.push("Full-stack development");
  if (has("REST APIs") && resume.projects.some((p) => /\bREST\b/i.test(p.highlights.join(" ")))) out.push("REST API design");
  if (has("React")) out.push("React frontends");
  if (has("Node.js")) out.push("Node.js backends");
  if (has("PostgreSQL")) out.push("PostgreSQL databases");
  if (has("Git")) out.push("Git-based collaboration");
  if (has("TypeScript")) out.push("TypeScript");
  for (const s of skills) {
    if (out.length >= 5) break;
    if (s.status === "found" && s.category === "required" && !out.some((o) => o.includes(s.skill))) out.push(s.skill);
  }
  return out.slice(0, 5);
}

export function matchResume(job: JobData, resume: ResumeData): MatchData {
  const sources = evidenceSources(resume);
  const required = job.requirements.map((r) => evaluate(r, "required", sources));
  const preferred = job.preferred.map((r) => evaluate(r, "preferred", sources));
  const R = coverage(required);
  const P = coverage(preferred);
  const E = eligibilityFit(job, resume);
  const score = Math.max(0, Math.min(100, Math.round(65 * R.raw + 25 * P.raw + 10 * E.score)));
  const skills = [...required, ...preferred];

  const jobSkills = [...new Set(skills.flatMap((s) => parseRequirement(s.skill).alternatives))];
  const relevantProjects = resume.projects
    .map((p) => {
      const text = [p.name, p.technologies.join(", "), ...p.highlights].join("\n");
      const matchedSkills = jobSkills.filter((s) => termIn(text, s));
      const api = matchedSkills.includes("REST APIs") && /\bREST\s+APIs?\b/i.test(p.highlights.join(" "));
      const tech = matchedSkills.filter((s) => !(api && s === "REST APIs")).slice(0, 4);
      const count = `${matchedSkills.length} of this role's skills`;
      return {
        name: p.name,
        matchedSkills,
        reason: `Built with ${joinList(tech)}${api ? ", and exposes a REST API" : ""} — covers ${count}.`,
      };
    })
    .filter((p) => p.matchedSkills.length > 0)
    .sort((a, b) => b.matchedSkills.length - a.matchedSkills.length)
    .slice(0, 3);

  const gaps = skills
    .filter((s) => s.status !== "found")
    .map((s) => (s.status === "partial" ? `${s.skill} (related experience only)` : s.skill));

  const label = score >= 80 ? "Strong" : score >= 60 ? "Good" : score >= 40 ? "Partial" : "Limited";
  const prefPart = P.total ? `; ${P.found} of ${P.total} preferred skills found${P.partial ? ` and ${P.partial} partially` : ""}` : "";
  const summary = `${label} match (${score}/100): ${R.found} of ${R.total} required skills found${prefPart}.`;

  return {
    score,
    breakdown: { required: stripRaw(R), preferred: stripRaw(P), eligibility: E },
    skills,
    strengths: strengthsFor(skills, resume),
    gaps,
    relevantProjects,
    summary,
  };
}
