/** Pure HTML → WebPage extraction (shared by the real and demo web providers). */
import { load, type CheerioAPI } from "cheerio";
import type { WebPage } from "../types.js";

export const MAX_VISIBLE_TEXT_CHARS = 40_000;
const MAX_HIDDEN_TEXT_CHARS = 10_000;

const BLOCK_TAGS = new Set([
  "address", "article", "aside", "blockquote", "dd", "details", "div", "dl", "dt", "fieldset", "figcaption", "figure",
  "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "nav", "ol", "p", "pre", "section",
  "summary", "table", "tbody", "thead", "tfoot", "tr", "ul",
]);
const CELL_TAGS = new Set(["td", "th"]);
const HIDDEN_STYLE = /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\.0+)?\s*(?:;|$|!)|font-size\s*:\s*0(?:px|em|rem|%)?\s*(?:;|$|!))/i;
const HIDDEN_SELECTOR = '[hidden], [aria-hidden="true"], [style]';

// Minimal structural view of domhandler nodes (avoids depending on a transitive package's types).
interface DomNode {
  type: string;
  name?: string;
  data?: string;
  children?: DomNode[];
}

const collapse = (s: string): string => s.replace(/\s+/g, " ").trim();

function parseJsonLd($: CheerioAPI): unknown[] {
  const blocks: unknown[] = [];
  $('script[type="application/ld+json" i]').each((_, el) => {
    const raw = $(el)
      .text()
      .replace(/^\s*(?:<!--|<!\[CDATA\[)/, "")
      .replace(/(?:-->|\]\]>)\s*$/, "")
      .trim();
    if (!raw) return;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) blocks.push(...parsed);
      else blocks.push(parsed);
    } catch {
      // malformed JSON-LD is common in the wild — ignore it
    }
  });
  return blocks;
}

function collectComments(node: DomNode, out: string[]): void {
  for (const child of node.children ?? []) {
    if (child.type === "comment" && child.data) {
      const text = collapse(child.data);
      if (text) out.push(text);
    } else if (child.children) collectComments(child, out);
  }
}

function renderText(node: DomNode, out: string[]): void {
  for (const child of node.children ?? []) {
    if (child.type === "text") {
      out.push((child.data ?? "").replace(/\s+/g, " "));
      continue;
    }
    if (child.type !== "tag") continue;
    const name = child.name ?? "";
    if (name === "br") {
      out.push("\n");
    } else if (name === "li") {
      out.push("\n- ");
      renderText(child, out);
      out.push("\n");
    } else if (BLOCK_TAGS.has(name)) {
      out.push("\n");
      renderText(child, out);
      out.push("\n");
    } else if (CELL_TAGS.has(name)) {
      renderText(child, out);
      out.push(" \t ");
    } else {
      renderText(child, out);
    }
  }
}

export function extractWebPage(html: string, url: string, finalUrl: string = url, fetchedAt: Date = new Date()): WebPage {
  const $ = load(html);

  const title = collapse(
    $("title").first().text() || $('meta[property="og:title"]').attr("content") || $("h1").first().text() || "",
  );
  const jsonLd = parseJsonLd($);

  $("script, style, noscript, template, svg, iframe, object, embed, canvas, link, meta").remove();

  // Hidden content is kept separately so the agent can flag prompt-injection attempts.
  const hidden: string[] = [];
  collectComments($.root().get(0) as unknown as DomNode, hidden);
  const hiddenEls = $(HIDDEN_SELECTOR).filter((_, el) => {
    const $el = $(el);
    if ($el.is("[style]") && !$el.is('[hidden], [aria-hidden="true"]') && !HIDDEN_STYLE.test($el.attr("style") ?? "")) return false;
    return true;
  });
  // Only outermost hidden elements, to avoid duplicated text.
  const outermost = hiddenEls.filter((_, el) => $(el).parents().filter((__, p) => hiddenEls.index(p) !== -1).length === 0);
  outermost.each((_, el) => {
    const text = collapse($(el).text());
    if (text) hidden.push(text);
  });
  hiddenEls.remove();

  const parts: string[] = [];
  const body = $("body").get(0) ?? $.root().get(0);
  renderText(body as unknown as DomNode, parts);
  const text = parts
    .join("")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter((line) => line && line !== "-")
    .join("\n")
    .slice(0, MAX_VISIBLE_TEXT_CHARS);

  return {
    url,
    finalUrl,
    title,
    text,
    hiddenText: hidden.join("\n").slice(0, MAX_HIDDEN_TEXT_CHARS),
    jsonLd,
    fetchedAt: fetchedAt.toISOString(),
  };
}

/** WebPage for a text/plain response. */
export function plainTextPage(content: string, url: string, finalUrl: string = url, fetchedAt: Date = new Date()): WebPage {
  const text = content
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_VISIBLE_TEXT_CHARS);
  return { url, finalUrl, title: text.split("\n")[0]?.slice(0, 200) ?? "", text, hiddenText: "", jsonLd: [], fetchedAt: fetchedAt.toISOString() };
}
