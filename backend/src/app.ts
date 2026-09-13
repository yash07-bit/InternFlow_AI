import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import type { AgentEvent, AppSettings, Application } from "@internflow/shared";
import { APPLICATION_STATUSES } from "@internflow/shared";
import { AgentOrchestrator } from "./agents/orchestrator.js";
import { config } from "./config.js";
import type { Store } from "./db/types.js";
import { getProviders } from "./integrations/index.js";
import { integrationsRouter } from "./routes/integrations.js";
import type { LlmClient } from "./services/llm.js";
import { composeAnswers, composeCoverLetter, groundMaterials, nextVariant } from "./services/materials.js";
import { toolDescriptors } from "./tools/index.js";
import { HttpError, notFound } from "./utils/errors.js";
import { nowIso, newId } from "./utils/ids.js";

const StartRun = z
  .object({
    jobUrl: z.string().trim().url().refine((u) => /^https?:\/\//i.test(u), "Only http(s) URLs are supported").optional(),
    jobDescription: z.string().trim().min(40, "Job description is too short").max(20_000).optional(),
    options: z.object({ simulateFailures: z.array(z.enum(["gmail", "google_drive", "google_calendar", "notion", "web"])).optional() }).optional(),
  })
  .refine((b) => b.jobUrl || b.jobDescription, "Provide a jobUrl or jobDescription");

const Approve = z.object({
  actionIds: z.array(z.string()).optional(),
  edits: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
});

const Status = z.enum(APPLICATION_STATUSES as [string, ...string[]]);
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const CreateApplication = z.object({
  company: z.string().min(1).max(200),
  role: z.string().min(1).max(200),
  jobUrl: z.string().url().optional(),
  status: Status.optional(),
  matchScore: z.number().min(0).max(100).optional(),
  followUpDate: IsoDate.optional(),
  deadline: z.string().max(100).optional(),
  notes: z.string().max(5000).optional(),
});

const UpdateApplication = z.object({
  status: Status.optional(),
  followUpDate: IsoDate.nullable().optional(),
  deadline: z.string().max(100).nullable().optional(),
  applicationDate: IsoDate.nullable().optional(),
  notes: z.string().max(5000).optional(),
  coverLetter: z.string().max(20_000).optional(),
  answers: z.array(z.object({ id: z.string(), answer: z.string().max(10_000) })).optional(),
});

const parse = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const r = schema.safeParse(value);
  if (!r.success) throw new HttpError(400, "INVALID_INPUT", r.error.issues.map((i) => i.message).join("; "), r.error.issues);
  return r.data;
};

