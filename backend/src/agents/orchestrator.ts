/**
 * AgentOrchestrator — runs the agent loop:
 *   brain.next(state) → execute tools (read/write auto, gated ones paused for approval) → observe → repeat.
 * Every change is persisted and streamed to the UI as an AgentEvent.
 */
import { EventEmitter } from "node:events";
import type {
  AgentEvent,
  AgentMessage,
  AgentRun,
  Approval,
  ApprovalAction,
  ApproveRequest,
  AppId,
  ProviderId,
  RunInput,
  ToolCallRecord,
  WorkflowStatus,
} from "@internflow/shared";
import { APP_LABELS, EXTERNAL_PROVIDERS } from "@internflow/shared";
import { config } from "../config.js";
import type { Store } from "../db/types.js";
import type { GetProviders, ProviderSet } from "../integrations/types.js";
import type { LlmClient } from "../services/llm.js";
import { TOOL_MAP, needsApproval, type ToolContext, type ToolDef } from "../tools/index.js";
import { sleep, withTimeout } from "../utils/async.js";
import { HttpError, ToolExecutionError, toToolError } from "../utils/errors.js";
import { newId, nowIso } from "../utils/ids.js";
import { createLogger } from "../utils/logger.js";
import { AnthropicBrain, LocalBrain, type Brain, type PlannedCall, type Step, type ToolResult } from "./brains.js";

const log = createLogger("agent");
const TOOL_TIMEOUT_MS = 30_000;

interface LiveRun {
  run: AgentRun;
  events: AgentEvent[];
  emitter: EventEmitter;
  brain: Brain;
  providers: ProviderSet;
  pending?: { approvalId: string; calls: PlannedCall[]; results: ToolResult[] };
}

type EventPayload = AgentEvent extends infer E ? (E extends AgentEvent ? Omit<E, "seq" | "runId" | "at"> : never) : never;

export interface OrchestratorDeps {
  store: Store;
  getProviders: GetProviders;
  llm?: LlmClient | null;
}

export class AgentOrchestrator {
  private live = new Map<string, LiveRun>();

  constructor(private readonly deps: OrchestratorDeps) {}

  get brainKind(): "anthropic" | "local" {
    return this.deps.llm ? "anthropic" : "local";
  }

  async start(userId: string, input: RunInput): Promise<AgentRun> {
    const { demoMode } = await this.deps.store.settings.get(userId);
    const providers = await this.deps.getProviders({ userId, demoMode, simulateFailures: input.options?.simulateFailures });
    const run: AgentRun = {
      id: newId("run"),
      userId,
      input,
      status: "IDLE",
      mode: demoMode ? "demo" : "live",
      llm: { provider: this.brainKind, model: this.deps.llm ? config.ai.model : "local-planner" },
      workflow: { approvals: [], status: "IDLE", securityFlags: [], warnings: [] },
      toolCalls: [],
      messages: [],
      startedAt: nowIso(),
    };
    const brain: Brain = this.deps.llm ? new AnthropicBrain(this.deps.llm) : new LocalBrain();
    const live: LiveRun = { run, events: [], emitter: new EventEmitter(), brain, providers };
    live.emitter.setMaxListeners(50);
    this.live.set(run.id, live);
    await this.deps.store.runs.save(run);
    this.emit(live, { type: "agent_started", run: structuredClone(run) });
    void this.loop(live);
    return run;
  }

  // --- events -----------------------------------------------------------------

  events(runId: string, after = 0): AgentEvent[] | undefined {
    return this.live.get(runId)?.events.filter((e) => e.seq > after);
  }

  subscribe(runId: string, listener: (e: AgentEvent) => void): (() => void) | undefined {
    const live = this.live.get(runId);
    if (!live) return undefined;
    live.emitter.on("event", listener);
    return () => live.emitter.off("event", listener);
  }

  private emit(live: LiveRun, payload: EventPayload) {
    const event = { ...payload, seq: live.events.length + 1, runId: live.run.id, at: nowIso() } as AgentEvent;
    live.events.push(event);
    live.emitter.emit("event", event);
  }

  private async save(live: LiveRun) {
    await this.deps.store.runs.save(live.run).catch((err) => log.error("failed to persist run", err));
  }

  private setStatus(live: LiveRun, status: WorkflowStatus) {
    if (live.run.status === status) return;
    live.run.status = status;
    live.run.workflow.status = status;
    this.emit(live, { type: "status_changed", status });
  }

  private message(live: LiveRun, kind: AgentMessage["kind"], text: string, using?: AgentMessage["using"]) {
    const message: AgentMessage = { id: newId("msg"), runId: live.run.id, kind, text, using, createdAt: nowIso() };
    live.run.messages.push(message);
    this.emit(live, { type: "agent_message", message });
  }

