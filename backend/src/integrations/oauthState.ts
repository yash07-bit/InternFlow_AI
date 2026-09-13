/** CSRF `state` values for OAuth flows: random, server-side, 10-minute expiry, single use. */
import { randomBytes } from "node:crypto";

export type OAuthStateProvider = "google" | "notion";

const STATE_TTL_MS = 10 * 60_000;
const states = new Map<string, { userId: string; provider: OAuthStateProvider; expiresAt: number }>();

export function createOAuthState(userId: string, provider: OAuthStateProvider, now = Date.now()): string {
  for (const [key, entry] of states) if (entry.expiresAt <= now) states.delete(key);
  const state = randomBytes(24).toString("base64url");
  states.set(state, { userId, provider, expiresAt: now + STATE_TTL_MS });
  return state;
}

/** Returns the userId bound to the state and deletes it; null when unknown, expired or for another provider. */
export function consumeOAuthState(state: string | undefined, provider: OAuthStateProvider, now = Date.now()): string | null {
  if (!state) return null;
  const entry = states.get(state);
  if (!entry) return null;
  states.delete(state);
  if (entry.provider !== provider || entry.expiresAt <= now) return null;
  return entry.userId;
}
