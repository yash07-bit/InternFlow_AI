/**
 * Store accessor for integrations. Resolves core's `getStore()` lazily so this module can be
 * unit-tested with an in-memory fake (see `setIntegrationStore`).
 */
import type { Store } from "../db/types.js";

let override: Store | undefined;

/** Test hook: inject a fake store (pass `undefined` to restore the real one). */
export function setIntegrationStore(store: Store | undefined): void {
  override = store;
}

export async function integrationStore(): Promise<Store> {
  if (override) return override;
  const { getStore } = await import("../db/index.js");
  return getStore();
}