  private warn(live: LiveRun, text: string) {
    if (live.run.workflow.warnings.includes(text)) return;
    live.run.workflow.warnings.push(text);
    this.message(live, "warning", text);
  }

  // --- loop ---------------------------------------------------------------------

  private async loop(live: LiveRun) {
    try {
      for (let turn = 0; turn < config.ai.maxAgentTurns; turn++) {
        const step = await this.nextStep(live);
        const using = step.calls.flatMap((c) => {
          const t = TOOL_MAP.get(c.name as never);
          return t ? [{ app: t.app, label: t.label }] : [];
        });
        if (step.message) this.message(live, "decision", step.message, using.length ? using : undefined);
        if (step.fail) return await this.finish(live, "FAILED", step.fail);
        if (step.calls.length === 0) return await this.finish(live, "COMPLETED", step.final ?? "Workflow complete.");

        const results: ToolResult[] = [];
        const gated: PlannedCall[] = [];
        for (const c of step.calls) {
          const def = TOOL_MAP.get(c.name as never);
          if (def && needsApproval(def)) gated.push(c);
          else results.push(await this.execute(live, c));
        }
        if (gated.length) {
          const ok = this.requestApproval(live, gated, results);
          if (ok) return await this.save(live); // suspended until the user decides
        }
        live.brain.observe(results);
        await this.save(live);
      }
      await this.finish(live, "COMPLETED", "Stopped after reaching the maximum number of agent steps.");
    } catch (err) {
      log.error("run crashed", err);
      await this.finish(live, "FAILED", err instanceof Error ? err.message : "Unexpected agent error");
    }
  }

  private async nextStep(live: LiveRun): Promise<Step> {
    try {
      return await live.brain.next(live.run);
    } catch (err) {
      if (live.brain.kind !== "anthropic") throw err;
      log.warn("AI model unavailable, switching to local planner", err);
      this.message(live, "info", "AI model unavailable — continuing with the local planner.");
      live.brain = new LocalBrain();
      live.run.llm = { provider: "local", model: "local-planner" };
      return live.brain.next(live.run);
    }
  }

  private context(live: LiveRun): ToolContext {
    return {
      run: live.run,
      providers: live.providers,
      store: this.deps.store,
      timezone: config.userTimezone,
      llm: live.brain.kind === "anthropic" ? (this.deps.llm ?? null) : null,
      warn: (text) => this.warn(live, text),
    };
  }

  /** Validate + run one tool call with timeout and a single retry for transient failures. */
  private async execute(live: LiveRun, c: PlannedCall, existing?: ToolCallRecord): Promise<ToolResult> {
    const def = TOOL_MAP.get(c.name as never) as ToolDef | undefined;
    if (!def) {
      this.warn(live, `The agent requested an unknown tool "${c.name}" — rejected.`);
      return { id: c.id, name: c.name, ok: false, content: { error: `Unknown tool: ${c.name}` } };
    }
    const parsed = def.schema.safeParse(c.input);
    if (!parsed.success) return { id: c.id, name: c.name, ok: false, content: { error: `Invalid input: ${parsed.error.message}` } };

    if (def.status) this.setStatus(live, def.status);
    const record: ToolCallRecord = existing ?? {
      id: newId("tool"),
      runId: live.run.id,
      tool: def.name,
      app: def.app,
      label: def.label,
      riskLevel: def.riskLevel,
      status: "running",
      activity: def.activity(parsed.data),
      input: parsed.data as Record<string, unknown>,
      startedAt: nowIso(),
    };
    if (existing) Object.assign(record, { status: "running", input: parsed.data, startedAt: nowIso() });
    else live.run.toolCalls.push(record);
    this.emit(live, { type: "tool_started", toolCall: structuredClone(record) });

    const ctx = this.context(live);
    const warningsBefore = live.run.workflow.warnings.length;
    let attempt = 0;
    for (;;) {
      try {
        const out = await withTimeout(def.execute(parsed.data, ctx), TOOL_TIMEOUT_MS, () => new ToolExecutionError("TIMEOUT", `${def.label} timed out`, true));
        Object.assign(record, { status: "completed", summary: out.summary, detail: out.detail, completedAt: nowIso() });
        record.durationMs = Date.parse(record.completedAt!) - Date.parse(record.startedAt);
        this.emit(live, { type: "tool_completed", toolCall: structuredClone(record) });
        this.emit(live, { type: "workflow_updated", workflow: structuredClone(live.run.workflow) });
        await this.recordAction(live, record);
        return { id: c.id, name: c.name, ok: true, content: out.modelResult };
      } catch (err) {
        const error = toToolError(err);
        if (error.retryable && attempt++ < 1) {
          await sleep(300);
          continue;
        }
        Object.assign(record, { status: "failed", error, completedAt: nowIso() });
        record.durationMs = Date.parse(record.completedAt!) - Date.parse(record.startedAt);
        this.emit(live, { type: "tool_failed", toolCall: structuredClone(record) });
        const toolAlreadyWarned = live.run.workflow.warnings.length > warningsBefore;
        if (def.app !== "internflow" && def.name !== "analyze_job" && !toolAlreadyWarned) {
          this.warn(live, failureWarning(APP_LABELS[def.app], def.label, error));
        }
        this.emit(live, { type: "workflow_updated", workflow: structuredClone(live.run.workflow) });
        await this.recordAction(live, record);
        return { id: c.id, name: c.name, ok: false, content: { error: error.message, code: error.code } };
      }
    }
  }

