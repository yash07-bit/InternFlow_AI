/**
 * /api/integrations — status, connect/disconnect and OAuth callbacks.
 * OAuth tokens are handled server-side only; responses never include them.
 */
import type { ApiErrorBody, ConnectResponse, ProviderId } from "@internflow/shared";
import express, { type Request, type Response } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { getIntegrationStatus, listIntegrations } from "../integrations/index.js";
import { buildGoogleAuthUrl, completeGoogleOAuth, disconnectGoogle, isGoogleConfigured } from "../integrations/google/oauth.js";
import {
  buildNotionAuthUrl,
  completeNotionOAuth,
  isNotionApiKeyConfigured,
  isNotionOAuthConfigured,
} from "../integrations/notion/oauth.js";
import { consumeOAuthState } from "../integrations/oauthState.js";
import { integrationStore } from "../integrations/store.js";

const providerSchema = z.enum(["gmail", "google_drive", "google_calendar", "notion", "web"]);
const callbackQuery = z.object({
  code: z.string().min(1).max(2048).optional(),
  state: z.string().min(1).max(256).optional(),
  error: z.string().max(256).optional(),
});

const isGoogle = (p: ProviderId) => p === "gmail" || p === "google_drive" || p === "google_calendar";

function sendError(res: Response, status: number, code: string, message: string): void {
  const body: ApiErrorBody = { error: { code, message } };
  res.status(status).json(body);
}

async function currentUser() {
  const store = await integrationStore();
  const user = await store.users.getOrCreateDemoUser();
  const { demoMode } = await store.settings.get(user.id);
  return { store, userId: user.id, demoMode };
}

function parseProvider(req: Request, res: Response): ProviderId | null {
  const parsed = providerSchema.safeParse(req.params.provider);
  if (!parsed.success) {
    sendError(res, 400, "INVALID_INPUT", `Unknown integration "${String(req.params.provider).slice(0, 50)}".`);
    return null;
  }
  return parsed.data;
}

function redirectToApp(res: Response, params: Record<string, string>): void {
  res.redirect(302, `${config.appUrl}/app/integrations?${new URLSearchParams(params).toString()}`);
}

/** Maps an OAuth provider error param to a short, safe code for the frontend. */
const safeErrorCode = (error: string): string => (/^[a-z_]{1,40}$/.test(error) ? error : "oauth_error");

export function integrationsRouter(): express.Router {
  const router = express.Router();

  router.get("/", async (_req, res) => {
    const { userId, demoMode } = await currentUser();
    res.json(await listIntegrations(userId, demoMode));
  });

  router.post("/:provider/connect", async (req, res) => {
    const provider = parseProvider(req, res);
    if (!provider) return;
    const { userId, demoMode } = await currentUser();
    const integration = await getIntegrationStatus(userId, demoMode, provider);

    // Demo Mode apps are served by mock providers and web needs no auth: nothing to connect.
    if (demoMode || provider === "web") {
      res.json({ integration } satisfies ConnectResponse);
      return;
    }

    if (isGoogle(provider)) {
      if (!isGoogleConfigured()) {
        sendError(
          res,
          400,
          "NOT_CONFIGURED",
          "Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (and GOOGLE_REDIRECT_URI) in .env and restart the backend — or enable Demo Mode.",
        );
        return;
      }
      if (integration.status === "connected") {
        res.json({ integration } satisfies ConnectResponse);
        return;
      }
      res.json({ authUrl: buildGoogleAuthUrl(userId), integration } satisfies ConnectResponse);
      return;
    }

    // Notion
    if (isNotionApiKeyConfigured() || integration.status === "connected") {
      res.json({ integration } satisfies ConnectResponse);
      return;
    }
    if (isNotionOAuthConfigured()) {
      res.json({ authUrl: buildNotionAuthUrl(userId), integration } satisfies ConnectResponse);
      return;
    }
    sendError(
      res,
      400,
      "NOT_CONFIGURED",
      "Notion is not configured. Set NOTION_API_KEY (internal integration token, plus NOTION_DATABASE_ID) or NOTION_CLIENT_ID and NOTION_CLIENT_SECRET for OAuth in .env and restart the backend — or enable Demo Mode.",
    );
  });

  router.post("/:provider/disconnect", async (req, res) => {
    const provider = parseProvider(req, res);
    if (!provider) return;
    const { store, userId, demoMode } = await currentUser();
    if (isGoogle(provider)) await disconnectGoogle(store, userId);
    else if (provider === "notion") await store.connections.remove(userId, "notion");
    res.json(await getIntegrationStatus(userId, demoMode, provider));
  });

  router.get("/google/callback", async (req, res) => {
    const query = callbackQuery.safeParse(req.query);
    if (!query.success) return redirectToApp(res, { error: "invalid_callback", provider: "google" });
    const { code, state, error } = query.data;
    if (error) return redirectToApp(res, { error: safeErrorCode(error), provider: "google" });
    const userId = consumeOAuthState(state, "google");
    if (!userId) return redirectToApp(res, { error: "invalid_state", provider: "google" });
    if (!code) return redirectToApp(res, { error: "missing_code", provider: "google" });
    try {
      await completeGoogleOAuth(await integrationStore(), userId, code);
      redirectToApp(res, { connected: "google" });
    } catch (err) {
      console.error("[integrations] Google OAuth callback failed:", err instanceof Error ? err.message : "unknown error");
      redirectToApp(res, { error: "token_exchange_failed", provider: "google" });
    }
  });

  router.get("/notion/callback", async (req, res) => {
    const query = callbackQuery.safeParse(req.query);
    if (!query.success) return redirectToApp(res, { error: "invalid_callback", provider: "notion" });
    const { code, state, error } = query.data;
    if (error) return redirectToApp(res, { error: safeErrorCode(error), provider: "notion" });
    const userId = consumeOAuthState(state, "notion");
    if (!userId) return redirectToApp(res, { error: "invalid_state", provider: "notion" });
    if (!code) return redirectToApp(res, { error: "missing_code", provider: "notion" });
    try {
      await completeNotionOAuth(await integrationStore(), userId, code);
      redirectToApp(res, { connected: "notion" });
    } catch (err) {
      console.error("[integrations] Notion OAuth callback failed:", err instanceof Error ? err.message : "unknown error");
      redirectToApp(res, { error: "token_exchange_failed", provider: "notion" });
    }
  });

  return router;
}
