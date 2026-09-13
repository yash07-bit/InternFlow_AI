/**
 * Prompt-injection detection for untrusted external content (web pages, emails, documents).
 * Detected text is never executed or forwarded to the model; it only produces SecurityFlags.
 */
import type { AppId, SecurityFlag } from "@internflow/shared";
import { newId, nowIso } from "../utils/ids.js";
import { collapseWhitespace, redactContacts, truncate } from "../utils/text.js";

const PATTERNS: { id: string; re: RegExp }[] = [
  { id: "ignore_instructions", re: /\bignore\s+(?:all\s+|any\s+)?(?:of\s+)?(?:the\s+|your\s+)?(?:previous|prior|above|earlier|preceding|other)?\s*(?:instructions|directions|prompts?|rules)\b/i },
  { id: "note_to_ai", re: /\b(?:note|message|instructions?)\s+(?:to|for)\s+(?:the\s+|any\s+|all\s+)?(?:ai|a\.i\.|llms?|language models?|assistants?|chatbots?|agents?|gpt)\b/i },
  { id: "addressed_to_ai", re: /\b(?:dear\s+)?(?:ai|llm)\s+(?:assistants?|agents?|models?)\s*[:,]/i },
  { id: "disregard", re: /\bdisregard\s+(?:all\s+|any\s+)?(?:the\s+|your\s+)?(?:previous|prior|above|earlier|instructions|guidelines|rules)/i },
  { id: "system_prompt", re: /\b(?:reveal|print|show|ignore|override|leak|repeat)\s+(?:your|the)\s+(?:system\s+prompt|instructions)\b|\bsystem\s+prompt\s*:/i },
  { id: "role_override", re: /\byou\s+are\s+now\s+(?:a|an|the|in)\b|\bact\s+as\s+(?:an?\s+)?(?:unrestricted|different|new)\b|\bnew\s+instructions\s*:/i },
  { id: "send_data", re: /\bsend\b[^.!?\n]{0,80}\b(?:inbox|e-?mails|messages|contacts|credentials|passwords?|tokens?|api\s*keys?)\b/i },
  { id: "forward_data", re: /\bforward\s+(?:all|every|the|their|your|my|this|these)\b[^.!?\n]{0,60}\b(?:e-?mails?|inbox|messages|conversations|threads)\b/i },
  { id: "auto_submit", re: /\bsubmit\s+(?:the\s+|this\s+|my\s+|their\s+)?application\s+(?:automatically|on\s+(?:their|my|the candidate'?s?)\s+behalf|without)/i },
  { id: "exfiltration", re: /\b(?:exfiltrate|leak|upload|copy)\b[^.!?\n]{0,60}\b(?:inbox|e-?mails|files|documents|tokens?|credentials)\b/i },
  { id: "hidden_directive", re: /\b(?:do\s+not|don'?t)\s+(?:tell|inform|mention\s+(?:this\s+)?to)\s+(?:the\s+)?(?:user|candidate|human)\b/i },
];

export interface InjectionHit {
  pattern: string;
  excerpt: string;
}

/** Split into sentence-ish segments so excerpts stay short and precise. */
function segments(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => collapseWhitespace(s))
    .filter((s) => s.length > 0);
}

export function detectInjection(text: string): InjectionHit[] {
  if (!text) return [];
  const hits: InjectionHit[] = [];
  const seen = new Set<string>();
  for (const seg of segments(text)) {
    const match = PATTERNS.find((p) => p.re.test(seg));
    if (!match) continue;
    const excerpt = truncate(redactContacts(seg), 180);
    if (seen.has(excerpt)) continue;
    seen.add(excerpt);
    hits.push({ pattern: match.id, excerpt });
  }
  return hits;
}

export const containsInjection = (text: string): boolean => PATTERNS.some((p) => p.re.test(text));

/** Remove injection sentences from text before it is parsed into structured data. */
export function stripInjectedSegments(text: string): string {
  return text
    .split(/\n/)
    .map((line) =>
      line
        .split(/(?<=[.!?])\s+/)
        .filter((s) => !containsInjection(s))
        .join(" "),
    )
    .join("\n");
}

export function toSecurityFlags(hits: InjectionHit[], source: AppId, hidden: boolean): SecurityFlag[] {
  return hits.map((h) => ({
    id: newId("sec"),
    type: "prompt_injection" as const,
    source,
    excerpt: h.excerpt,
    action: hidden
      ? "Hidden instructions ignored — treated as untrusted data and never passed to the AI model"
      : "Ignored — treated as untrusted data",
    createdAt: nowIso(),
  }));
}
