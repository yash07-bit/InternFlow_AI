/** RFC 2822 / RFC 2047 helpers for Gmail: address parsing, header decoding and draft message building. */
import type { EmailAddress } from "@internflow/shared";

const ENTITY_MAP: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith("#x")) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
    if (lower.startsWith("#")) return String.fromCodePoint(Number.parseInt(lower.slice(1), 10));
    return ENTITY_MAP[lower] ?? match;
  });
}

/** Decodes RFC 2047 encoded-words (`=?UTF-8?B?...?=` / `=?UTF-8?Q?...?=`). */
export function decodeMimeWords(value: string): string {
  return value
    .replace(/(=\?[^?]+\?[bq]\?[^?]*\?=)\s+(?==\?)/gi, "$1")
    .replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (match, charset: string, enc: string, data: string) => {
      try {
        const bytes =
          enc.toLowerCase() === "b"
            ? Buffer.from(data, "base64")
            : Buffer.from(
                data.replace(/_/g, " ").replace(/=([0-9a-f]{2})/gi, (_m, hex: string) => String.fromCharCode(Number.parseInt(hex, 16))),
                "latin1",
              );
        return new TextDecoder(charset.toLowerCase()).decode(bytes);
      } catch {
        return match;
      }
    });
}

/** Splits on commas that are not inside quotes or angle brackets. */
function splitAddressList(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  let depth = 0;
  for (const ch of value) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch === "<") depth++;
    else if (!inQuotes && ch === ">") depth = Math.max(0, depth - 1);
    if (ch === "," && !inQuotes && depth === 0) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Parses `"Name" <a@b.com>, c@d.com` into EmailAddress[]. */
export function parseAddressList(header: string | undefined): EmailAddress[] {
  if (!header) return [];
  return splitAddressList(decodeMimeWords(header)).map((part) => {
    const angle = part.match(/^(.*)<([^>]+)>\s*$/);
    if (angle) {
      const name = (angle[1] ?? "").trim().replace(/^"(.*)"$/, "$1").replace(/\\"/g, '"').trim();
      const email = (angle[2] ?? "").trim();
      return name ? { name, email } : { email };
    }
    return { email: part.replace(/^"(.*)"$/, "$1").trim() };
  });
}

const EMAIL_RE = /^[^\s@<>(),;:"\\[\]]+@[^\s@<>(),;:"\\[\]]+\.[^\s@<>(),;:"\\[\]]+$/;
export const isValidEmail = (email: string): boolean => EMAIL_RE.test(email);

// eslint-disable-next-line no-control-regex
const isAscii = (s: string): boolean => /^[\x00-\x7F]*$/.test(s);
const stripLineBreaks = (s: string): string => s.replace(/[\r\n]+/g, " ").trim();

/** RFC 2047 B-encoding, split into encoded-words of ≤ ~75 chars on code-point boundaries. */
export function encodeHeaderValue(value: string): string {
  const clean = stripLineBreaks(value);
  if (isAscii(clean)) return clean;
  const words: string[] = [];
  let chunk = "";
  for (const ch of clean) {
    if (Buffer.byteLength(chunk + ch, "utf8") > 45) {
      words.push(chunk);
      chunk = "";
    }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w, "utf8").toString("base64")}?=`).join("\r\n ");
}

export function formatAddress(addr: EmailAddress): string {
  const email = stripLineBreaks(addr.email);
  const name = addr.name ? stripLineBreaks(addr.name) : "";
  if (!name) return email;
  if (!isAscii(name)) return `${encodeHeaderValue(name)} <${email}>`;
  return `"${name.replace(/(["\\])/g, "\\$1")}" <${email}>`;
}

/** Builds an RFC 2822 text/plain UTF-8 message (base64 body, CRLF line endings). */
export function buildRawMessage(input: { to: EmailAddress[]; subject: string; body: string }): string {
  const body = Buffer.from(input.body.replace(/\r?\n/g, "\r\n"), "utf8")
    .toString("base64")
    .replace(/.{1,76}/g, "$&\r\n");
  return [
    `To: ${input.to.map(formatAddress).join(", ")}`,
    `Subject: ${encodeHeaderValue(input.subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    body,
  ].join("\r\n");
}
