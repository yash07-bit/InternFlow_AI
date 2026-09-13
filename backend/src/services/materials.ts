/**
 * Application material generation. Two paths:
 *   - template composition (default, no API key): natural prose assembled ONLY from resume + job facts
 *   - Claude (anthropic provider): strict grounding rules, then validated; falls back to templates
 *     if the model is unavailable or produces anything the grounding validator cannot verify.
 */
import type { ApplicationAnswer, EmailContext, GroundingReport, JobData, MatchData, ResumeData, ResumeProject } from "@internflow/shared";
import { z } from "zod";
import { validateGrounding } from "./grounding.js";
import { parseRequirement } from "./matcher.js";
import { structuredJsonCall, UNTRUSTED_NOTICE, wrapUntrusted, type LlmClient } from "./llm.js";
import { getSkill, mentionsSkill } from "./skills.js";
import { joinList, lowerFirst, stripTrailingPunctuation } from "../utils/text.js";
import { formatShortDate } from "../utils/time.js";
import { newId } from "../utils/ids.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("materials");

export const DEFAULT_QUESTIONS = [
  "Why are you interested in this role?",
  "What relevant experience do you have?",
  "Why this company?",
];

export const VARIANT_COUNT = 3;

export interface MaterialsInput {
  job: JobData;
  resume: ResumeData;
  match?: MatchData;
  emailContext?: EmailContext;
  variant?: number;
  tone?: string;
}

// ---------------------------------------------------------------------------
// Fact extraction (resume + job only)
// ---------------------------------------------------------------------------

const PAST_VERB = /^(?:[A-Z][a-z]+ed|Built|Led|Made|Wrote|Ran|Drove|Won|Taught|Set up|Shipped|Grew|Rebuilt|Took|Began|Sped|Cut|Held|Spoke|Kept|Found|Brought|Chose|Drew|Fed|Got|Gave|Hit|Put|Sold|Sent|Spent|Stood|Understood)\b/;

function asClause(highlight: string): string | undefined {
  const h = stripTrailingPunctuation(highlight);
  return PAST_VERB.test(h) ? lowerFirst(h) : undefined;
}

function facts(input: MaterialsInput) {
  const { job, resume, match } = input;
  const edu = resume.education[0];
  const degreeShort = edu?.degree.split(/\s+in\s+/i)[0]?.trim();
  const field = edu?.degree.includes(" in ") ? edu.degree.split(/\s+in\s+/i).slice(1).join(" in ").trim() : undefined;
  const has = (s: string) => resume.skills.some((k) => k.toLowerCase() === s.toLowerCase()) || mentionsSkill(resume.rawText, s);

  // Skills the job asks for that the resume actually evidences, in job order.
  const matched: string[] = [];
  const requirementList = match
    ? match.skills.filter((s) => s.status === "found").map((s) => s.skill)
    : [...job.requirements, ...job.preferred];
  for (const req of requirementList) {
    const alt = parseRequirement(req).alternatives.find(has);
    if (alt && !matched.includes(alt)) matched.push(alt);
  }

  const gapSkills = (match?.skills ?? [])
    .filter((s) => s.status !== "found")
    .flatMap((s) => parseRequirement(s.skill).alternatives)
    .filter((s) => !has(s));
  const relatedPlatforms = (match?.skills ?? [])
    .filter((s) => s.status === "partial" && /^cloud/i.test(s.skill))
    .flatMap((s) => s.evidence.map((e) => /related:\s*(.+)$/.exec(e)?.[1] ?? ""))
    .flatMap((s) => s.split(/,\s*/))
    .filter(Boolean);

  const projectOrder = match?.relevantProjects.map((p) => p.name) ?? [];
  const projects = [...resume.projects].sort((a, b) => {
    const ia = projectOrder.indexOf(a.name);
    const ib = projectOrder.indexOf(b.name);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });

  const techOf = (p: ResumeProject, n = 4) => p.technologies.filter((t) => getSkill(t)).slice(0, n);
  const inWindow = (match?.breakdown.eligibility.score ?? 0) >= 0.99 && Boolean(edu?.graduation);
  const reviewResp = job.responsibilities.find((r) => /review|git/i.test(r));
  const collabResp = job.responsibilities.find((r) => /collaborat|work with|partner/i.test(r));

  return { job, resume, edu, degreeShort, field, matched, gapSkills: [...new Set(gapSkills)], relatedPlatforms: [...new Set(relatedPlatforms)], projects, techOf, inWindow, reviewResp, collabResp };
}

