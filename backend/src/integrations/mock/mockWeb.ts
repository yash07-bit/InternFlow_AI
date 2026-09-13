import type { WebPage, WebProvider } from "../types.js";
import { extractWebPage } from "../web/extract.js";
import { DEMO_WEB_PAGES } from "./demoData.js";
import { demoDelay } from "./latency.js";

const demoPageFor = (url: string) => DEMO_WEB_PAGES[url.trim()] ?? DEMO_WEB_PAGES[url.trim().replace(/\/+$/, "")];

/** Serves the fictional demo job pages through the real extractor; any other URL goes to the real web provider. */
export class DemoAwareWebProvider implements WebProvider {
  constructor(
    private readonly fallback: WebProvider,
    private readonly simulateLatency = true,
  ) {}

  async fetchPage(url: string): Promise<WebPage> {
    const demo = demoPageFor(url);
    if (!demo) return this.fallback.fetchPage(url);
    if (this.simulateLatency) await demoDelay(1.2);
    return extractWebPage(demo.html, url.trim());
  }
}
