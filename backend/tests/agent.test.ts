import os from "node:os";
import path from "node:path";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import type { AgentRun } from "@internflow/shared";
import { DEMO_JOB_URL } from "@internflow/shared";
import { AgentOrchestrator } from "../src/agents/orchestrator.js";
import { createApp } from "../src/app.js";
import { JsonFileStore } from "../src/db/index.js";
import type { Store } from "../src/db/types.js";
import { createMockProviders, resetMockState } from "../src/integrations/mock/index.js";
import { getProviders } from "../src/integrations/index.js";
import type { GetProviders, ProviderSet } from "../src/integrations/types.js";
import type { LlmClient } from "../src/services/llm.js";
import { needsApproval } from "../src/tools/index.js";

let store: Store;
let seq = 0;

beforeEach(async () => {
  resetMockState();
  store = new JsonFileStore(path.join(os.tmpdir(), `internflow-agent-${process.pid}-${++seq}`));
  await store.init();
});

const withProviders = (patch: (p: ProviderSet) => void): GetProviders => async (ctx) => {
  const p = ctx.simulateFailures?.length ? await getProviders(ctx) : createMockProviders(ctx.userId);
  patch(p);
  return p;
};

async function waitFor(orch: AgentOrchestrator, runId: string, statuses: AgentRun["status"][]): Promise<AgentRun> {
  for (let i = 0; i < 200; i++) {
    const run = await store.runs.get(runId);
    if (run && statuses.includes(run.status)) return run;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`run never reached ${statuses.join("/")}: ${(await store.runs.get(runId))?.status}`);
}

async function startDemo(orch: AgentOrchestrator, input: Parameters<AgentOrchestrator["start"]>[1] = { jobUrl: DEMO_JOB_URL }) {
  const user = await store.users.getOrCreateDemoUser();
  const run = await orch.start(user.id, input);
  return waitFor(orch, run.id, ["WAITING_FOR_APPROVAL", "COMPLETED", "FAILED"]);
}

describe("agent workflow (local planner, demo providers)", () => {
  it("chooses the right tools, pauses for approval, then completes", async () => {
    const orch = new AgentOrchestrator({ store, getProviders });
    const paused = await startDemo(orch);

    expect(paused.status).toBe("WAITING_FOR_APPROVAL");
    expect(paused.toolCalls.filter((t) => t.status === "completed").map((t) => t.tool)).toEqual([
      "analyze_job", "search_drive", "get_resume", "match_resume", "search_gmail",
      "generate_cover_letter", "generate_application_answers", "search_notion", "create_application_record", "check_calendar",
    ]);
    expect(paused.workflow.match?.score).toBe(86);
    expect(paused.workflow.emailContext?.found).toBe(true);
    expect(paused.workflow.followUpDraft).toBeUndefined(); // nothing written before approval
    expect(paused.workflow.calendarEvent).toBeUndefined();
    const approval = paused.workflow.approvals[0]!;
    expect(approval.actions.map((a) => a.type).sort()).toEqual(["CREATE_CALENDAR_EVENT", "CREATE_GMAIL_DRAFT"]);

    await orch.approve(approval.id, {});
    const done = await waitFor(orch, paused.id, ["COMPLETED", "FAILED"]);
    expect(done.status).toBe("COMPLETED");
    expect(done.workflow.followUpDraft?.to[0]?.email).toBe("recruiter@example.com");
    expect(done.workflow.calendarEvent).toBeDefined();
    expect(done.stats?.appsCoordinated).toHaveLength(5);
    const app = await store.applications.get(done.userId, done.applicationId!);
    expect(app?.followUpDate).toBe(done.workflow.calendarEvent!.start.slice(0, 10));
    expect(app?.status).toBe("Ready to apply");
  });

  it("flags and ignores the prompt injection hidden in the job page", async () => {
    const orch = new AgentOrchestrator({ store, getProviders });
    const run = await startDemo(orch);
    expect(run.workflow.securityFlags.length).toBeGreaterThan(0);
    const recipients = run.workflow.approvals.flatMap((a) => a.actions).flatMap((a) => JSON.stringify(a.payload));
    expect(recipients.join()).not.toContain("talent-archive@example.net");
    expect(JSON.stringify(run.workflow.job)).not.toMatch(/ignore all previous instructions/i);
  });

  it("does nothing when the user rejects the approval", async () => {
    const orch = new AgentOrchestrator({ store, getProviders });
    const paused = await startDemo(orch);
    await orch.reject(paused.workflow.approvals[0]!.id);
    const done = await waitFor(orch, paused.id, ["COMPLETED"]);
    expect(done.workflow.followUpDraft).toBeUndefined();
    expect(done.workflow.calendarEvent).toBeUndefined();
    expect(done.toolCalls.filter((t) => t.status === "rejected")).toHaveLength(2);
  });

  it("recovers when Google Calendar fails", async () => {
    const orch = new AgentOrchestrator({ store, getProviders });
    const paused = await startDemo(orch, { jobUrl: DEMO_JOB_URL, options: { simulateFailures: ["google_calendar"] } });
    expect(paused.toolCalls.find((t) => t.tool === "check_calendar")?.status).toBe("failed");
    expect(paused.workflow.warnings.join()).toMatch(/Google Calendar/);
    expect(paused.workflow.approvals[0]!.actions.map((a) => a.type)).toEqual(["CREATE_GMAIL_DRAFT"]);
    await orch.approve(paused.workflow.approvals[0]!.id, {});
    expect((await waitFor(orch, paused.id, ["COMPLETED"])).status).toBe("COMPLETED");
  });

  it("handles a missing resume", async () => {
    const orch = new AgentOrchestrator({ store, getProviders: withProviders((p) => (p.drive.searchFiles = async () => [])) });
    const run = await startDemo(orch);
    expect(run.workflow.resume).toBeUndefined();
    expect(run.workflow.match).toBeUndefined();
    expect(run.workflow.warnings.join()).toMatch(/No resume found/);
    expect(run.toolCalls.some((t) => t.tool === "create_application_record" && t.status === "completed")).toBe(true);
  });

  it("handles no Gmail history by drafting to the posting's contact", async () => {
    const orch = new AgentOrchestrator({ store, getProviders: withProviders((p) => (p.gmail.searchEmails = async () => [])) });
    const run = await startDemo(orch);
    expect(run.workflow.emailContext?.found).toBe(false);
    expect(run.messages.some((m) => /no previous communication/i.test(m.text))).toBe(true);
    const draft = run.workflow.approvals[0]!.actions.find((a) => a.type === "CREATE_GMAIL_DRAFT");
    expect(JSON.stringify(draft?.payload)).toContain("recruiter@example.com");
  });
});

