/**
 * InternFlow AI — shared contract between backend and frontend.
 *
 * This file is the single source of truth for domain types, the REST API
 * shapes and the Server-Sent Events emitted while the agent runs.
 * All timestamps are ISO-8601 strings.
 */

// ---------------------------------------------------------------------------
// Apps, tools & risk
// ---------------------------------------------------------------------------

/** External applications the agent coordinates. */
export type ProviderId = "gmail" | "google_drive" | "google_calendar" | "notion" | "web";

/** Every tool belongs to an app. `internflow` = the agent's own reasoning engine (matching, writing). */
export type AppId = ProviderId | "internflow";

export const EXTERNAL_PROVIDERS: ProviderId[] = ["web", "google_drive", "gmail", "notion", "google_calendar"];

export const APP_LABELS: Record<AppId, string> = {
  web: "Web",
  google_drive: "Google Drive",
  gmail: "Gmail",
  google_calendar: "Google Calendar",
  notion: "Notion",
  internflow: "InternFlow Engine",
};

/**
 * read      → runs automatically (read job page, search Gmail/Drive, read Calendar/Notion)
 * write     → low-risk write; may run automatically or require confirmation depending on the tool policy
 * dangerous → ALWAYS requires explicit human approval (sending email, submitting applications, deleting data)
 */
export type RiskLevel = "read" | "write" | "dangerous";

export type ToolName =
  | "analyze_job"
  | "search_drive"
  | "get_resume"
  | "match_resume"
  | "search_gmail"
  | "create_gmail_draft"
  | "search_notion"
  | "create_application_record"
  | "update_application_record"
  | "check_calendar"
  | "create_calendar_event"
  | "generate_cover_letter"
  | "generate_application_answers";

/** Static metadata about a tool, safe to expose to the UI (GET /api/agent/tools). */
export interface ToolDescriptor {
  name: ToolName;
  app: AppId;
  label: string; // e.g. "Resume Search"
  description: string;
  riskLevel: RiskLevel;
  requiresApproval: boolean;
}

// ---------------------------------------------------------------------------
// Workflow status
// ---------------------------------------------------------------------------

export type WorkflowStatus =
  | "IDLE"
  | "ANALYZING_JOB"
  | "FINDING_RESUME"
  | "MATCHING_RESUME"
  | "SEARCHING_EMAIL"
  | "GENERATING_MATERIAL"
  | "UPDATING_TRACKER"
  | "CHECKING_CALENDAR"
  | "WAITING_FOR_APPROVAL"
  | "COMPLETED"
  | "FAILED";

// ---------------------------------------------------------------------------
// Domain data
// ---------------------------------------------------------------------------

export interface JobData {
  company: string;
  title: string;
  location?: string;
  workMode?: "onsite" | "remote" | "hybrid";
  employmentType?: string; // e.g. "Internship"
  duration?: string; // e.g. "6 months"
  graduationRequirement?: string;
  /** Required technical skills, canonical names. Alternatives are written "JavaScript / TypeScript". */
  requirements: string[];
  /** Preferred / nice-to-have skills. */
  preferred: string[];
  responsibilities: string[];
  /** Non-technical qualifications (degree, eligibility, soft skills). */
  qualifications: string[];
  deadline?: string; // free text or ISO date as found
  /** Contact email published in the posting (visible text only), e.g. "recruiter@example.com". */
  contactEmail?: string;
  url?: string;
  summary?: string;
  source: "url" | "text";
  extractedWith: "llm" | "heuristic";
}

export interface ResumeProject {
  name: string;
  description: string;
  technologies: string[];
  highlights: string[];
}

export interface ResumeExperience {
  organization: string;
  title: string;
  period?: string;
  highlights: string[];
}

export interface ResumeEducation {
  institution: string;
  degree: string;
  graduation?: string;
  details?: string;
}

