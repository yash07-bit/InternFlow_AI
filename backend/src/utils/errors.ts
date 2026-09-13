import type { ToolError } from "@internflow/shared";
import { IntegrationError } from "../integrations/types.js";

/** An error that maps directly to an HTTP response with an ApiErrorBody. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const notFound = (what: string) => new HttpError(404, "NOT_FOUND", `${what} not found`);

/** Thrown by tools for non-integration failures (bad state, invalid input…). */
export class ToolExecutionError extends Error {
  constructor(
    public readonly code: ToolError["code"],
    message: string,
    public readonly retryable = false,
  ) {
    super(message);
    this.name = "ToolExecutionError";
  }
}

/** Normalize anything thrown during tool execution into the shared ToolError shape. */
export function toToolError(err: unknown): ToolError {
  if (err instanceof IntegrationError) return err.toToolError();
  if (err instanceof ToolExecutionError) return { code: err.code, message: err.message, retryable: err.retryable };
  if (err instanceof Error && err.name === "IntegrationError" && "code" in err) {
    const e = err as Error & { code: ToolError["code"]; retryable?: boolean };
    return { code: e.code, message: e.message, retryable: Boolean(e.retryable) };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { code: "INTERNAL", message: message || "Unexpected error", retryable: false };
}

export const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));
