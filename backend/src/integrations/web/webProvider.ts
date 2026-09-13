/** Real web provider: SSRF-safe fetch of public job pages with manual, re-validated redirects. */
import { httpStatusError, normalizeError } from "../http.js";
import { IntegrationError, type WebPage, type WebProvider } from "../types.js";
import { extractWebPage, plainTextPage } from "./extract.js";
import { assertPublicUrl, type LookupFn } from "./ssrf.js";

export const WEB_TIMEOUT_MS = 10_000;
export const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 InternFlowAI/1.0";

export interface WebProviderDeps {
  lookup?: LookupFn;
  fetch?: typeof fetch;
}

async function readBody(res: Response, maxBytes: number): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  if (total >= maxBytes) await reader.cancel().catch(() => undefined); // oversized: keep the first 2 MB
  const out = new Uint8Array(Math.min(total, maxBytes));
  let offset = 0;
  for (const chunk of chunks) {
    const slice = chunk.subarray(0, Math.max(0, out.length - offset));
    out.set(slice, offset);
    offset += slice.length;
    if (offset >= out.length) break;
  }
  return out;
}

function decode(bytes: Uint8Array, contentType: string): string {
  const charset = /charset\s*=\s*"?([\w.:-]+)/i.exec(contentType)?.[1];
  try {
    return new TextDecoder(charset ?? "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

export class HttpWebProvider implements WebProvider {
  constructor(private readonly deps: WebProviderDeps = {}) {}

  async fetchPage(url: string): Promise<WebPage> {
    const doFetch = this.deps.fetch ?? globalThis.fetch;
    const signal = AbortSignal.timeout(WEB_TIMEOUT_MS);
    try {
      let current = await assertPublicUrl(url, this.deps.lookup);
      for (let hop = 0; ; hop++) {
        const res = await doFetch(current, {
          redirect: "manual",
          signal,
          headers: {
            "User-Agent": USER_AGENT,
            Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
            "Accept-Language": "en-US,en;q=0.9",
          },
        });

        if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
          await res.body?.cancel().catch(() => undefined);
          if (hop >= MAX_REDIRECTS) throw new IntegrationError("web", "INVALID_INPUT", "The page redirected too many times.");
          current = await assertPublicUrl(new URL(res.headers.get("location") as string, current), this.deps.lookup);
          continue;
        }

        if (!res.ok) {
          await res.body?.cancel().catch(() => undefined);
          if (res.status === 401 || res.status === 403) {
            // Not an auth problem we can fix by reconnecting — the site blocks automated access.
            throw new IntegrationError("web", "API", `The website refused access (HTTP ${res.status}). Paste the job description text instead.`);
          }
          throw httpStatusError("web", res.status, "", res.headers.get("retry-after"));
        }

        const contentType = (res.headers.get("content-type") ?? "text/html").toLowerCase();
        const isHtml = contentType.includes("text/html") || contentType.includes("application/xhtml+xml");
        if (!isHtml && !contentType.includes("text/plain")) {
          await res.body?.cancel().catch(() => undefined);
          throw new IntegrationError("web", "INVALID_INPUT", `Unsupported content type (${contentType.split(";")[0]}). Only HTML or plain-text pages can be analyzed.`);
        }

        const content = decode(await readBody(res, MAX_BODY_BYTES), contentType);
        const finalUrl = current.toString();
        return isHtml ? extractWebPage(content, url, finalUrl) : plainTextPage(content, url, finalUrl);
      }
    } catch (err) {
      throw normalizeError("web", err);
    }
  }
}