export interface ResumeData {
  fileId?: string;
  fileName: string;
  source: ProviderId | "upload";
  modifiedAt?: string;
  candidate: { name: string; email?: string; location?: string; links: string[] };
  headline?: string;
  education: ResumeEducation[];
  skills: string[];
  projects: ResumeProject[];
  experience: ResumeExperience[];
  /** Plain-text resume (sanitized, possibly truncated) — the grounding source for all generated content. */
  rawText: string;
  retrievedAt: string;
}

export type SkillMatchStatus = "found" | "partial" | "missing";

export interface SkillMatch {
  skill: string;
  category: "required" | "preferred";
  /** found = explicitly in resume · partial = potentially relevant evidence · missing = not found */
  status: SkillMatchStatus;
  /** Where in the resume the evidence came from, e.g. "Skills", "Project: Route Optimization Platform". */
  evidence: string[];
}

/**
 * Match score formula (transparent, deterministic):
 *   score = round(65·R + 25·P + 10·E)
 *   R = required coverage, P = preferred coverage (found = 1, partial = 0.3, missing = 0)
 *   E = eligibility fit (education / graduation requirement), 0..1
 */
export interface MatchData {
  score: number; // 0..100
  breakdown: {
    required: { found: number; partial: number; missing: number; total: number; coverage: number };
    preferred: { found: number; partial: number; missing: number; total: number; coverage: number };
    eligibility: { score: number; note: string };
  };
  skills: SkillMatch[];
  strengths: string[]; // e.g. "Full-stack development", "REST API design"
  gaps: string[]; // skills not found / unclear
  relevantProjects: { name: string; reason: string; matchedSkills: string[] }[];
  summary: string;
}

export interface EmailAddress {
  name?: string;
  email: string;
}

export interface EmailMessage {
  id: string;
  threadId: string;
  from: EmailAddress;
  to: EmailAddress[];
  subject: string;
  snippet: string;
  date: string;
  labels?: string[];
}

export interface EmailContext {
  query: string;
  found: boolean;
  messages: EmailMessage[];
  recruiter?: EmailAddress;
  lastContactAt?: string;
  lastSubject?: string;
  summary: string; // "Previous communication found" / "No previous communication found."
}

export interface CoverLetter {
  content: string;
  edited: boolean;
  updatedAt: string;
}

export interface ApplicationAnswer {
  id: string;
  question: string;
  answer: string;
  edited: boolean;
}

export interface GroundingReport {
  /** true when every skill/technology/organization mentioned is backed by the resume or job posting. */
  verified: boolean;
  sourcesUsed: string[]; // e.g. ["Resume: Skills", "Resume: Project — Route Optimization Platform"]
  unsupportedClaims: string[]; // anything we could not verify (should be empty)
}

export interface GeneratedMaterials {
  coverLetter?: CoverLetter;
  answers?: ApplicationAnswer[];
  grounding?: GroundingReport;
  generatedWith: "llm" | "template";
  generatedAt: string;
}

export type ApplicationStatus = "Preparing" | "Ready to apply" | "Applied" | "Interviewing" | "Offer" | "Rejected";

export const APPLICATION_STATUSES: ApplicationStatus[] = [
  "Preparing",
  "Ready to apply",
  "Applied",
  "Interviewing",
  "Offer",
  "Rejected",
];

/** A record as stored in the external tracker (Notion). */
export interface TrackerRecord {
  externalId: string; // Notion page id (mock ids in demo mode)
  url?: string; // link to the Notion page
  provider: "notion";
  company: string;
  role: string;
  jobUrl?: string;
  status: ApplicationStatus;
  matchScore?: number;
  applicationDate?: string; // YYYY-MM-DD, undefined = not applied yet
  followUpDate?: string; // YYYY-MM-DD
  deadline?: string;
  requirements: string[];
  notes?: string;
  syncedAt: string;
}

export interface TimeSlot {
  start: string;
  end: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  description?: string;
  htmlLink?: string;
}

