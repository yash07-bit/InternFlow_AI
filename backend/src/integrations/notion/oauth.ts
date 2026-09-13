/**
 * Notion auth. Option A: NOTION_API_KEY (internal integration) counts as connected without OAuth.
 * Option B: public-integration OAuth; the access token is stored encrypted in ConnectionRecord.
 */
import { Client } from "@notionhq/client";
import { config } from "../../config.js";
import type { ConnectionRecord, Store } from "../../db/types.js";
import { decryptJson, encryptJson } from "../crypto.js";
import { API_TIMEOUT_MS, describeErrorBody } from "../http.js";
import { createOAuthState } from "../oauthState.js";

export const NOTION_AUTHORIZE_URL = "https://api.notion.com/v1/oauth/authorize";
export const NOTION_TOKEN_URL = "https://api.notion.com/v1/oauth/token";

export interface NotionTokens {
  accessToken: string;
  refreshToken?: string;
  workspaceId?: string;
  workspaceName?: string;
  botId?: string;
}

export const isNotionApiKeyConfigured = (): boolean => Boolean(config.notion.apiKey);
export const isNotionOAuthConfigured = (): boolean => Boolean(config.notion.clientId && config.notion.clientSecret);
export const isNotionConfigured = (): boolean => isNotionApiKeyConfigured() || isNotionOAuthConfigured();

export function buildNotionAuthUrl(userId: string): string {
  const params = new URLSearchParams({
    client_id: config.notion.clientId,
    response_type: "code",
    owner: "user",
    redirect_uri: config.notion.redirectUri,
    state: createOAuthState(userId, "notion"),
  });
  return `${NOTION_AUTHORIZE_URL}?${params.toString()}`;
}

export async function completeNotionOAuth(store: Store, userId: string, code: string): Promise<ConnectionRecord> {
  const basic = Buffer.from(`${config.notion.clientId}:${config.notion.clientSecret}`).toString("base64");
  const res = await fetch(NOTION_TOKEN_URL, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ grant_type: "authorization_code", code, redirect_uri: config.notion.redirectUri }),
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Notion token exchange failed (HTTP ${res.status}): ${describeErrorBody(text)}`);
  const body = JSON.parse(text) as {
    access_token: string;
    refresh_token?: string | null;
    workspace_id?: string;
    workspace_name?: string | null;
    bot_id?: string;
  };

  const tokens: NotionTokens = {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? undefined,
    workspaceId: body.workspace_id,
    workspaceName: body.workspace_name ?? undefined,
    botId: body.bot_id,
  };
  const existing = await store.connections.get(userId, "notion");
  const now = new Date().toISOString();
  const record: ConnectionRecord = {
    userId,
    provider: "notion",
    status: "connected",
    encryptedTokens: encryptJson(tokens),
    accountLabel: tokens.workspaceName ?? "Notion workspace",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await store.connections.upsert(record);
  return record;
}

/** Token used for live Notion calls: env API key first, then the stored OAuth grant. */
export async function resolveNotionToken(store: Store, userId: string): Promise<{ token: string; source: "env" | "oauth" } | null> {
  if (config.notion.apiKey) return { token: config.notion.apiKey, source: "env" };
  const record = await store.connections.get(userId, "notion");
  if (!record || record.status !== "connected") return null;
  try {
    return { token: decryptJson<NotionTokens>(record.encryptedTokens).accessToken, source: "oauth" };
  } catch {
    await store.connections.upsert({ ...record, status: "error", updatedAt: new Date().toISOString() });
    return null;
  }
}

let envLabelCache: { key: string; label: string; expiresAt: number } | undefined;

/** Workspace name for the internal-integration token (cached, best-effort, never throws). */
export async function envWorkspaceLabel(): Promise<string> {
  const key = config.notion.apiKey;
  const fallback = "Notion (internal integration)";
  if (!key) return fallback;
  if (envLabelCache && envLabelCache.key === key && envLabelCache.expiresAt > Date.now()) return envLabelCache.label;
  let label = fallback;
  let ttl = 60_000;
  try {
    const client = new Client({ auth: key, timeoutMs: 4_000, retry: false });
    const me = await client.users.me({});
    if (me.type === "bot" && "workspace_name" in me.bot && me.bot.workspace_name) {
      label = me.bot.workspace_name;
      ttl = 30 * 60_000;
    }
  } catch {
    // keep fallback label; retry after a minute
  }
  envLabelCache = { key, label, expiresAt: Date.now() + ttl };
  return label;
}