export function createApp(deps: { store: Store; llm?: LlmClient | null; orchestrator?: AgentOrchestrator }) {
  const { store } = deps;
  const orchestrator = deps.orchestrator ?? new AgentOrchestrator({ store, getProviders, llm: deps.llm });
  const user = () => store.users.getOrCreateDemoUser();

  const app = express();
  app.disable("x-powered-by");
  app.use(cors({ origin: config.appUrl }));
  app.use(express.json({ limit: "1mb" }));
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });
  app.use("/api", rateLimit({ windowMs: 60_000, limit: config.rateLimit.apiRequestsPerMinute, standardHeaders: true, legacyHeaders: false }));

  app.get("/api/health", (_req, res) => res.json({ ok: true, version: "1.0.0" }));

  // --- settings ---------------------------------------------------------------
  const settings = async (): Promise<AppSettings> => {
    const u = await user();
    const s = await store.settings.get(u.id);
    return {
      demoMode: s.demoMode,
      user: { id: u.id, name: u.name, email: u.email },
      llm: { provider: orchestrator.brainKind, model: orchestrator.brainKind === "anthropic" ? config.ai.model : "local-planner", configured: Boolean(deps.llm) },
      database: store.kind,
    };
  };
  app.get("/api/settings", async (_req, res) => res.json(await settings()));
  app.patch("/api/settings", async (req, res) => {
    const body = parse(z.object({ demoMode: z.boolean().optional() }), req.body);
    await store.settings.set((await user()).id, body);
    res.json(await settings());
  });

  // --- agent --------------------------------------------------------------------
  app.get("/api/agent/tools", (_req, res) => res.json(toolDescriptors()));

  const runLimiter = rateLimit({ windowMs: 60_000, limit: config.rateLimit.agentRunsPerMinute, standardHeaders: true, legacyHeaders: false });
  app.post("/api/agent/run", runLimiter, async (req, res) => {
    const body = parse(StartRun, req.body);
    const run = await orchestrator.start((await user()).id, body);
    res.status(202).json({ runId: run.id, run });
  });

  app.get("/api/agent/runs", async (_req, res) => res.json(await store.runs.list((await user()).id)));
  app.get("/api/agent/runs/:id", async (req, res) => {
    const run = await store.runs.get(req.params.id);
    if (!run) throw notFound("Run");
    res.json(run);
  });

  const stream = async (req: Request<{ id: string }>, res: Response) => {
    const run = await store.runs.get(req.params.id);
    if (!run) throw notFound("Run");
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    res.flushHeaders();
    const send = (e: AgentEvent) => res.write(`id: ${e.seq}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    const after = Number(req.query.after ?? req.header("last-event-id") ?? 0) || 0;

    const replay = orchestrator.events(run.id, after);
    if (!replay) {
      // Not in memory (server restarted): send the stored snapshot.
      send({ seq: 1, runId: run.id, at: nowIso(), type: "agent_started", run });
      return void res.end();
    }
    replay.forEach(send);
    const unsubscribe = orchestrator.subscribe(run.id, send);
    const ping = setInterval(() => res.write(": ping\n\n"), 15_000);
    req.on("close", () => {
      clearInterval(ping);
      unsubscribe?.();
    });
  };
  app.get("/api/agent/runs/:id/events", stream);
  app.get("/api/agent/runs/:id/stream", stream);

  app.post("/api/agent/approvals/:id/approve", async (req, res) => {
    res.json(await orchestrator.approve(req.params.id, parse(Approve, req.body ?? {}) as never));
  });
  app.post("/api/agent/approvals/:id/reject", async (req, res) => {
    res.json(await orchestrator.reject(req.params.id));
  });

  // --- applications -------------------------------------------------------------
  const getApp = async (id: string): Promise<Application> => {
    const a = await store.applications.get((await user()).id, id);
    if (!a) throw notFound("Application");
    return a;
  };

  app.get("/api/applications", async (_req, res) => res.json(await store.applications.list((await user()).id)));
  app.get("/api/applications/:id", async (req, res) => res.json(await getApp(req.params.id)));

  app.post("/api/applications", async (req, res) => {
    const body = parse(CreateApplication, req.body);
    const now = nowIso();
    const created = await store.applications.upsert({ id: newId("app"), userId: (await user()).id, status: "Preparing", ...body, createdAt: now, updatedAt: now } as Application);
    res.status(201).json(created);
  });

  app.patch("/api/applications/:id", async (req, res) => {
    const body = parse(UpdateApplication, req.body);
    const a = await getApp(req.params.id);
    const { coverLetter, answers, ...fields } = body;
    for (const [k, v] of Object.entries(fields)) (a as unknown as Record<string, unknown>)[k] = v === null ? undefined : v;
    if (a.materials && coverLetter !== undefined) a.materials.coverLetter = { content: coverLetter, edited: true, updatedAt: nowIso() };
    if (a.materials?.answers && answers) {
      a.materials.answers = a.materials.answers.map((x) => {
        const edit = answers.find((e) => e.id === x.id);
        return edit ? { ...x, answer: edit.answer, edited: true } : x;
      });
    }
    a.updatedAt = nowIso();
    res.json(await store.applications.upsert(a));
  });

  app.post("/api/applications/:id/materials/regenerate", async (req, res) => {
    const { kind } = parse(z.object({ kind: z.enum(["cover_letter", "answers"]) }), req.body);
    const a = await getApp(req.params.id);
    const run = a.latestRunId ? await store.runs.get(a.latestRunId) : null;
    const resume = run?.workflow.resume;
    if (!a.job || !resume) throw new HttpError(409, "MISSING_CONTEXT", "This application has no analyzed job and resume to generate from");
    const input = { job: a.job, resume, match: a.match, emailContext: a.emailContext };
    const materials = a.materials ?? { generatedWith: "template" as const, generatedAt: nowIso() };
    if (kind === "cover_letter") {
      const variant = nextVariant(materials.coverLetter?.content, (v) => composeCoverLetter({ ...input, variant: v }));
      materials.coverLetter = { content: composeCoverLetter({ ...input, variant }), edited: false, updatedAt: nowIso() };
    } else {
      const variant = nextVariant(materials.answers?.[0]?.answer, (v) => composeAnswers({ ...input, variant: v })[0]!.answer);
      materials.answers = composeAnswers({ ...input, variant });
    }
    materials.grounding = groundMaterials(input, materials.coverLetter?.content, materials.answers);
    materials.generatedAt = nowIso();
    a.materials = materials;
    a.updatedAt = nowIso();
    res.json(await store.applications.upsert(a));
  });

  // --- integrations ---------------------------------------------------------------
  app.use("/api/integrations", integrationsRouter());

  // There is intentionally no endpoint that executes tools directly.
  app.use("/api", (_req, res) => res.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found" } }));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) return void res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    if (err && typeof err === "object" && "type" in err && (err as { type: string }).type === "entity.parse.failed") {
      return void res.status(400).json({ error: { code: "INVALID_JSON", message: "Malformed JSON body" } });
    }
    console.error(err);
    res.status(500).json({ error: { code: "INTERNAL", message: "Something went wrong" } });
  });

  return { app, orchestrator };
}