export interface CalendarRecommendation {
  slot: TimeSlot;
  reason: string; // "You're free Tuesday evening, 7 days after preparing the application."
  alternatives: TimeSlot[];
  timezone: string; // IANA, e.g. "Asia/Kolkata"
  eventsConsidered: number;
}

export interface EmailDraft {
  id: string;
  to: EmailAddress[];
  subject: string;
  body: string;
  createdAt: string;
  webLink?: string;
}

export type SecurityFlagType = "prompt_injection" | "suspicious_link" | "content_truncated";

export interface SecurityFlag {
  id: string;
  type: SecurityFlagType;
  source: AppId; // where the untrusted content came from
  excerpt: string; // short, sanitized excerpt of the offending text
  action: string; // "Ignored — treated as untrusted data"
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Applications (local persistence, mirrored to Notion)
// ---------------------------------------------------------------------------

export interface Application {
  id: string;
  userId: string;
  company: string;
  role: string;
  jobUrl?: string;
  location?: string;
  status: ApplicationStatus;
  matchScore?: number;
  applicationDate?: string;
  deadline?: string;
  followUpDate?: string;
  notes?: string;
  job?: JobData;
  match?: MatchData;
  materials?: GeneratedMaterials;
  emailContext?: EmailContext;
  tracker?: TrackerRecord; // present when synced to Notion
  latestRunId?: string;
  createdAt: string;
  updatedAt: string;
}

export type ApplicationSummary = Pick<
  Application,
  "id" | "company" | "role" | "jobUrl" | "location" | "status" | "matchScore" | "followUpDate" | "deadline" | "latestRunId" | "createdAt" | "updatedAt"
> & { trackerUrl?: string };

// ---------------------------------------------------------------------------
// Agent run state
// ---------------------------------------------------------------------------

export interface RunInput {
  jobUrl?: string;
  jobDescription?: string;
  options?: RunOptions;
}

export interface RunOptions {
  /** Demo/testing aid: make these providers fail so graceful recovery can be shown. */
  simulateFailures?: ProviderId[];
}

export type ToolCallStatus = "running" | "completed" | "failed" | "awaiting_approval" | "rejected";

export interface ToolError {
  code: "AUTH" | "API" | "TIMEOUT" | "NOT_FOUND" | "INVALID_INPUT" | "RATE_LIMIT" | "NOT_CONNECTED" | "REJECTED" | "INTERNAL";
  message: string;
  retryable: boolean;
}

export interface ToolCallRecord {
  id: string;
  runId: string;
  tool: ToolName;
  app: AppId;
  label: string; // "Resume Search"
  riskLevel: RiskLevel;
  status: ToolCallStatus;
  /** Present-tense progress line, e.g. "Searching for latest resume…" */
  activity: string;
  input: Record<string, unknown>;
  /** One-line result, e.g. "Found Demo Candidate — Resume.pdf" */
  summary?: string;
  /** Structured result for the expandable details panel (sanitized, no tokens). */
  detail?: unknown;
  error?: ToolError;
  approvalId?: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
}

/** User-facing reasoning summaries. Never private chain-of-thought. */
export interface AgentMessage {
  id: string;
  runId: string;
  kind: "decision" | "info" | "warning" | "final";
  text: string;
  /** e.g. [{ app: "google_drive", label: "Resume Search" }] rendered as "Google Drive → Resume Search" */
  using?: { app: AppId; label: string }[];
  createdAt: string;
}

export type ApprovalActionType = "CREATE_GMAIL_DRAFT" | "CREATE_CALENDAR_EVENT" | "CREATE_NOTION_RECORD" | "SEND_EMAIL";

export interface GmailDraftPayload {
  to: EmailAddress[];
  subject: string;
  body: string;
}

export interface CalendarEventPayload {
  title: string;
  start: string;
  end: string;
  description?: string;
}

export interface ApprovalAction {
  id: string;
  toolCallId: string;
  tool: ToolName;
  app: AppId;
  riskLevel: RiskLevel;
  type: ApprovalActionType;
  title: string; // "Create Gmail follow-up draft"
  description: string;
  payload: GmailDraftPayload | CalendarEventPayload | Record<string, unknown>;
  status: "pending" | "approved" | "rejected" | "executed" | "failed";
  result?: string;
}

export interface Approval {
  id: string;
  runId: string;
  status: "pending" | "approved" | "rejected" | "partially_approved";
  actions: ApprovalAction[];
  createdAt: string;
  resolvedAt?: string;
}

export interface ApplicationWorkflow {
  job?: JobData;
  resume?: ResumeData;
  match?: MatchData;
  emailContext?: EmailContext;
  generatedMaterials?: GeneratedMaterials;
  trackerRecord?: TrackerRecord;
  calendarRecommendation?: CalendarRecommendation;
  followUpDraft?: EmailDraft;
  calendarEvent?: CalendarEvent;
  approvals: Approval[];
  status: WorkflowStatus;
  securityFlags: SecurityFlag[];
  /** Non-fatal problems, e.g. "Google Calendar temporarily unavailable — scheduling can be retried later." */
  warnings: string[];
}

export interface RunStats {
  appsCoordinated: ProviderId[]; // distinct external apps successfully used
  toolCalls: number;
  agentActions: number;
  approvals: number;
  failures: number;
  durationMs: number;
  readiness: number; // 0..100 application readiness
}

export interface AgentRun {
  id: string;
  userId: string;
  applicationId?: string;
  input: RunInput;
  status: WorkflowStatus;
  mode: "demo" | "live";
  llm: { provider: "anthropic" | "local"; model: string };
  workflow: ApplicationWorkflow;
  toolCalls: ToolCallRecord[];
  messages: AgentMessage[];
  stats?: RunStats;
  error?: string;
  startedAt: string;
  completedAt?: string;
}

export type AgentRunSummary = Pick<AgentRun, "id" | "applicationId" | "status" | "mode" | "startedAt" | "completedAt"> & {
  company?: string;
  role?: string;
  matchScore?: number;
  toolCalls: number;
};

// ---------------------------------------------------------------------------
// Server-Sent Events — GET /api/agent/runs/:id/events
// On connect the server replays every event of the run (seq starting at 1), then streams live.
// Clients may pass ?after=<seq> (or Last-Event-ID) to resume. A `: ping` comment is sent every 15s.
// SSE `event:` field = the event type below; `data:` = JSON of the whole AgentEvent.
// ---------------------------------------------------------------------------

interface EventBase {
  seq: number;
  runId: string;
  at: string;
}

export type AgentEvent = EventBase &
  (
    | { type: "agent_started"; run: AgentRun }
    | { type: "status_changed"; status: WorkflowStatus }
    | { type: "agent_message"; message: AgentMessage }
    | { type: "tool_started"; toolCall: ToolCallRecord }
    | { type: "tool_completed"; toolCall: ToolCallRecord }
    | { type: "tool_failed"; toolCall: ToolCallRecord }
    | { type: "workflow_updated"; workflow: ApplicationWorkflow }
    | { type: "approval_required"; approval: Approval }
    | { type: "approval_resolved"; approval: Approval }
    | { type: "agent_completed"; run: AgentRun }
    | { type: "agent_failed"; run: AgentRun; error: string }
  );

export type AgentEventType = AgentEvent["type"];

export const AGENT_EVENT_TYPES: AgentEventType[] = [
  "agent_started",
  "status_changed",
  "agent_message",
  "tool_started",
  "tool_completed",
  "tool_failed",
  "workflow_updated",
  "approval_required",
  "approval_resolved",
  "agent_completed",
  "agent_failed",
];

// ---------------------------------------------------------------------------
// Integrations & settings
// ---------------------------------------------------------------------------

export interface IntegrationStatus {
  id: ProviderId;
  name: string;
  description: string; // "Email search + drafts"
  capabilities: string[];
  /** connected = live OAuth/API connection · demo = served by mock provider · ready = no auth needed (web) */
  status: "connected" | "disconnected" | "demo" | "ready" | "error";
  authType: "oauth_google" | "oauth_notion" | "none";
  /** true when server-side credentials (client id/secret or API key) are configured in env */
  configured: boolean;
  accountLabel?: string; // e.g. "you@gmail.com" or "Demo account"
  lastError?: string;
}

export interface AppSettings {
  demoMode: boolean;
  user: { id: string; name: string; email: string };
  llm: { provider: "anthropic" | "local"; model: string; configured: boolean };
  database: "postgres" | "json";
}

// ---------------------------------------------------------------------------
// REST API — request/response shapes
// Errors: non-2xx responses return ApiErrorBody.
// ---------------------------------------------------------------------------

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}

