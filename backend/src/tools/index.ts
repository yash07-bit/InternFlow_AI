/**
 * Tool registry. Every external app is exposed to the agent as tools with a risk level.
 * Tools mutate the run's workflow state and return a compact `modelResult` for the brain.
 */
import { z } from "zod";
import type {
  AgentRun,
  AppId,
  Application,
  ApprovalActionType,
  RiskLevel,
  ToolDescriptor,
  ToolName,
  WorkflowStatus,
} from "@internflow/shared";
import type { Store } from "../db/types.js";
import type { ProviderSet } from "../integrations/types.js";
import { recommendFollowUpSlot } from "../services/calendar.js";
import { buildEmailContext } from "../services/emailContext.js";
import { detectInjection, stripInjectedSegments, toSecurityFlags } from "../services/injection.js";
import { parseJobText, summarizeJob } from "../services/jobParser.js";
import type { LlmClient } from "../services/llm.js";
import { matchResume } from "../services/matcher.js";
import { composeAnswers, composeCoverLetter, generateMaterialsWithLlm, groundMaterials } from "../services/materials.js";
import { parseResumeText, pickBestResume } from "../services/resumeParser.js";
import { ToolExecutionError } from "../utils/errors.js";
import { newId, nowIso } from "../utils/ids.js";

export interface ToolContext {
  run: AgentRun;
  providers: ProviderSet;
  store: Store;
  timezone: string;
  llm: LlmClient | null;
  warn: (text: string) => void;
}

export interface ToolOutput {
  summary: string;
  detail?: unknown;
  modelResult: unknown;
}

export interface ToolDef<I = any> {
  name: ToolName;
  app: AppId;
  label: string;
  description: string;
  schema: z.ZodType<I>;
  riskLevel: RiskLevel;
  requiresApproval: boolean;
  status?: WorkflowStatus;
  approvalType?: ApprovalActionType;
  activity: (input: I) => string;
  execute: (input: I, ctx: ToolContext) => Promise<ToolOutput>;
}

const tool = <I>(def: ToolDef<I>) => def;

const need = <T>(value: T | undefined, message: string): T => {
  if (value === undefined) throw new ToolExecutionError("INVALID_INPUT", message);
  return value;
};

async function saveApplication(ctx: ToolContext, patch: Partial<Application>): Promise<Application> {
  const w = ctx.run.workflow;
  const job = need(w.job, "Analyze the job first");
  const now = nowIso();
  const existing = ctx.run.applicationId ? await ctx.store.applications.get(ctx.run.userId, ctx.run.applicationId) : null;
  const app: Application = {
    id: existing?.id ?? newId("app"),
    userId: ctx.run.userId,
    createdAt: existing?.createdAt ?? now,
    status: "Preparing",
    ...existing,
    company: job.company,
    role: job.title,
    jobUrl: job.url,
    location: job.location,
    deadline: job.deadline,
    matchScore: w.match?.score,
    job,
    match: w.match,
    materials: w.generatedMaterials,
    emailContext: w.emailContext,
    tracker: w.trackerRecord,
    latestRunId: ctx.run.id,
    ...patch,
    updatedAt: now,
  };
  ctx.run.applicationId = app.id;
  return ctx.store.applications.upsert(app);
}

