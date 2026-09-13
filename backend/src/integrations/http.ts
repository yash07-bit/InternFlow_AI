/** Shared HTTP helpers: timeouts and normalization of every failure into IntegrationError. */
import { APP_LABELS, type ProviderId } from "@internflow/shared";
import { IntegrationError } from "./types.js";

export const API_TIMEOUT_MS = 15_000;

export const appLabel = (provider: ProviderId): string => APP_LABELS[provider];

/** Extracts a short, token-free error description from a JSON/text API error body. */
export function describeErrorBody(body: string): string {
  if (!body) return "";
  try {
    const parsed = JSON.parse(body) as {
      error?: string | { message?: string; status?: string };
      error_description?: string;
      message?: string;
    };
    if (typeof parsed.error === "object" && parsed.error?.message) return parsed.error.message;
    if (parsed.error_description) return parsed.error_description;
    if (typeof parsed.error === "string") return parsed.error;
    if (parsed.message) return parsed.message;
  } catch {
    // not JSON
  }
  return body.replace(/\s+/g, " ").slice(0, 200);
}

/** Maps an HTTP status to a normalized IntegrationError. */
export function httpStatusError(
  provider: ProviderId,
  status: number,
  detail = "",
  retryAfter?: string | null,
): IntegrationError {
  const app = appLabel(provider);
  const suffix = detail ? `: ${detail.slice(0, 200)}` : "";
  if (status === 401 || status === 403) {
    return new IntegrationError(provider, "AUTH", `${app} rejected the request (HTTP ${status})${suffix}. Reconnect ${app} on the Integrations page.`);
  }
  if (status === 404) return new IntegrationError(provider, "NOT_FOUND", `${app} resource not found${suffix}`);
  if (status === 429) {
    const wait = retryAfter ? ` Retry after ${retryAfter}${/^\d+$/.test(retryAfter) ? "s" : ""}.` : "";
    return new IntegrationError(provider, "RATE_LIMIT", `${app} rate limit reached.${wait}`, true);
  }
  if (status >= 500) return new IntegrationError(provider, "API", `${app} is temporarily unavailable (HTTP ${status}).`, true);
  if (status === 400 || status === 422) return new IntegrationError(provider, "INVALID_INPUT", `${app} rejected the request${suffix}`);
  return new IntegrationError(provider, "API", `${app} request failed (HTTP ${status})${suffix}`);
}

export function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
}

/** Normalizes any thrown value (network errors, aborts, bugs) into IntegrationError. */
export function normalizeError(provider: ProviderId, err: unknown): IntegrationError {
  if (err instanceof IntegrationError) return err;
  const app = appLabel(provider);
  if (isTimeoutError(err)) return new IntegrationError(provider, "TIMEOUT", `${app} did not respond in time.`, true);
  if (err instanceof TypeError && /fetch failed|network|ECONN|ENOTFOUND|socket/i.test(`${err.message} ${String(err.cause ?? "")}`)) {
    return new IntegrationError(provider, "API", `Could not reach ${app} (network error).`, true);
  }
  const message = err instanceof Error ? err.message : String(err);
  return new IntegrationError(provider, "INTERNAL", `${app} integration error: ${message.slice(0, 200)}`);
}

/** Runs async work, converting any failure into IntegrationError. */
export async function guard<T>(provider: ProviderId, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw normalizeError(provider, err);
  }
}

/** Promise.all with bounded concurrency, preserving order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i] as T, i);
    }
  });
  await Promise.all(workers);
  return results;
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