// GET    /api/health                                   → { ok: true, version: string }
// GET    /api/settings                                 → AppSettings
// PATCH  /api/settings            UpdateSettingsRequest → AppSettings
// GET    /api/agent/tools                              → ToolDescriptor[]
// POST   /api/agent/run           StartRunRequest       → 202 StartRunResponse
// GET    /api/agent/runs                               → AgentRunSummary[]   (newest first)
// GET    /api/agent/runs/:id                           → AgentRun
// GET    /api/agent/runs/:id/events   (alias /stream)  → text/event-stream of AgentEvent
// POST   /api/agent/approvals/:id/approve  ApproveRequest → ApprovalResponse
// POST   /api/agent/approvals/:id/reject   RejectRequest  → ApprovalResponse
// GET    /api/applications                             → ApplicationSummary[]
// GET    /api/applications/:id                         → Application
// POST   /api/applications        CreateApplicationRequest → 201 Application
// PATCH  /api/applications/:id    UpdateApplicationRequest → Application
// POST   /api/applications/:id/materials/regenerate  RegenerateRequest → Application
// GET    /api/integrations                             → IntegrationStatus[]
// POST   /api/integrations/:provider/connect           → ConnectResponse
// POST   /api/integrations/:provider/disconnect        → IntegrationStatus
// GET    /api/integrations/google/callback             (OAuth redirect → frontend /app/integrations?connected=google)
// GET    /api/integrations/notion/callback             (OAuth redirect → frontend /app/integrations?connected=notion)

