/**
 * Integration entry point: provider resolution (see rules in ./types.ts) and integration status listing.
 */
import { EXTERNAL_PROVIDERS, type IntegrationStatus, type ProviderId } from "@internflow/shared";
import type { ConnectionRecord, Store } from "../db/types.js";
import { applySimulatedFailures, notConnectedProvider } from "./failures.js";
import { GoogleDriveProvider } from "./google-drive/driveProvider.js";
import { GOOGLE_APP_SCOPES, GoogleClient, isGoogleConfigured, type GoogleProviderId } from "./google/oauth.js";
import { GoogleCalendarProvider } from "./google-calendar/calendarProvider.js";
import { GoogleGmailProvider } from "./gmail/gmailProvider.js";
import { appLabel } from "./http.js";
import { createMockProviders } from "./mock/index.js";
import { DemoAwareWebProvider } from "./mock/mockWeb.js";
import { createNotionClient, NotionTrackerProvider } from "./notion/notionProvider.js";
import { envWorkspaceLabel, isNotionApiKeyConfigured, isNotionConfigured, resolveNotionToken } from "./notion/oauth.js";
import { integrationStore } from "./store.js";
import type { GetProviders, ProviderSet } from "./types.js";
import { HttpWebProvider } from "./web/webProvider.js";

const webProvider = new HttpWebProvider();

export const getProviders: GetProviders = async (ctx) => {
  const set = ctx.demoMode ? createMockProviders(ctx.userId, webProvider) : await createLiveProviders(ctx.userId, await integrationStore());
  return applySimulatedFailures(set, ctx.simulateFailures);
};

async function createLiveProviders(userId: string, store: Store): Promise<ProviderSet> {
  const [google, notionToken] = await Promise.all([store.connections.get(userId, "google"), resolveNotionToken(store, userId)]);

  let drive: ProviderSet["drive"];
  let gmail: ProviderSet["gmail"];
  let calendar: ProviderSet["calendar"];
  if (google?.status === "connected") {
    const client = new GoogleClient(store, userId);
    drive = new GoogleDriveProvider(client);
    gmail = new GoogleGmailProvider(client);
    calendar = new GoogleCalendarProvider(client);
  } else {
    const message = google
      ? (id: ProviderId) => `${appLabel(id)} access expired or was revoked. Reconnect Google on the Integrations page or enable Demo Mode.`
      : () => undefined;
    drive = notConnectedProvider("drive", message("google_drive"));
    gmail = notConnectedProvider("gmail", message("gmail"));
    calendar = notConnectedProvider("calendar", message("google_calendar"));
  }

  return {
    drive,
    gmail,
    calendar,
    notion: notionToken ? new NotionTrackerProvider(createNotionClient(notionToken.token)) : notConnectedProvider("notion"),
    // The fictional demo job URL (example.com is reserved) is served locally so it works in live mode too.
    web: new DemoAwareWebProvider(webProvider, false),
  };
}

// --- Integration status ------------------------------------------------------------------

const CATALOG: Record<ProviderId, Pick<IntegrationStatus, "name" | "description" | "capabilities" | "authType">> = {
  web: {
    name: "Web",
    description: "Job analysis",
    capabilities: ["Fetch public job pages", "Read structured job data (JSON-LD)", "Detect hidden prompt-injection text"],
    authType: "none",
  },
  google_drive: {
    name: "Google Drive",
    description: "Resume retrieval",
    capabilities: ["Search files", "Read resume text (Google Docs, PDF, TXT/Markdown)"],
    authType: "oauth_google",
  },
  gmail: {
    name: "Gmail",
    description: "Email search + drafts",
    capabilities: ["Search previous recruiter emails", "Create follow-up drafts (never sends)"],
    authType: "oauth_google",
  },
  google_calendar: {
    name: "Google Calendar",
    description: "Scheduling + reminders",
    capabilities: ["Read availability", "Create follow-up reminders (after approval)"],
    authType: "oauth_google",
  },
  notion: {
    name: "Notion",
    description: "Application tracking",
    capabilities: ["Find application records", "Create tracker records", "Update application status"],
    authType: "oauth_notion",
  },
};

function googleStatus(id: GoogleProviderId, record: ConnectionRecord | null): Partial<IntegrationStatus> {
  if (!record) return { status: "disconnected" };
  if (record.status === "error") {
    return { status: "error", accountLabel: record.accountLabel, lastError: "Google access expired or was revoked. Reconnect Google." };
  }
  const missing = record.scopes ? GOOGLE_APP_SCOPES[id].filter((s) => !record.scopes?.includes(s)) : [];
  if (missing.length) {
    return {
      status: "error",
      accountLabel: record.accountLabel,
      lastError: `${appLabel(id)} permission was not granted. Reconnect Google and allow access to ${appLabel(id)}.`,
    };
  }
  return { status: "connected", accountLabel: record.accountLabel };
}

async function liveStatus(id: ProviderId, store: Store, userId: string): Promise<Partial<IntegrationStatus>> {
  if (id === "web") return { status: "ready" };
  if (id === "notion") {
    if (isNotionApiKeyConfigured()) {
      return { status: "connected", accountLabel: await envWorkspaceLabel() };
    }
    const record = await store.connections.get(userId, "notion");
    if (!record) return { status: "disconnected" };
    if (record.status === "error") return { status: "error", accountLabel: record.accountLabel, lastError: "Notion access was revoked. Reconnect Notion." };
    return { status: "connected", accountLabel: record.accountLabel };
  }
  return googleStatus(id, await store.connections.get(userId, "google"));
}

const isConfigured = (id: ProviderId): boolean =>
  id === "web" ? true : id === "notion" ? isNotionConfigured() : isGoogleConfigured();

export async function getIntegrationStatus(userId: string, demoMode: boolean, id: ProviderId): Promise<IntegrationStatus> {
  const base: IntegrationStatus = { id, ...CATALOG[id], configured: isConfigured(id), status: "disconnected" };
  if (id === "web") return { ...base, status: "ready" };
  if (demoMode) return { ...base, status: "demo", accountLabel: "Demo account" };
  return { ...base, ...(await liveStatus(id, await integrationStore(), userId)) };
}

export async function listIntegrations(userId: string, demoMode: boolean): Promise<IntegrationStatus[]> {
  return Promise.all(EXTERNAL_PROVIDERS.map((id) => getIntegrationStatus(userId, demoMode, id)));
}