  private recordAction(live: LiveRun, r: ToolCallRecord) {
    return this.deps.store.actions
      .record({ id: r.id, agentRunId: live.run.id, toolName: r.tool, actionType: r.riskLevel, status: r.status, resultSummary: r.summary ?? r.error?.message, createdAt: r.startedAt })
      .catch(() => undefined);
  }

  // --- approvals ----------------------------------------------------------------

  private requestApproval(live: LiveRun, calls: PlannedCall[], results: ToolResult[]): boolean {
    const approvalId = newId("apv");
    const actions: ApprovalAction[] = [];
    const accepted: PlannedCall[] = [];
    const w = live.run.workflow;
    for (const c of calls) {
      const def = TOOL_MAP.get(c.name as never)!;
      const parsed = def.schema.safeParse(c.input);
      if (!parsed.success) {
        results.push({ id: c.id, name: c.name, ok: false, content: { error: `Invalid input: ${parsed.error.message}` } });
        continue;
      }
      const record: ToolCallRecord = {
        id: newId("tool"),
        runId: live.run.id,
        tool: def.name,
        app: def.app,
        label: def.label,
        riskLevel: def.riskLevel,
        status: "awaiting_approval",
        activity: "Waiting for your approval",
        input: parsed.data as Record<string, unknown>,
        approvalId,
        startedAt: nowIso(),
      };
      live.run.toolCalls.push(record);
      this.emit(live, { type: "tool_started", toolCall: structuredClone(record) });

      let description = def.description;
      if (def.name === "create_gmail_draft") {
        const to = (parsed.data as { to: { email: string }[] }).to.map((t) => t.email);
        const known = [w.emailContext?.recruiter?.email, w.job?.contactEmail, ...(w.emailContext?.messages ?? []).map((m) => m.from.email)].filter(Boolean);
        description = `Save a follow-up email draft to ${to.join(", ")} in Gmail. Nothing is sent.`;
        if (to.some((e) => !known.includes(e))) description += " ⚠ This recipient was not found in your emails or the job posting — double-check it.";
      } else if (def.name === "create_calendar_event") {
        description = "Add a follow-up reminder to your Google Calendar.";
      }
      actions.push({
        id: newId("act"),
        toolCallId: record.id,
        tool: def.name,
        app: def.app,
        riskLevel: def.riskLevel,
        type: def.approvalType ?? "SEND_EMAIL",
        title: def.name === "create_gmail_draft" ? "Create Gmail follow-up draft" : def.name === "create_calendar_event" ? "Schedule calendar reminder" : def.label,
        description,
        payload: parsed.data as Record<string, unknown>,
        status: "pending",
      });
      accepted.push({ ...c, id: c.id, input: { ...parsed.data, __toolCallId: record.id } });
    }
    if (!actions.length) return false;

    const approval: Approval = { id: approvalId, runId: live.run.id, status: "pending", actions, createdAt: nowIso() };
    w.approvals.push(approval);
    live.pending = { approvalId, calls: accepted, results };
    this.setStatus(live, "WAITING_FOR_APPROVAL");
    this.emit(live, { type: "approval_required", approval: structuredClone(approval) });
    this.emit(live, { type: "workflow_updated", workflow: structuredClone(w) });
    return true;
  }

  private findPending(approvalId: string): { live: LiveRun; approval: Approval } {
    for (const live of this.live.values()) {
      const approval = live.run.workflow.approvals.find((a) => a.id === approvalId);
      if (!approval) continue;
      if (approval.status !== "pending" || live.pending?.approvalId !== approvalId) throw new HttpError(409, "ALREADY_RESOLVED", "This approval was already resolved");
      return { live, approval };
    }
    throw new HttpError(404, "NOT_FOUND", "Approval not found (it may have expired after a server restart)");
  }