export interface UpdateSettingsRequest {
  demoMode?: boolean;
}

export interface StartRunRequest {
  jobUrl?: string; // http(s) URL; one of jobUrl / jobDescription is required
  jobDescription?: string; // pasted text, max 20k chars
  options?: RunOptions;
}

export interface StartRunResponse {
  runId: string;
  run: AgentRun;
}

export interface ApproveRequest {
  /** Approve only these actions (others are rejected). Omit to approve all. */
  actionIds?: string[];
  /** User edits applied before execution, keyed by action id (e.g. edited draft body or event time). */
  edits?: Record<string, Partial<GmailDraftPayload> | Partial<CalendarEventPayload>>;
}

export interface RejectRequest {
  reason?: string;
}

export interface ApprovalResponse {
  approval: Approval;
  run: AgentRun;
}

export interface CreateApplicationRequest {
  company: string;
  role: string;
  jobUrl?: string;
  status?: ApplicationStatus;
  matchScore?: number;
  followUpDate?: string;
  deadline?: string;
  notes?: string;
}

export interface UpdateApplicationRequest {
  status?: ApplicationStatus;
  followUpDate?: string | null;
  deadline?: string | null;
  applicationDate?: string | null;
  notes?: string;
  coverLetter?: string; // edited cover letter content
  answers?: { id: string; answer: string }[]; // edited answers
}

export interface RegenerateRequest {
  kind: "cover_letter" | "answers";
}

export interface ConnectResponse {
  /** When set, the browser should navigate here to complete OAuth. */
  authUrl?: string;
  integration: IntegrationStatus;
}

// ---------------------------------------------------------------------------
// Demo constants
// ---------------------------------------------------------------------------

export const DEMO_JOB_URL = "https://example.com/software-engineering-internship";
