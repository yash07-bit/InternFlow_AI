import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// Load backend/.env first, then the repo-root .env (earlier files win).
loadEnv({ path: path.resolve(here, "../.env"), quiet: true });
loadEnv({ path: path.resolve(here, "../../.env"), quiet: true });

const str = (key: string, fallback = ""): string => process.env[key]?.trim() || fallback;
const bool = (key: string, fallback: boolean): boolean => {
  const v = process.env[key]?.trim().toLowerCase();
  if (!v) return fallback;
  return ["1", "true", "yes", "on"].includes(v);
};
const int = (key: string, fallback: number): number => {
  const v = Number.parseInt(process.env[key] ?? "", 10);
  return Number.isFinite(v) ? v : fallback;
};

const anthropicKey = str("ANTHROPIC_API_KEY");
const requestedProvider = str("AI_PROVIDER", "auto").toLowerCase();

export const config = {
  env: str("NODE_ENV", "development"),
  port: int("API_PORT", 4000),
  appUrl: str("APP_URL", "http://localhost:5173"),
  apiUrl: str("API_URL", "http://localhost:4000"),

  /** Default for new installs; the UI toggle persists per user. */
  demoModeDefault: bool("DEMO_MODE", true),
  /** Artificial latency added to mock providers so the live timeline is watchable. 0 in tests. */
  demoLatencyMs: int("DEMO_LATENCY_MS", 700),
  userTimezone: str("USER_TIMEZONE", Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"),

  ai: {
    /** "anthropic" uses Claude tool calling; "local" uses the deterministic planner; "auto" picks anthropic when a key exists. */
    provider: (requestedProvider === "local" || (requestedProvider === "auto" && !anthropicKey) ? "local" : "anthropic") as
      | "anthropic"
      | "local",
    model: str("AI_MODEL", "claude-opus-5"),
    effort: str("AI_EFFORT", "medium") as "low" | "medium" | "high" | "xhigh" | "max",
    anthropicApiKey: anthropicKey,
    maxAgentTurns: int("AI_MAX_TURNS", 24),
  },

  databaseUrl: str("DATABASE_URL"),
  dataDir: str("DATA_DIR", path.resolve(here, "../data")),

  /** 32+ char secret used to encrypt OAuth tokens at rest (AES-256-GCM). */
  tokenEncryptionKey: str("TOKEN_ENCRYPTION_KEY", "dev-only-insecure-key-change-me-please-32chars"),

  google: {
    clientId: str("GOOGLE_CLIENT_ID"),
    clientSecret: str("GOOGLE_CLIENT_SECRET"),
    redirectUri: str("GOOGLE_REDIRECT_URI", "http://localhost:4000/api/integrations/google/callback"),
  },

  notion: {
    /** Internal integration token — simplest option; counts as "connected". */
    apiKey: str("NOTION_API_KEY"),
    /** Public integration OAuth (optional alternative to apiKey). */
    clientId: str("NOTION_CLIENT_ID"),
    clientSecret: str("NOTION_CLIENT_SECRET"),
    redirectUri: str("NOTION_REDIRECT_URI", "http://localhost:4000/api/integrations/notion/callback"),
    /** Database used as the application tracker. */
    databaseId: str("NOTION_DATABASE_ID"),
  },

  rateLimit: {
    agentRunsPerMinute: int("RATE_LIMIT_RUNS_PER_MINUTE", 10),
    apiRequestsPerMinute: int("RATE_LIMIT_API_PER_MINUTE", 300),
  },
} as const;

export type AppConfig = typeof config;
