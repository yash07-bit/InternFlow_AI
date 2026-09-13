import { randomUUID } from "node:crypto";

/** Short, prefixed, URL-safe identifiers, e.g. `run_3f9c0a1b2c3d4e5f`. */
export const newId = (prefix: string): string => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

export const nowIso = (): string => new Date().toISOString();