describe("Claude brain (scripted client)", () => {
  it("runs model-chosen tools, rejects unknown tools and still enforces approval", async () => {
    const requests: any[] = [];
    const turns = [
      [{ type: "text", text: "Reading the posting." }, { type: "tool_use", id: "t1", name: "analyze_job", input: { url: DEMO_JOB_URL } }],
      [
        { type: "tool_use", id: "t2", name: "send_all_emails", input: {} },
        { type: "tool_use", id: "t3", name: "create_calendar_event", input: { title: "Follow up", start: "2030-01-01T10:00:00Z", end: "2030-01-01T10:30:00Z" } },
      ],
      [{ type: "text", text: "Done." }],
    ];
    const client = {
      beta: {
        messages: {
          create: async (req: any) => {
            requests.push(structuredClone(req));
            const content = turns.shift()!;
            return { content, stop_reason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn" };
          },
        },
      },
    } as unknown as LlmClient;

    const orch = new AgentOrchestrator({ store, getProviders, llm: client });
    const paused = await startDemo(orch);
    expect(paused.status).toBe("WAITING_FOR_APPROVAL");
    expect(paused.workflow.job?.company).toBe("Example AI");
    expect(paused.workflow.warnings.join()).toMatch(/unknown tool "send_all_emails"/);
    expect(paused.workflow.calendarEvent).toBeUndefined();

    await orch.approve(paused.workflow.approvals[0]!.id, {});
    const done = await waitFor(orch, paused.id, ["COMPLETED"]);
    expect(done.workflow.calendarEvent?.title).toBe("Follow up");
    // Both results of the second assistant turn were returned together in one user message.
    const lastUser = requests[2].messages.at(-1);
    expect(lastUser.content.map((b: any) => b.tool_use_id).sort()).toEqual(["t2", "t3"]);
    expect(done.messages.at(-1)?.text).toBe("Done.");
  });
});

describe("security & API", () => {
  it("always requires approval for dangerous tools", () => {
    expect(needsApproval({ riskLevel: "dangerous", requiresApproval: false })).toBe(true);
    expect(needsApproval({ riskLevel: "read", requiresApproval: false })).toBe(false);
  });

  it("validates input and exposes no tool-execution endpoint", async () => {
    const { app } = createApp({ store });
    await request(app).post("/api/agent/run").send({ jobUrl: "ftp://example.com" }).expect(400);
    await request(app).post("/api/agent/run").send({}).expect(400);
    await request(app).post("/api/agent/tools/search_gmail").send({}).expect(404);
    await request(app).post("/api/agent/approvals/apv_missing/approve").send({}).expect(404);
    const res = await request(app).post("/api/agent/run").send({ jobUrl: DEMO_JOB_URL }).expect(202);
    expect(res.body.runId).toMatch(/^run_/);
  });
});
