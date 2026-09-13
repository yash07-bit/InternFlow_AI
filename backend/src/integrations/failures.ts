/** Provider wrappers for disconnected apps and simulated outages. */
import type { ProviderId } from "@internflow/shared";
import { config } from "../config.js";
import { appLabel, sleep } from "./http.js";
import { IntegrationError, type ProviderSet } from "./types.js";

/** ProviderSet key ↔ ProviderId. */
export const PROVIDER_KEYS: Record<keyof ProviderSet, ProviderId> = {
  drive: "google_drive",
  gmail: "gmail",
  calendar: "google_calendar",
  notion: "notion",
  web: "web",
};

const PROVIDER_METHODS: { [K in keyof ProviderSet]: (keyof ProviderSet[K])[] } = {
  drive: ["searchFiles", "getFileText"],
  gmail: ["searchEmails", "createDraft"],
  calendar: ["listEvents", "createEvent", "getTimezone"],
  notion: ["findApplications", "createApplication", "updateApplication"],
  web: ["fetchPage"],
};

/** A provider whose every method rejects with the given error. */
export function throwingProvider<K extends keyof ProviderSet>(key: K, makeError: () => IntegrationError): ProviderSet[K] {
  const methods = PROVIDER_METHODS[key] as string[];
  return Object.fromEntries(methods.map((m) => [m, async () => Promise.reject(makeError())])) as unknown as ProviderSet[K];
}

export function notConnectedProvider<K extends keyof ProviderSet>(key: K, message?: string): ProviderSet[K] {
  const provider = PROVIDER_KEYS[key];
  return throwingProvider(
    key,
    () =>
      new IntegrationError(
        provider,
        "NOT_CONNECTED",
        message ?? `${appLabel(provider)} is not connected. Connect it on the Integrations page or enable Demo Mode.`,
      ),
  );
}

/** Wraps a provider so every method call waits briefly, then throws a retryable simulated outage. */
export function withSimulatedFailure<T extends object>(provider: ProviderId, target: T): T {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      const value = Reflect.get(obj, prop, receiver);
      if (typeof value !== "function" || typeof prop === "symbol" || prop === "then" || prop === "constructor") return value;
      return async () => {
        await sleep(Math.min(config.demoLatencyMs, 600));
        throw new IntegrationError(provider, "API", `${appLabel(provider)} is temporarily unavailable (simulated outage).`, true);
      };
    },
  });
}

export function applySimulatedFailures(set: ProviderSet, failing: ProviderId[] | undefined): ProviderSet {
  if (!failing?.length) return set;
  const out = { ...set };
  for (const key of Object.keys(PROVIDER_KEYS) as (keyof ProviderSet)[]) {
    const id = PROVIDER_KEYS[key];
    if (failing.includes(id)) (out as Record<keyof ProviderSet, object>)[key] = withSimulatedFailure(id, set[key]);
  }
  return out;
}
