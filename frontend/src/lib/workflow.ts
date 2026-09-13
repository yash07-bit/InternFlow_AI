import type { AgentMessage, AgentRun, AppId, Approval, ProviderId, SecurityFlag, ToolCallRecord, ToolName, WorkflowStatus } from "@internflow/shared";
import { APP_ORDER } from "@/lib/apps";

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

export type StageId = "job" | "resume" | "match" | "email" | "materials" | "tracker" | "calendar" | "approval" | "done";
export type StageState = "pending" | "active" | "done" | "warning" | "waiting" | "skipped";

export interface StageDef {
  id: StageId;
  label: string;
  tools: ToolName[];
  statuses: WorkflowStatus[];
}

export const STAGES: StageDef[] = [
  { id: "job", label: "Job", tools: ["analyze_job"], statuses: ["ANALYZING_JOB"] },
  { id: "resume", label: "Resume", tools: ["search_drive", "get_resume"], statuses: ["FINDING_RESUME"] },
  { id: "match", label: "Match", tools: ["match_resume"], statuses: ["MATCHING_RESUME"] },
  { id: "email", label: "Email", tools: ["search_gmail"], statuses: ["SEARCHING_EMAIL"] },
  { id: "materials", label: "Materials", tools: ["generate_cover_letter", "generate_application_answers"], statuses: ["GENERATING_MATERIAL"] },
  { id: "tracker", label: "Tracker", tools: ["search_notion", "create_application_record", "update_application_record"], statuses: ["UPDATING_TRACKER"] },
  { id: "calendar", label: "Calendar", tools: ["check_calendar"], statuses: ["CHECKING_CALENDAR"] },
  { id: "approval", label: "Approval", tools: ["create_gmail_draft", "create_calendar_event"], statuses: ["WAITING_FOR_APPROVAL"] },
  { id: "done", label: "Done", tools: [], statuses: ["COMPLETED"] },
];

export interface StageView extends StageDef {
  state: StageState;
  detail?: string;
}

function workflowHas(run: AgentRun, id: StageId): boolean {
  const w = run.workflow;
  switch (id) {
    case "job":
      return !!w.job;
    case "resume":
      return !!w.resume;
    case "match":
      return !!w.match;
    case "email":
      return !!w.emailContext;
    case "materials":
      return !!w.generatedMaterials;
    case "tracker":
      return !!w.trackerRecord;
    case "calendar":
      return !!w.calendarRecommendation;
    default:
      return false;
  }
}

