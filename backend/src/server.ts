import { createApp } from "./app.js";
import { config } from "./config.js";
import { initStore } from "./db/index.js";
import { createAnthropicClient } from "./services/llm.js";

const store = await initStore();
const llm = config.ai.provider === "anthropic" ? createAnthropicClient() : null;
const { app } = createApp({ store, llm });

app.listen(config.port, () => {
  console.log(`\n  InternFlow AI API  →  http://localhost:${config.port}`);
  console.log(`  Agent brain        →  ${llm ? `Claude (${config.ai.model})` : "Local planner (set ANTHROPIC_API_KEY to use Claude)"}`);
  console.log(`  Database           →  ${store.kind}`);
  console.log(`  Frontend           →  ${config.appUrl}\n`);
});
