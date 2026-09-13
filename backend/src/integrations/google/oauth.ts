/**
 * Google OAuth 2.0 — one grant covers Gmail, Google Drive and Google Calendar.
 * Tokens are AES-256-GCM encrypted in ConnectionRecord.encryptedTokens and never logged or returned.
 */
import type { ProviderId } from "@internflow/shared";
import { config } from "../../config.js";
import type { ConnectionRecord, Store } from "../../db/types.js";
import { decryptJson, encryptJson } from "../crypto.js";
import { API_TIMEOUT_MS, describeErrorBody, httpStatusError, normalizeError } from "../http.js";
import { createOAuthState } from "../oauthState.js";
import { IntegrationError } from "../types.js";

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
export const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";

const SCOPE = {
  gmailRead: "https://www.googleapis.com/auth/gmail.readonly",
  gmailCompose: "https://www.googleapis.com/auth/gmail.compose",
  driveRead: "https://www.googleapis.com/auth/drive.readonly",
  calendarRead: "https://www.googleapis.com/auth/calendar.readonly",
  calendarEvents: "https://www.googleapis.com/auth/calendar.events",
} as const;

export const GOOGLE_SCOPES = ["openid", "email", ...Object.values(SCOPE)];

export type GoogleProviderId = Extract<ProviderId, "gmail" | "google_drive" | "google_calendar">;

/** Scopes each app needs (users can untick individual scopes on Google's consent screen). */
export const GOOGLE_APP_SCOPES: Record<GoogleProviderId, string[]> = {
  gmail: [SCOPE.gmailRead, SCOPE.gmailCompose],
  google_drive: [SCOPE.driveRead],
  google_calendar: [SCOPE.calendarRead, SCOPE.calendarEvents],
};

export interface GoogleTokens {
  accessToken: string;
  refreshToken?: string;
  /** epoch ms */
  expiresAt: number;
}

interface TokenResponse {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
}

export const isGoogleConfigured = (): boolean => Boolean(config.google.clientId && config.google.clientSecret);

export function buildGoogleAuthUrl(userId: string): string {
  const params = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: config.google.redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: createOAuthState(userId, "google"),
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

class TokenEndpointError extends Error {
  constructor(
    readonly status: number,
    readonly oauthError: string,
    readonly retryAfter: string | null,
  ) {
    super(`Google token endpoint error (${status}) ${oauthError}`);
  }
}

async function postTokenEndpoint(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ client_id: config.google.clientId, client_secret: config.google.clientSecret, ...params }),
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    let oauthError = "";
    try {
      oauthError = String((JSON.parse(text) as { error?: unknown }).error ?? "");
    } catch {
      oauthError = describeErrorBody(text);
    }
    throw new TokenEndpointError(res.status, oauthError, res.headers.get("retry-after"));
  }
  return JSON.parse(text) as TokenResponse;
}

const toTokens = (res: TokenResponse, previousRefreshToken?: string): GoogleTokens => ({
  accessToken: res.access_token,
  refreshToken: res.refresh_token ?? previousRefreshToken,
  expiresAt: Date.now() + (res.expires_in ?? 3600) * 1000,
});