const article = (word: string) => (/^[AEIOU]/i.test(word) ? "an" : "a");
const pick = <T>(options: T[], variant: number): T => options[((variant % options.length) + options.length) % options.length]!;

function projectSentence(p: ResumeProject, techList: string[], lead: string): string {
  const clauses = p.highlights.map(asClause).filter((c): c is string => Boolean(c)).slice(0, 2);
  const tech = techList.length ? ` with ${joinList(techList)}` : "";
  if (!clauses.length) return `${lead} ${p.name} project${tech}.`;
  return `${lead} ${p.name} project${tech}, I ${joinList(clauses)}.`;
}

function studentLine(f: ReturnType<typeof facts>): string | undefined {
  if (!f.edu) return undefined;
  const subject = f.field ? `${f.field} student` : "student";
  const grad = f.edu.graduation ? ` (expected graduation ${f.edu.graduation})` : "";
  return `${article(subject)} ${subject} at ${f.edu.institution}${grad}`;
}

function gapSentence(f: ReturnType<typeof facts>): string | undefined {
  if (!f.gapSkills.length) return undefined;
  const cloud = f.gapSkills.filter((s) => ["AWS", "GCP", "Azure"].includes(s));
  const other = f.gapSkills.filter((s) => !cloud.includes(s));
  const parts = [...other, ...(cloud.length ? [`cloud platforms such as ${joinList(cloud, "or")}`] : [])];
  const soFar = f.relatedPlatforms.length ? ` So far my deployment experience is with ${joinList(f.relatedPlatforms)}.` : "";
  return `The posting also lists ${joinList(parts)} as preferred qualifications; I haven't used ${parts.length > 1 ? "them" : "it"} in a project yet, and I'm keen to build hands-on experience during the internship.${soFar}`;
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export function composeCoverLetter(input: MaterialsInput): string {
  const f = facts(input);
  const v = input.variant ?? 0;
  const { job, resume } = f;
  const name = resume.candidate.name;
  const top = f.matched.slice(0, 4);
  const student = studentLine(f);

  const opener = pick(
    [
      `I'm excited to apply for the ${job.title} position at ${job.company}.`,
      `I'm writing to express my interest in the ${job.title} role at ${job.company}.`,
      `The ${job.title} opening at ${job.company} immediately caught my attention.`,
    ],
    v,
  );
  const intro = [
    opener,
    student ? `I'm ${student}, and` : "",
    top.length ? `my project work centers on ${joinList(top)}, which this role lists among its core requirements.` : "I'd like to bring my project experience to your team.",
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/, and my/, ", and my");

  const projects = v % 2 === 1 ? [...f.projects.slice(1, 2), ...f.projects.slice(0, 1), ...f.projects.slice(2)] : f.projects;
  const [p1, p2, p3] = projects;
  const body: string[] = [];
  if (p1) body.push(projectSentence(p1, f.techOf(p1), pick(["In my", "For my", "While building my"], v)).replace(/^While building my (.+?) project with/, "While building my $1 project with"));
  if (p2) {
    const c2 = p2.highlights.map(asClause).find(Boolean);
    const tech2 = f.techOf(p2);
    let s = `I also built ${article(p2.name)} ${p2.name}${tech2.length ? ` using ${joinList(tech2)}` : ""}${c2 ? `, where I ${c2}` : ""}`;
    if (p3) {
      const c3 = p3.highlights.map(asClause).find(Boolean);
      s += `, and ${article(p3.name)} ${p3.name}${c3 ? ` where I ${c3}` : ""}`;
    }
    body.push(`${s}.`);
  }

  const exp = resume.experience[0];
  const expClause = exp?.highlights.map(asClause).find(Boolean);
  if (exp && expClause && input.tone !== "concise") {
    const tie = f.reviewResp ? ", which maps directly to the code review workflow described in the posting" : "";
    body.push(`As ${article(exp.title)} ${exp.title.toLowerCase()}${exp.organization ? ` (${exp.organization})` : ""}, I ${expClause}${tie}.`);
  }

  const gaps = input.tone === "concise" ? undefined : gapSentence(f);
  const closing = pick(
    [
      `Thank you for considering my application. I'd welcome the opportunity to discuss how I can contribute to ${job.company}'s engineering team.`,
      `Thank you for your time and consideration — I'd love to talk about how my project experience could help ${job.company}.`,
      `I'd be glad to walk you through any of these projects in more detail. Thank you for considering my application.`,
    ],
    v,
  );
  const signoff = pick(["Sincerely", "Best regards", "Kind regards"], v);

  return [
    `Dear ${job.company} Hiring Team,`,
    intro,
    body.slice(0, 2).join(" "),
    body.slice(2).join(" "),
    gaps,
    closing,
    `${signoff},\n${name}`,
  ]
    .filter((p): p is string => Boolean(p && p.trim()))
    .join("\n\n");
}

export function composeAnswers(input: MaterialsInput, questions: string[] = DEFAULT_QUESTIONS): ApplicationAnswer[] {
  const f = facts(input);
  const v = input.variant ?? 0;
  const { job, resume } = f;
  const [p1, p2, p3] = f.projects;
  const top = f.matched.slice(0, 4);

  const whyRole = () => {
    const parts: string[] = [];
    parts.push(
      pick(
        [
          `I'm interested in the ${job.title} role because it centers on ${joinList(top)} — the stack I've used across my projects.`,
          `This role stands out to me because its core requirements — ${joinList(top)} — are exactly what I've been building with.`,
          `The ${job.title} role is a strong fit for the work I enjoy: it focuses on ${joinList(top)}, which I've used throughout my projects.`,
        ],
        v,
      ),
    );
    const resp = job.responsibilities[0];
    const c1 = p1?.highlights.map(asClause).find(Boolean);
    if (resp && p1 && c1) parts.push(`The posting mentions work like "${stripTrailingPunctuation(resp)}", which is close to my ${p1.name} project, where I ${c1}.`);
    if (f.inWindow && f.edu?.graduation) parts.push(`The timing also works: my expected graduation (${f.edu.graduation}) falls within the role's graduation window.`);
    return parts.join(" ");
  };

  const experience = () => {
    const items = [p1, p2, p3].filter((p): p is ResumeProject => Boolean(p)).map((p) => {
      const c = p.highlights.map(asClause).find(Boolean);
      const tech = f.techOf(p, 3);
      return `${p.name}${tech.length ? ` (${tech.join(", ")})` : ""}${c ? `, where I ${c}` : ""}`;
    });
    const parts = [items.length ? `My most relevant experience comes from ${items.length === 1 ? "my project" : `${items.length} projects`}: ${items.join("; ")}.` : ""];
    const exp = resume.experience[0];
    const ec = exp?.highlights.map(asClause).find(Boolean);
    if (exp && ec) parts.push(`As ${article(exp.title)} ${exp.title.toLowerCase()}, I also ${ec}.`);
    if (top.length) parts.push(`Across this work I've used ${joinList(f.matched)}.`);
    return parts.filter(Boolean).join(" ");
  };

  const whyCompany = () => {
    const parts = [
      pick(
        [
          `${job.company} is looking for someone to ${lowerFirst(stripTrailingPunctuation(job.responsibilities[0] ?? `join the team as a ${job.title}`))}, and that kind of hands-on product engineering is what I want to do more of.`,
          `What draws me to ${job.company} is the chance to do real product engineering — the posting describes work such as "${stripTrailingPunctuation(job.responsibilities[1] ?? job.responsibilities[0] ?? job.title)}".`,
          `I'd like to join ${job.company} because this internship offers hands-on engineering work rather than an isolated side project.`,
        ],
        v,
      ),
    ];
    if (f.collabResp) parts.push(`I'd especially value the opportunity to ${lowerFirst(stripTrailingPunctuation(f.collabResp))}.`);
    if (f.gapSkills.length) parts.push(`It would also help me grow: I'm keen to learn ${joinList(f.gapSkills, "and")} from a team that uses them.`);
    return parts.join(" ");
  };

  const generic = (q: string) => {
    if (/challeng|difficult|problem/i.test(q) && p1) {
      const clauses = p1.highlights.map(asClause).filter(Boolean);
      return `One of the more challenging parts of my ${p1.name} project was that I ${joinList(clauses.slice(0, 2) as string[])}. It taught me to break a larger problem into smaller pieces and test each part as I went.`;
    }
    if (/team|collaborat/i.test(q) && resume.experience[0]) return experience();
    return experience();
  };

  return questions.map((question, i) => {
    const q = question.toLowerCase();
    const answer = /why.*(role|position|internship|job)|interest/.test(q)
      ? whyRole()
      : /experience|background|qualif|skills/.test(q)
        ? experience()
        : /why.*(company|us|join|work (here|with us))/.test(q) || q.includes(job.company.toLowerCase())
          ? whyCompany()
          : generic(question);
    return { id: `answer-${i + 1}`, question, answer, edited: false };
  });
}

const locationPhrase = (location?: string) =>
  !location ? "" : /^remote\b/i.test(location.trim()) ? " (remote)" : ` in ${location}`;

export function composeFollowUpEmail(input: MaterialsInput & { recipientName?: string }): { subject: string; body: string } {
  const f = facts(input);
  const { job, resume, emailContext } = { ...f, emailContext: input.emailContext };
  const baseSubject = emailContext?.lastSubject?.replace(/^(?:re|fwd?):\s*/i, "").trim();
  const subject = `Following up — ${baseSubject || `${job.title} application`}`;
  const greetingName = input.recipientName ?? emailContext?.recruiter?.name ?? `${job.company} team`;

  const lastInbound = emailContext?.messages.find((m) => emailContext.recruiter && m.from.email === emailContext.recruiter.email);
  const opening = lastInbound
    ? `Thank you again for your reply on ${formatShortDate(new Date(lastInbound.date))} about the ${baseSubject ?? job.title}. I've now prepared my application for the ${job.title} role${locationPhrase(job.location)} and wanted to follow up on this thread.`
    : `I hope you're doing well. I've prepared my application for the ${job.title} role${locationPhrase(job.location)} and wanted to reach out to express my interest.`;

  const projects = f.projects.slice(0, 2).map((p) => p.name);
  const background =
    f.edu && projects.length
      ? `I'm ${studentLine(f)?.replace(/ \(expected graduation [^)]*\)/, "")}, and my projects — including ${joinList(projects)} — use ${joinList(f.matched.slice(0, 4))}, which line up with the role's core requirements.`
      : f.matched.length
        ? `My project experience with ${joinList(f.matched.slice(0, 4))} lines up with the role's core requirements.`
        : "";

  const body = [
    `Hi ${greetingName},`,
    opening,
    background,
    "I'd be glad to share any additional information that would be helpful. Thank you for your time!",
    `Best regards,\n${resume.candidate.name}${resume.candidate.email ? `\n${resume.candidate.email}` : ""}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  return { subject, body };
}

// ---------------------------------------------------------------------------
// Claude-assisted generation (strictly grounded, validated)
// ---------------------------------------------------------------------------

const LlmMaterialsSchema = z.object({
  coverLetter: z.string().min(200).max(6000),
  answers: z.array(z.object({ question: z.string(), answer: z.string().min(40).max(3000) })),
});

const WRITING_SYSTEM = `You write internship application materials for a candidate.
Strict grounding rules:
- Use ONLY facts present in the candidate's resume and the structured job data provided.
- Never invent internships, employers, metrics, numbers, awards, dates, projects or technologies.
- A technology may only be claimed as experience if it appears in the resume. If the job asks for a technology the resume lacks, you may say the candidate is keen to learn it — never imply experience.
- Write naturally and specifically (reference real project names and what the candidate did), in first person, without clichés.
- Cover letter: 4–6 short paragraphs, greeting "Dear <Company> Hiring Team," and sign-off with the candidate's name.
${UNTRUSTED_NOTICE}`;

export async function generateMaterialsWithLlm(
  client: LlmClient,
  input: MaterialsInput,
  opts: { kinds: ("cover_letter" | "answers")[]; questions?: string[] },
): Promise<{ coverLetter?: string; answers?: ApplicationAnswer[] } | null> {
  const questions = opts.questions ?? DEFAULT_QUESTIONS;
  const { rawText: _raw, ...resumeFacts } = input.resume;
  try {
    const result = await structuredJsonCall(client, {
      system: WRITING_SYSTEM,
      schema: LlmMaterialsSchema,
      prompt: [
        `Job (structured, extracted from the posting):\n${JSON.stringify(input.job)}`,
        input.match ? `Match analysis:\n${JSON.stringify({ strengths: input.match.strengths, gaps: input.match.gaps, relevantProjects: input.match.relevantProjects })}` : "",
        `Candidate resume:\n${wrapUntrusted("google_drive", JSON.stringify(resumeFacts))}`,
        `Write a cover letter${opts.kinds.includes("answers") ? ` and answers (80–150 words each) to these questions: ${JSON.stringify(questions)}` : " (answers may be an empty array)"}.`,
        input.variant ? `This is regeneration #${input.variant}; use noticeably different phrasing and structure from a typical first draft.` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    });
    const answers = result.answers.slice(0, questions.length).map((a, i) => ({ id: `answer-${i + 1}`, question: questions[i] ?? a.question, answer: a.answer, edited: false }));
    const report = groundMaterials(input, result.coverLetter, answers);
    if (!report.verified) {
      log.warn(`LLM materials failed grounding (${report.unsupportedClaims.join("; ")}) — using templates`);
      return null;
    }
    return { coverLetter: opts.kinds.includes("cover_letter") ? result.coverLetter : undefined, answers: opts.kinds.includes("answers") ? answers : undefined };
  } catch (err) {
    log.warn("LLM material generation failed — using templates", err);
    return null;
  }
}

export function groundMaterials(input: MaterialsInput, coverLetter?: string, answers?: ApplicationAnswer[]): GroundingReport {
  return validateGrounding({
    job: input.job,
    resume: input.resume,
    texts: [
      ...(coverLetter ? [{ label: "Cover letter", text: coverLetter }] : []),
      ...(answers ?? []).map((a) => ({ label: a.question, text: a.answer })),
    ],
  });
}

/** Pick the next phrasing variant that produces different text from `current`. */
export function nextVariant(current: string | undefined, render: (variant: number) => string): number {
  if (!current) return 0;
  const idx = Array.from({ length: VARIANT_COUNT }, (_, i) => i).find((i) => render(i) === current);
  return idx === undefined ? 1 : (idx + 1) % VARIANT_COUNT;
}

export const newAnswerId = () => newId("ans");
