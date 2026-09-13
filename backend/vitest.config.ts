import os from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: { DEMO_LATENCY_MS: "0", AI_PROVIDER: "local", DATA_DIR: path.join(os.tmpdir(), `internflow-test-${process.pid}`) },
    testTimeout: 20_000,
  },
});
