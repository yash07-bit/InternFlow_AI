/**
 * Grounding validator: every technology, metric, degree and employer mentioned in generated text
 * must be backed by the resume — or, for technologies, be explicitly framed as a job requirement
 * the candidate wants to learn ("keen to build hands-on experience with Docker").
 */
import type { GroundingReport, JobData, ResumeData } from "@internflow/shared";
import { parseRequirement } from "./matcher.js";
import { findSkills, skillNames } from "./skills.js";
import { escapeRegex } from "../utils/text.js";

const LEARNING_FRAME =
  /\b(?:learn(?:ing)?|eager to|keen to|looking forward to|excited to (?:learn|grow|work with|build)|hope to|grow(?:ing)? (?:my|into|in)|build(?:ing)? (?:hands-on )?experience|gain(?:ing)? (?:hands-on )?experience|haven'?t (?:yet )?(?:used|worked)|not yet (?:used|worked)|pick(?:ing)? up|get hands-on|would (?:love|like) to|preferred qualifications?|the (?:role|posting) (?:lists|mentions|asks)|nice-to-have)\b/i;

const METRIC = /\b\d+(?:\.\d+)?\s*(?:%|percent\b|x\b|×|k\+?\s+(?:users|downloads|requests)|\+?\s*(?:users|customers|downloads|stars|requests per))/gi;
const EMPLOYER_CLAIM = /\b(?:interned|internship|worked|working|employed|job)\s+(?:at|with|for)\s+([A-Z][\w&.-]*(?:\s+[A-Z][\w&.-]*){0,3})/g;
const DEGREE_CLAIM = /\b(?:B\.?\s?Tech|B\.?E\.?|B\.?Sc|B\.?S\.|Bachelor(?:'s)?|M\.?\s?Tech|M\.?Sc|M\.?S\.|Master(?:'s)?|Ph\.?D)\b/g;

export interface GroundingInput {
  texts: { label: string; text: string }[];
  resume: ResumeData;
  job: JobData;
}

const sentences = (text: string) => text.split(/(?<=[.!?])\s+|\n+/).filter((s) => s.trim());

export function validateGrounding({ texts, resume, job }: GroundingInput): GroundingReport {
  const resumeText = resume.rawText;
  const resumeSkills = new Set(skillNames(resumeText));
  const jobSkills = new Set([
    ...[...job.requirements, ...job.preferred].flatMap((r) => parseRequirement(r).alternatives),
    ...skillNames([...job.responsibilities, ...job.qualifications].join("\n")),
  ]);
  const unsupported = new Set<string>();
  const sources = new Set<string>();
  const all = texts.map((t) => t.text).join("\n");

  for (const { text } of texts) {
    for (const sentence of sentences(text)) {
      for (const hit of findSkills(sentence)) {
        if (resumeSkills.has(hit.name)) {
          sources.add("Resume: Skills");
          continue;
        }
        if (jobSkills.has(hit.name) && LEARNING_FRAME.test(sentence)) {
          sources.add("Job posting: requirements");
          continue;
        }
        unsupported.add(`Mentions ${hit.name}, which is not on the resume`);
      }

      for (const m of sentence.matchAll(METRIC)) {
        if (!resumeText.includes(m[0].trim())) unsupported.add(`Unverified metric "${m[0].trim()}"`);
      }
      for (const m of sentence.matchAll(EMPLOYER_CLAIM)) {
        const org = m[1]!;
        const known = new RegExp(escapeRegex(org), "i").test(resumeText) || org.toLowerCase().startsWith(job.company.toLowerCase());
        if (!known && !LEARNING_FRAME.test(sentence)) unsupported.add(`Unverified employer "${org}"`);
      }
      for (const m of sentence.matchAll(DEGREE_CLAIM)) {
        const token = m[0].replace(/[.\s']/g, "").toLowerCase();
        const onResume = resumeText.replace(/[.\s']/g, "").toLowerCase().includes(token.replace(/s$/, ""));
        const inJob = [job.graduationRequirement ?? "", ...job.qualifications].join(" ").replace(/[.\s']/g, "").toLowerCase().includes(token.replace(/s$/, ""));
        if (!onResume && !inJob) unsupported.add(`Unverified degree "${m[0]}"`);
      }
    }
  }

  for (const p of resume.projects) if (all.includes(p.name)) sources.add(`Resume: Project — ${p.name}`);
  for (const e of resume.experience) if (e.title && all.toLowerCase().includes(e.title.toLowerCase())) sources.add(`Resume: Experience — ${e.title}`);
  for (const e of resume.education) if (e.institution && all.includes(e.institution)) sources.add("Resume: Education");
  if (all.includes(job.company) || all.includes(job.title)) sources.add(`Job posting: ${job.company} — ${job.title}`);

  const ordered = [...sources].sort((a, b) => (a.startsWith("Resume") === b.startsWith("Resume") ? 0 : a.startsWith("Resume") ? -1 : 1));
  return { verified: unsupported.size === 0, sourcesUsed: ordered, unsupportedClaims: [...unsupported] };
}
