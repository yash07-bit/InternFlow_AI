import { config } from "../../config.js";
import { sleep } from "../http.js";

/** Artificial demo latency: `config.demoLatencyMs` × factor, ±30% jitter. 0 disables it. */
export async function demoDelay(factor = 1): Promise<void> {
  const base = config.demoLatencyMs * factor;
  if (base <= 0) return;
  await sleep(Math.round(base * (0.7 + Math.random() * 0.6)));
}