export const TOOLS: ToolDef[] = [
  tool({
    name: "analyze_job",
    app: "web",
    label: "Job Extraction",
    description: "Fetch and analyze an internship/job posting (URL or pasted text). Returns structured job requirements.",
    schema: z.object({ url: z.string().url().optional(), text: z.string().max(20_000).optional() }),
    riskLevel: "read",
    requiresApproval: false,
    status: "ANALYZING_JOB",
    activity: (i) => (i.url ? `Reading ${new URL(i.url).hostname}…` : "Reading the pasted job description…"),
    async execute(input, ctx) {
      const url = input.url ?? ctx.run.input.jobUrl;
      const pasted = input.text ?? ctx.run.input.jobDescription;
      let text: string;
      let hidden = "";
      let title: string | undefined;
      if (url) {
        if (!/^https?:\/\//i.test(url)) throw new ToolExecutionError("INVALID_INPUT", "Only http(s) job URLs are supported");
        const page = await ctx.providers.web.fetchPage(url);
        text = page.text;
        hidden = page.hiddenText;
        title = page.title;
      } else {
        text = need(pasted, "Provide a job URL or description");
      }

      // External content is untrusted: flag instruction-like text and strip it before parsing.
      const flags = [...toSecurityFlags(detectInjection(text), "web", false), ...toSecurityFlags(detectInjection(hidden), "web", true)];
      if (flags.length) {
        ctx.run.workflow.securityFlags.push(...flags);
        ctx.warn("This job page contains hidden instructions aimed at AI assistants. I treated them as untrusted data and ignored them.");
      }
      const job = parseJobText({ text: stripInjectedSegments(text), pageTitle: title, url, source: url ? "url" : "text" });
      if (!job.title || !job.company) throw new ToolExecutionError("NOT_FOUND", "Couldn't find a job title and company in that posting");
      ctx.run.workflow.job = job;
      return {
        summary: `${job.company} — ${job.title}`,
        detail: job,
        modelResult: { job, securityFlags: flags.length ? `${flags.length} untrusted instruction(s) ignored` : undefined },
      };
    },
  }),

  tool({
    name: "search_drive",
    app: "google_drive",
    label: "Resume Search",
    description: "Search the user's Google Drive for files such as their resume.",
    schema: z.object({ query: z.string().min(1).max(200) }),
    riskLevel: "read",
    requiresApproval: false,
    status: "FINDING_RESUME",
    activity: (i) => `Searching Drive for "${i.query}"…`,
    async execute(input, ctx) {
      const files = await ctx.providers.drive.searchFiles(input.query, { limit: 10 });
      if (/resume|cv/i.test(input.query) && !pickBestResume(files)) {
        ctx.warn("No resume found in Google Drive — continuing without a match score or tailored materials.");
      }
      return {
        summary: files.length ? `Found ${files.length} file${files.length === 1 ? "" : "s"} — newest: ${files[0]!.name}` : "No matching files found",
        detail: { files },
        modelResult: files.map((f) => ({ id: f.id, name: f.name, modifiedTime: f.modifiedTime })),
      };
    },
  }),

  tool({
    name: "get_resume",
    app: "google_drive",
    label: "Resume Retrieval",
    description: "Read a resume file from Google Drive and parse it into structured candidate data.",
    schema: z.object({ fileId: z.string().min(1) }),
    riskLevel: "read",
    requiresApproval: false,
    status: "FINDING_RESUME",
    activity: () => "Retrieving and parsing resume…",
    async execute(input, ctx) {
      const { file, text } = await ctx.providers.drive.getFileText(input.fileId);
      const resume = parseResumeText({ text, fileName: file.name, fileId: file.id, source: "google_drive", modifiedAt: file.modifiedTime });
      ctx.run.workflow.resume = resume;
      const { rawText: _raw, ...facts } = resume;
      return {
        summary: `Retrieved ${file.name}`,
        detail: { file, skills: resume.skills, projects: resume.projects.map((p) => p.name), education: resume.education },
        modelResult: facts,
      };
    },
  }),

  tool({
    name: "match_resume",
    app: "internflow",
    label: "Resume Match",
    description: "Compare the retrieved resume against the analyzed job. Deterministic, evidence-based match score.",
    schema: z.object({}),
    riskLevel: "read",
    requiresApproval: false,
    status: "MATCHING_RESUME",
    activity: () => "Matching resume against requirements…",
    async execute(_input, ctx) {
      const w = ctx.run.workflow;
      const match = matchResume(need(w.job, "Analyze the job first"), need(w.resume, "Retrieve the resume first"));
      w.match = match;
      return { summary: `${match.score}% match`, detail: match, modelResult: match };
    },
  }),

  tool({
    name: "search_gmail",
    app: "gmail",
    label: "Email Search",
    description: "Search Gmail for previous communication with a company (recruiters, application threads).",
    schema: z.object({ query: z.string().min(1).max(300) }),
    riskLevel: "read",
    requiresApproval: false,
    status: "SEARCHING_EMAIL",
    activity: (i) => `Searching Gmail for ${i.query}…`,
    async execute(input, ctx) {
      const w = ctx.run.workflow;
      const messages = await ctx.providers.gmail.searchEmails(input.query, { limit: 10 });
      const context = buildEmailContext({
        query: input.query,
        company: w.job?.company ?? input.query.replace(/"/g, ""),
        userEmail: w.resume?.candidate.email,
        jobUrl: w.job?.url,
        messages,
      });
      w.emailContext = context;
      return { summary: context.summary, detail: context, modelResult: context };
    },
  }),

  tool({
    name: "generate_cover_letter",
    app: "internflow",
    label: "Cover Letter",
    description: "Write a cover letter tailored to the job using ONLY facts from the resume.",
    schema: z.object({ tone: z.string().max(60).optional() }),
    riskLevel: "read",
    requiresApproval: false,
    status: "GENERATING_MATERIAL",
    activity: () => "Writing a grounded cover letter…",
    async execute(input, ctx) {
      const w = ctx.run.workflow;
      const materialsInput = { job: need(w.job, "Analyze the job first"), resume: need(w.resume, "Retrieve the resume first"), match: w.match, emailContext: w.emailContext, tone: input.tone };
      const llm = ctx.llm ? await generateMaterialsWithLlm(ctx.llm, materialsInput, { kinds: ["cover_letter"] }) : null;
      const content = llm?.coverLetter ?? composeCoverLetter(materialsInput);
      const prev = w.generatedMaterials;
      const grounding = groundMaterials(materialsInput, content, prev?.answers);
      w.generatedMaterials = {
        ...prev,
        coverLetter: { content, edited: false, updatedAt: nowIso() },
        grounding,
        generatedWith: llm?.coverLetter ? "llm" : "template",
        generatedAt: nowIso(),
      };
      return {
        summary: grounding.verified ? "Cover letter drafted · all claims grounded in resume" : "Cover letter drafted · review flagged claims",
        detail: { coverLetter: content, grounding },
        modelResult: { words: content.split(/\s+/).length, grounding },
      };
    },
  }),

  tool({
    name: "generate_application_answers",
    app: "internflow",
    label: "Application Answers",
    description: "Draft answers to common application questions using ONLY resume and job facts.",
    schema: z.object({ questions: z.array(z.string().max(300)).max(6).optional() }),
    riskLevel: "read",
    requiresApproval: false,
    status: "GENERATING_MATERIAL",
    activity: () => "Drafting application answers…",
    async execute(input, ctx) {
      const w = ctx.run.workflow;
      const materialsInput = { job: need(w.job, "Analyze the job first"), resume: need(w.resume, "Retrieve the resume first"), match: w.match, emailContext: w.emailContext };
      const llm = ctx.llm ? await generateMaterialsWithLlm(ctx.llm, materialsInput, { kinds: ["answers"], questions: input.questions }) : null;
      const answers = llm?.answers ?? composeAnswers(materialsInput, input.questions);
      const prev = w.generatedMaterials;
      const grounding = groundMaterials(materialsInput, prev?.coverLetter?.content, answers);
      w.generatedMaterials = { ...prev, answers, grounding, generatedWith: prev?.generatedWith ?? (llm ? "llm" : "template"), generatedAt: nowIso() };
      return { summary: `${answers.length} answers drafted`, detail: { answers, grounding }, modelResult: { questions: answers.map((a) => a.question), grounding } };
    },
  }),

  tool({
    name: "search_notion",
    app: "notion",
    label: "Tracker Lookup",
    description: "Look for an existing application record in the Notion tracker (avoids duplicates).",
    schema: z.object({ company: z.string().min(1), role: z.string().optional(), jobUrl: z.string().optional() }),
    riskLevel: "read",
    requiresApproval: false,
    status: "UPDATING_TRACKER",
    activity: (i) => `Checking Notion tracker for ${i.company}…`,
    async execute(input, ctx) {
      const records = await ctx.providers.notion.findApplications(input);
      if (records[0]) ctx.run.workflow.trackerRecord = records[0];
      return {
        summary: records.length ? `Existing record found (${records[0]!.status})` : "No existing record — a new one is needed",
        detail: { records },
        modelResult: records,
      };
    },
  }),

  tool({
    name: "create_application_record",
    app: "notion",
    label: "Create Tracker Record",
    description: "Create (or refresh) the application record in the Notion tracker with match score, requirements and notes.",
    schema: z.object({ status: z.enum(["Preparing", "Ready to apply", "Applied"]).optional(), notes: z.string().max(1500).optional() }),
    riskLevel: "write",
    requiresApproval: false,
    status: "UPDATING_TRACKER",
    activity: () => "Creating application in Notion…",
    async execute(input, ctx) {
      const w = ctx.run.workflow;
      const job = need(w.job, "Analyze the job first");
      const notes = input.notes ?? (w.resume ? `Match ${w.match?.score ?? "–"}%. Gaps: ${w.match?.gaps.join(", ") || "none"}.` : "Resume not found — add a resume to compute a match.");
      const fields = {
        company: job.company,
        role: job.title,
        jobUrl: job.url,
        status: input.status ?? ("Preparing" as const),
        matchScore: w.match?.score,
        deadline: job.deadline,
        requirements: [...job.requirements, ...job.preferred],
        notes,
      };
      try {
        w.trackerRecord = w.trackerRecord
          ? await ctx.providers.notion.updateApplication(w.trackerRecord.externalId, fields)
          : await ctx.providers.notion.createApplication(fields);
      } catch (err) {
        ctx.warn("Notion is unavailable — the application was saved locally and can be synced later.");
        await saveApplication(ctx, { status: fields.status, notes });
        throw err;
      }
      const app = await saveApplication(ctx, { status: fields.status, notes });
      return { summary: `Application added — ${job.company} · ${fields.status}`, detail: w.trackerRecord, modelResult: { applicationId: app.id, record: w.trackerRecord } };
    },
  }),

  tool({
    name: "update_application_record",
    app: "notion",
    label: "Update Tracker Record",
    description: "Update the application record (follow-up date, status, notes).",
    schema: z.object({
      followUpDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      status: z.enum(["Preparing", "Ready to apply", "Applied"]).optional(),
      notes: z.string().max(1500).optional(),
    }),
    riskLevel: "write",
    requiresApproval: false,
    status: "UPDATING_TRACKER",
    activity: () => "Updating Notion tracker…",
    async execute(input, ctx) {
      const w = ctx.run.workflow;
      const patch = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
      if (w.trackerRecord) w.trackerRecord = await ctx.providers.notion.updateApplication(w.trackerRecord.externalId, patch);
      await saveApplication(ctx, patch);
      const parts = [input.status, input.followUpDate && `follow-up ${input.followUpDate}`].filter(Boolean);
      return { summary: `Tracker updated${parts.length ? ` — ${parts.join(", ")}` : ""}`, detail: w.trackerRecord, modelResult: w.trackerRecord ?? patch };
    },
  }),

  tool({
    name: "check_calendar",
    app: "google_calendar",
    label: "Availability Check",
    description: "Read the user's calendar for the next weeks and recommend a follow-up slot about one week out.",
    schema: z.object({ daysAhead: z.number().int().min(1).max(30).optional() }),
    riskLevel: "read",
    requiresApproval: false,
    status: "CHECKING_CALENDAR",
    activity: () => "Checking upcoming availability…",
    async execute(input, ctx) {
      const now = new Date();
      const days = input.daysAhead ?? 21;
      const [events, tz] = await Promise.all([
        ctx.providers.calendar.listEvents({ start: now.toISOString(), end: new Date(now.getTime() + days * 86_400_000).toISOString() }),
        ctx.providers.calendar.getTimezone().catch(() => ctx.timezone),
      ]);
      const rec = recommendFollowUpSlot(events, { timezone: tz, now });
      if (!rec) throw new ToolExecutionError("NOT_FOUND", "No free follow-up slot found in the next weeks");
      ctx.run.workflow.calendarRecommendation = rec;
      const label = new Date(rec.slot.start).toLocaleString("en-US", { timeZone: rec.timezone, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
      return { summary: `Recommended follow-up: ${label}`, detail: { recommendation: rec, eventsConsidered: events.length }, modelResult: rec };
    },
  }),

  tool({
    name: "create_calendar_event",
    app: "google_calendar",
    label: "Schedule Reminder",
    description: "Create a follow-up reminder event on the user's calendar. Requires user approval.",
    schema: z.object({ title: z.string().min(1).max(200), start: z.string().datetime({ offset: true }), end: z.string().datetime({ offset: true }), description: z.string().max(2000).optional() }),
    riskLevel: "write",
    requiresApproval: true,
    approvalType: "CREATE_CALENDAR_EVENT",
    status: "CHECKING_CALENDAR",
    activity: (i) => `Scheduling "${i.title}"…`,
    async execute(input, ctx) {
      const event = await ctx.providers.calendar.createEvent(input);
      ctx.run.workflow.calendarEvent = event;
      return { summary: `Reminder scheduled — ${event.title}`, detail: event, modelResult: event };
    },
  }),

  tool({
    name: "create_gmail_draft",
    app: "gmail",
    label: "Follow-up Draft",
    description: "Create a Gmail DRAFT (never sends) following up with the recruiter. Requires user approval.",
    schema: z.object({
      to: z.array(z.object({ name: z.string().optional(), email: z.string().email() })).min(1).max(5),
      subject: z.string().min(1).max(200),
      body: z.string().min(1).max(10_000),
    }),
    riskLevel: "write",
    requiresApproval: true,
    approvalType: "CREATE_GMAIL_DRAFT",
    activity: (i) => `Creating draft to ${i.to.map((t) => t.email).join(", ")}…`,
    async execute(input, ctx) {
      const draft = await ctx.providers.gmail.createDraft(input);
      ctx.run.workflow.followUpDraft = draft;
      return { summary: `Draft saved in Gmail — "${draft.subject}"`, detail: draft, modelResult: { id: draft.id, subject: draft.subject } };
    },
  }),
];

export const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));

export const toolDescriptors = (): ToolDescriptor[] =>
  TOOLS.map(({ name, app, label, description, riskLevel, requiresApproval }) => ({ name, app, label, description, riskLevel, requiresApproval }));

/** The orchestrator's policy: dangerous tools always need approval, whatever the tool says. */
export const needsApproval = (t: Pick<ToolDef, "riskLevel" | "requiresApproval">) => t.riskLevel === "dangerous" || t.requiresApproval;

export { summarizeJob };