/** OAuth callback: exchange the code, look up the account email and persist the encrypted grant. */
export async function completeGoogleOAuth(store: Store, userId: string, code: string): Promise<ConnectionRecord> {
  const tokenRes = await postTokenEndpoint({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.google.redirectUri,
  });

  let email: string | undefined;
  try {
    const info = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokenRes.access_token}` },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (info.ok) email = ((await info.json()) as { email?: string }).email;
  } catch {
    // The account label is cosmetic; the grant is still valid.
  }

  const existing = await store.connections.get(userId, "google");
  let previousRefresh: string | undefined;
  if (existing) {
    try {
      previousRefresh = decryptJson<GoogleTokens>(existing.encryptedTokens).refreshToken;
    } catch {
      previousRefresh = undefined;
    }
  }

  const now = new Date().toISOString();
  const record: ConnectionRecord = {
    userId,
    provider: "google",
    status: "connected",
    encryptedTokens: encryptJson(toTokens(tokenRes, previousRefresh)),
    accountLabel: email ?? existing?.accountLabel ?? "Google account",
    scopes: tokenRes.scope ? tokenRes.scope.split(/\s+/).filter(Boolean) : GOOGLE_SCOPES,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await store.connections.upsert(record);
  return record;
}

/** Best-effort token revocation, then removes the grant (affects all three Google apps). */
export async function disconnectGoogle(store: Store, userId: string): Promise<void> {
  const record = await store.connections.get(userId, "google");
  if (!record) return;
  try {
    const tokens = decryptJson<GoogleTokens>(record.encryptedTokens);
    await fetch(GOOGLE_REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: tokens.refreshToken ?? tokens.accessToken }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // Revocation is best-effort; the local grant is removed regardless.
  }
  await store.connections.remove(userId, "google");
}

const RECONNECT_MESSAGE = "Google access expired or was revoked. Reconnect Google on the Integrations page or enable Demo Mode.";

/**
 * Authenticated Google REST client shared by the Drive, Gmail and Calendar providers.
 * Refreshes the access token when it is about to expire or on a 401, and persists refreshed tokens.
 */
export class GoogleClient {
  private tokens?: GoogleTokens;
  private refreshing?: Promise<GoogleTokens>;

  constructor(
    private readonly store: Store,
    private readonly userId: string,
  ) {}

  async json<T>(provider: ProviderId, url: string, init: RequestInit = {}): Promise<T> {
    const res = await this.request(provider, url, init);
    try {
      return (await res.json()) as T;
    } catch (err) {
      throw normalizeError(provider, err);
    }
  }

  /** Performs an authenticated request; non-2xx responses throw IntegrationError. */
  async request(provider: ProviderId, url: string, init: RequestInit = {}): Promise<Response> {
    try {
      let tokens = await this.loadTokens(provider);
      if (tokens.expiresAt - 60_000 <= Date.now()) tokens = await this.refresh(provider, tokens.accessToken);

      let res = await this.send(url, init, tokens.accessToken);
      if (res.status === 401) {
        await res.body?.cancel();
        tokens = await this.refresh(provider, tokens.accessToken);
        res = await this.send(url, init, tokens.accessToken);
      }
      if (!res.ok) {
        const detail = describeErrorBody(await res.text().catch(() => ""));
        throw httpStatusError(provider, res.status, detail, res.headers.get("retry-after"));
      }
      return res;
    } catch (err) {
      throw normalizeError(provider, err);
    }
  }

  private send(url: string, init: RequestInit, accessToken: string): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${accessToken}`);
    const timeout = AbortSignal.timeout(API_TIMEOUT_MS);
    return fetch(url, { ...init, headers, signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
  }

  private async loadTokens(provider: ProviderId): Promise<GoogleTokens> {
    if (this.tokens) return this.tokens;
    const record = await this.store.connections.get(this.userId, "google");
    if (!record) {
      throw new IntegrationError(provider, "NOT_CONNECTED", "Google is not connected. Connect it on the Integrations page or enable Demo Mode.");
    }
    if (record.status === "error") throw new IntegrationError(provider, "AUTH", RECONNECT_MESSAGE);
    try {
      this.tokens = decryptJson<GoogleTokens>(record.encryptedTokens);
    } catch {
      await this.markError();
      throw new IntegrationError(provider, "AUTH", RECONNECT_MESSAGE);
    }
    return this.tokens;
  }

  private refresh(provider: ProviderId, staleAccessToken: string): Promise<GoogleTokens> {
    if (this.tokens && this.tokens.accessToken !== staleAccessToken && this.tokens.expiresAt - 60_000 > Date.now()) {
      return Promise.resolve(this.tokens); // a concurrent call already refreshed
    }
    this.refreshing ??= this.doRefresh(provider).finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }

  private async doRefresh(provider: ProviderId): Promise<GoogleTokens> {
    const current = await this.loadTokens(provider);
    if (!current.refreshToken) {
      await this.markError();
      throw new IntegrationError(provider, "AUTH", RECONNECT_MESSAGE);
    }
    let res: TokenResponse;
    try {
      res = await postTokenEndpoint({ grant_type: "refresh_token", refresh_token: current.refreshToken });
    } catch (err) {
      if (err instanceof TokenEndpointError) {
        if (err.oauthError === "invalid_grant" || err.oauthError === "unauthorized_client" || err.status === 401) {
          await this.markError();
          throw new IntegrationError(provider, "AUTH", RECONNECT_MESSAGE);
        }
        throw httpStatusError(provider, err.status, "token refresh failed", err.retryAfter);
      }
      throw normalizeError(provider, err);
    }

    const tokens = toTokens(res, current.refreshToken);
    this.tokens = tokens;
    const record = await this.store.connections.get(this.userId, "google");
    if (record) {
      await this.store.connections.upsert({
        ...record,
        status: "connected",
        encryptedTokens: encryptJson(tokens),
        updatedAt: new Date().toISOString(),
      });
    }
    return tokens;
  }

  private async markError(): Promise<void> {
    this.tokens = undefined;
    const record = await this.store.connections.get(this.userId, "google");
    if (record && record.status !== "error") {
      await this.store.connections.upsert({ ...record, status: "error", updatedAt: new Date().toISOString() });
    }
  }
}
