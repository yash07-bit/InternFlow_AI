/**
 * Provider interfaces. Real (OAuth/API) and mock (demo) implementations sit behind
 * these exact interfaces so the agent's tools never know which one they are using.
 */
import type {
  CalendarEvent,
  EmailAddress,
  EmailDraft,
  EmailMessage,
  ProviderId,
  TimeSlot,
  ToolError,
  TrackerRecord,
} from "@internflow/shared";

export interface ProviderContext {
  userId: string;
  demoMode: boolean;
  /** Providers that should throw a simulated outage (demo aid for graceful recovery). */
  simulateFailures?: ProviderId[];
}

/** Every provider failure is normalized to this error. */
export class IntegrationError extends Error {
  constructor(
    public readonly provider: ProviderId,
    public readonly code: ToolError["code"],
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "IntegrationError";
  }

  toToolError(): ToolError {
    return { code: this.code, message: this.message, retryable: this.retryable };
  }
}

// --- Google Drive ------------------------------------------------------------

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  sizeBytes?: number;
  webViewLink?: string;
}

export interface DriveProvider {
  /** Search files by free-text name/content query, newest first. */
  searchFiles(query: string, opts?: { limit?: number }): Promise<DriveFile[]>;
  /** Return the file metadata plus extracted plain text (Google Doc export, PDF text, txt/md). */
  getFileText(fileId: string): Promise<{ file: DriveFile; text: string }>;
}

// --- Gmail ---------------------------------------------------------------------

export interface DraftInput {
  to: EmailAddress[];
  subject: string;
  body: string;
}

export interface GmailProvider {
  /** Gmail search syntax is accepted (e.g. `"Example AI" OR from:example.com`). Newest first. */
  searchEmails(query: string, opts?: { limit?: number }): Promise<EmailMessage[]>;
  /** Creates a DRAFT only. There is intentionally no send method. */
  createDraft(input: DraftInput): Promise<EmailDraft>;
}

// --- Google Calendar -----------------------------------------------------------

export interface CreateEventInput {
  title: string;
  start: string;
  end: string;
  description?: string;
}

export interface CalendarProvider {
  listEvents(range: TimeSlot): Promise<CalendarEvent[]>;
  createEvent(input: CreateEventInput): Promise<CalendarEvent>;
  /** IANA timezone of the user's primary calendar. */
  getTimezone(): Promise<string>;
}

// --- Notion --------------------------------------------------------------------

export type TrackerInput = Omit<TrackerRecord, "externalId" | "url" | "provider" | "syncedAt">;

export interface NotionProvider {
  findApplications(query: { company?: string; role?: string; jobUrl?: string }): Promise<TrackerRecord[]>;
  createApplication(input: TrackerInput): Promise<TrackerRecord>;
  updateApplication(externalId: string, patch: Partial<TrackerInput>): Promise<TrackerRecord>;
}

// --- Web -----------------------------------------------------------------------

export interface WebPage {
  url: string;
  finalUrl: string;
  title: string;
  /** Visible text with scripts/styles removed, whitespace collapsed, capped at ~40k chars. */
  text: string;
  /** Text that was present in the DOM but hidden from humans (display:none, aria-hidden, etc.) — kept for injection detection. */
  hiddenText: string;
  /** Parsed <script type="application/ld+json"> blocks (job boards often embed a schema.org JobPosting). */
  jsonLd: unknown[];
  fetchedAt: string;
}

export interface WebProvider {
  /** Fetches a public http(s) page. Must block private/loopback addresses (SSRF) and time out. */
  fetchPage(url: string): Promise<WebPage>;
}

// --- Aggregate ---------------------------------------------------------------------

export interface ProviderSet {
  drive: DriveProvider;
  gmail: GmailProvider;
  calendar: CalendarProvider;
  notion: NotionProvider;
  web: WebProvider;
}

/**
 * Resolution rules (implemented in ./index.ts → `getProviders(ctx)`):
 *   demoMode            → mock provider for every app (web: demo pages for demo URLs, real fetch otherwise)
 *   live + connected    → real provider
 *   live + disconnected → a provider whose methods throw IntegrationError(code "NOT_CONNECTED")
 *   simulateFailures    → wraps the provider so every call throws IntegrationError(code "API", retryable) after a short delay
 */
export type GetProviders = (ctx: ProviderContext) => Promise<ProviderSet>;
