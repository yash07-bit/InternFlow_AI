/** Minimal leveled logger. Silent under vitest unless LOG_LEVEL is set explicitly. */
type Level = "debug" | "info" | "warn" | "error";
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const configured = (process.env.LOG_LEVEL?.toLowerCase() as Level | undefined) ?? (process.env.VITEST ? undefined : "info");
const threshold = configured ? ORDER[configured] ?? ORDER.info : Number.POSITIVE_INFINITY;

function emit(level: Level, scope: string, message: string, extra?: unknown) {
  if (ORDER[level] < threshold) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}`;
  const out = level === "error" || level === "warn" ? console.error : console.log;
  if (extra === undefined) out(line);
  else out(line, extra instanceof Error ? extra.message : extra);
}

export function createLogger(scope: string) {
  return {
    debug: (m: string, e?: unknown) => emit("debug", scope, m, e),
    info: (m: string, e?: unknown) => emit("info", scope, m, e),
    warn: (m: string, e?: unknown) => emit("warn", scope, m, e),
    error: (m: string, e?: unknown) => emit("error", scope, m, e),
  };
}

export type Logger = ReturnType<typeof createLogger>;