export function deriveStages(run: AgentRun): StageView[] {
  const terminal = run.status === "COMPLETED" || run.status === "FAILED";
  return STAGES.map((stage) => {
    if (stage.id === "done") {
      const state: StageState = run.status === "COMPLETED" ? "done" : run.status === "FAILED" ? "warning" : "pending";
      return { ...stage, state };
    }
    if (stage.id === "approval") {
      const approvals = run.workflow.approvals ?? [];
      if (approvals.some((a) => a.status === "pending")) return { ...stage, state: "waiting" };
      if (approvals.some((a) => a.status === "approved" || a.status === "partially_approved")) return { ...stage, state: "done" };
      if (approvals.some((a) => a.status === "rejected")) return { ...stage, state: "skipped", detail: "Cancelled" };
      if (run.status === "WAITING_FOR_APPROVAL") return { ...stage, state: "waiting" };
      return { ...stage, state: terminal ? "skipped" : "pending" };
    }
    const calls = run.toolCalls.filter((c) => stage.tools.includes(c.tool));
    const running = calls.some((c) => c.status === "running");
    const completed = calls.some((c) => c.status === "completed");
    const failed = calls.some((c) => c.status === "failed");
    if (running || (stage.statuses.includes(run.status) && !completed)) return { ...stage, state: "active" };
    if (failed && !completed && !workflowHas(run, stage.id)) return { ...stage, state: "warning", detail: "Recovered" };
    if (completed || workflowHas(run, stage.id)) return { ...stage, state: failed ? "warning" : "done" };
    return { ...stage, state: terminal ? "skipped" : "pending" };
  });
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

export type TimelineEntry =
  | { kind: "message"; id: string; at: string; message: AgentMessage }
  | { kind: "tool"; id: string; at: string; toolCall: ToolCallRecord }
  | { kind: "security"; id: string; at: string; flag: SecurityFlag };

export function buildTimeline(run: AgentRun): TimelineEntry[] {
  const rows: { entry: TimelineEntry; order: number; rank: number }[] = [];
  run.messages.forEach((message, i) =>
    rows.push({ entry: { kind: "message", id: `m:${message.id}`, at: message.createdAt, message }, order: i, rank: 0 }),
  );
  run.toolCalls.forEach((toolCall, i) =>
    rows.push({ entry: { kind: "tool", id: `t:${toolCall.id}`, at: toolCall.startedAt, toolCall }, order: i, rank: 1 }),
  );
  (run.workflow.securityFlags ?? []).forEach((flag, i) =>
    rows.push({ entry: { kind: "security", id: `s:${flag.id}`, at: flag.createdAt, flag }, order: i, rank: 2 }),
  );
  return rows
    .sort((a, b) => {
      const ta = Date.parse(a.entry.at) || 0;
      const tb = Date.parse(b.entry.at) || 0;
      if (ta !== tb) return ta - tb;
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.order - b.order;
    })
    .map((r) => r.entry);
}

// ---------------------------------------------------------------------------
// App activity
// ---------------------------------------------------------------------------

export type AppNodeState = "idle" | "active" | "waiting" | "done" | "failed";

export interface AppActivity {
  app: AppId;
  state: AppNodeState;
  calls: number;
  completed: number;
  failed: number;
  current?: ToolCallRecord;
}

export function deriveAppActivity(run: AgentRun): Record<AppId, AppActivity> {
  const ids: AppId[] = [...APP_ORDER, "internflow"];
  const result = {} as Record<AppId, AppActivity>;
  for (const app of ids) {
    const calls = run.toolCalls.filter((c) => c.app === app);
    const running = calls.filter((c) => c.status === "running");
    const waiting = calls.filter((c) => c.status === "awaiting_approval");
    const completed = calls.filter((c) => c.status === "completed").length;
    const failed = calls.filter((c) => c.status === "failed").length;
    let state: AppNodeState = "idle";
    if (running.length) state = "active";
    else if (waiting.length) state = "waiting";
    else if (completed) state = "done";
    else if (failed) state = "failed";
    result[app] = { app, state, calls: calls.length, completed, failed, current: running.at(-1) ?? waiting.at(-1) };
  }
  return result;
}

export function pendingApproval(run: AgentRun | null): Approval | undefined {
  return run?.workflow.approvals?.find((a) => a.status === "pending");
}

// ---------------------------------------------------------------------------
// Completion checklist
// ---------------------------------------------------------------------------

export type CheckState = "done" | "failed" | "skipped";

export interface ChecklistItem {
  label: string;
  state: CheckState;
  note?: string;
}

function toolState(run: AgentRun, tools: ToolName[], present: boolean): CheckState {
  const calls = run.toolCalls.filter((c) => tools.includes(c.tool));
  if (present || calls.some((c) => c.status === "completed")) return "done";
  if (calls.some((c) => c.status === "failed")) return "failed";
  return "skipped";
}

export function deriveChecklist(run: AgentRun): ChecklistItem[] {
  const w = run.workflow;
  const approvals = w.approvals ?? [];
  const executed = approvals.some((a) => a.actions.some((x) => x.status === "executed" || x.status === "approved"));
  const followUpPresent = !!w.followUpDraft || !!w.calendarEvent || executed;
  const followUp = toolState(run, ["create_gmail_draft", "create_calendar_event"], followUpPresent);
  const rejected = approvals.length > 0 && approvals.every((a) => a.status === "rejected");

  return [
    { label: "Job analyzed", state: toolState(run, ["analyze_job"], !!w.job) },
    { label: "Resume retrieved", state: toolState(run, ["get_resume", "search_drive"], !!w.resume) },
    { label: "Resume matched", state: toolState(run, ["match_resume"], !!w.match), note: w.match ? `${w.match.score}% match` : undefined },
    {
      label: "Email history checked",
      state: toolState(run, ["search_gmail"], !!w.emailContext),
      note: w.emailContext ? (w.emailContext.found ? "Previous thread found" : "No previous thread") : undefined,
    },
    { label: "Application generated", state: toolState(run, ["generate_cover_letter", "generate_application_answers"], !!w.generatedMaterials) },
    { label: "Notion tracker updated", state: toolState(run, ["create_application_record", "update_application_record"], !!w.trackerRecord) },
    { label: "Calendar checked", state: toolState(run, ["check_calendar"], !!w.calendarRecommendation) },
    {
      label: "Follow-up prepared",
      state: rejected ? "skipped" : followUp,
      note: rejected ? "Cancelled by you" : undefined,
    },
  ];
}

export function coordinatedApps(run: AgentRun): ProviderId[] {
  if (run.stats?.appsCoordinated?.length) return run.stats.appsCoordinated;
  const set = new Set<ProviderId>();
  for (const c of run.toolCalls) if (c.status === "completed" && c.app !== "internflow") set.add(c.app);
  return APP_ORDER.filter((a) => set.has(a));
}

export function runTitle(run: AgentRun | null): { title: string; company?: string } {
  const job = run?.workflow.job;
  if (job) return { title: job.title, company: job.company };
  return { title: "New application analysis" };
}