  async approve(approvalId: string, req: ApproveRequest): Promise<{ approval: Approval; run: AgentRun }> {
    return this.resolve(approvalId, req.actionIds, req.edits ?? {});
  }

  async reject(approvalId: string): Promise<{ approval: Approval; run: AgentRun }> {
    return this.resolve(approvalId, [], {});
  }

  private async resolve(approvalId: string, actionIds: string[] | undefined, edits: NonNullable<ApproveRequest["edits"]>) {
    const { live, approval } = this.findPending(approvalId);
    const pending = live.pending!;
    live.pending = undefined;

    const results = [...pending.results];
    for (const action of approval.actions) {
      const planned = pending.calls.find((c) => c.input.__toolCallId === action.toolCallId)!;
      const record = live.run.toolCalls.find((t) => t.id === action.toolCallId)!;
      const approved = !actionIds || actionIds.includes(action.id);
      if (!approved) {
        action.status = "rejected";
        Object.assign(record, { status: "rejected", error: { code: "REJECTED", message: "Declined by user", retryable: false }, completedAt: nowIso() });
        this.emit(live, { type: "tool_failed", toolCall: structuredClone(record) });
        results.push({ id: planned.id, name: planned.name, ok: false, content: { error: "User declined this action" } });
        continue;
      }
      action.status = "approved";
      const { __toolCallId: _ignored, ...input } = planned.input;
      action.payload = { ...input, ...(edits[action.id] ?? {}) };
      const result = await this.execute(live, { ...planned, input: action.payload as Record<string, unknown> }, record);
      action.status = result.ok ? "executed" : "failed";
      action.result = record.summary ?? record.error?.message;
      results.push(result);
    }
    const approvedCount = approval.actions.filter((a) => a.status === "executed" || a.status === "failed").length;
    approval.status = approvedCount === 0 ? "rejected" : approvedCount === approval.actions.length ? "approved" : "partially_approved";
    approval.resolvedAt = nowIso();
    this.emit(live, { type: "approval_resolved", approval: structuredClone(approval) });
    this.emit(live, { type: "workflow_updated", workflow: structuredClone(live.run.workflow) });
    live.brain.observe(results);
    await this.save(live);
    void this.loop(live);
    return { approval: structuredClone(approval), run: structuredClone(live.run) };
  }

  // --- completion ---------------------------------------------------------------

  private async finish(live: LiveRun, status: "COMPLETED" | "FAILED", text: string) {
    const run = live.run;
    this.message(live, status === "COMPLETED" ? "final" : "warning", text);
    run.completedAt = nowIso();
    const completed = run.toolCalls.filter((t) => t.status === "completed");
    const apps = new Set(completed.map((t) => t.app as AppId));
    const w = run.workflow;
    const keySteps = [w.job, w.resume, w.match, w.emailContext, w.generatedMaterials, w.trackerRecord, w.calendarRecommendation];
    const completion = keySteps.filter(Boolean).length / keySteps.length;
    run.stats = {
      appsCoordinated: EXTERNAL_PROVIDERS.filter((p): p is ProviderId => apps.has(p)),
      toolCalls: run.toolCalls.length,
      agentActions: completed.length,
      approvals: w.approvals.filter((a) => a.status !== "pending").length,
      failures: run.toolCalls.filter((t) => t.status === "failed").length,
      durationMs: Date.parse(run.completedAt) - Date.parse(run.startedAt),
      readiness: Math.round((w.match?.score ?? 40) * completion),
    };
    if (status === "FAILED") run.error = text;
    this.setStatus(live, status);
    this.emit(live, { type: "workflow_updated", workflow: structuredClone(w) });
    await this.save(live);
    if (status === "COMPLETED") this.emit(live, { type: "agent_completed", run: structuredClone(run) });
    else this.emit(live, { type: "agent_failed", run: structuredClone(run), error: text });
  }
}

function failureWarning(app: string, step: string, error: { code: string; message: string }): string {
  const message = error.message.replace(/\s*\(simulated outage\)/, "").replace(/\.*$/, ".");
  if (error.code === "NOT_CONNECTED") return `${message} Skipped ${step.toLowerCase()}; the rest of the workflow continues.`;
  const reason = /unavailable/i.test(message) ? message : `${app} error: ${message}`;
  return `${reason} The rest of the application workflow continues — ${step.toLowerCase()} can be retried later.`;
}
