/** Gmail (REST v1) provider: message search + DRAFT creation. There is intentionally no send capability. */
import type { EmailDraft, EmailMessage } from "@internflow/shared";
import type { GoogleClient } from "../google/oauth.js";
import { mapLimit } from "../http.js";
import { IntegrationError, type DraftInput, type GmailProvider } from "../types.js";
import { buildRawMessage, decodeHtmlEntities, decodeMimeWords, isValidEmail, parseAddressList } from "./mime.js";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
export const GMAIL_DRAFTS_LINK = "https://mail.google.com/mail/#drafts";

interface ApiMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: { headers?: { name: string; value: string }[] };
}

export function toEmailMessage(msg: ApiMessage): EmailMessage {
  const header = (name: string) => msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
  const dateHeader = header("Date");
  const parsed = dateHeader ? new Date(dateHeader) : undefined;
  const date =
    parsed && !Number.isNaN(parsed.getTime())
      ? parsed.toISOString()
      : new Date(msg.internalDate ? Number(msg.internalDate) : Date.now()).toISOString();
  return {
    id: msg.id,
    threadId: msg.threadId,
    from: parseAddressList(header("From"))[0] ?? { email: "" },
    to: parseAddressList(header("To")),
    subject: decodeMimeWords(header("Subject") ?? "").trim(),
    snippet: decodeHtmlEntities(msg.snippet ?? ""),
    date,
    labels: msg.labelIds,
  };
}

export class GoogleGmailProvider implements GmailProvider {
  constructor(private readonly google: GoogleClient) {}

  async searchEmails(query: string, opts: { limit?: number } = {}): Promise<EmailMessage[]> {
    const limit = Math.min(Math.max(opts.limit ?? 10, 1), 25);
    const list = await this.google.json<{ messages?: { id: string; threadId: string }[] }>(
      "gmail",
      `${GMAIL_API}/messages?${new URLSearchParams({ q: query, maxResults: String(limit) })}`,
    );
    const ids = (list.messages ?? []).slice(0, limit);
    const metadata = "format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date";
    const messages = await mapLimit(ids, 10, (m) =>
      this.google.json<ApiMessage>("gmail", `${GMAIL_API}/messages/${encodeURIComponent(m.id)}?${metadata}`),
    );
    return messages.map(toEmailMessage).sort((a, b) => b.date.localeCompare(a.date));
  }

  async createDraft(input: DraftInput): Promise<EmailDraft> {
    validateDraft(input);
    const raw = Buffer.from(buildRawMessage(input), "utf8").toString("base64url");
    const res = await this.google.json<{ id: string }>("gmail", `${GMAIL_API}/drafts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: { raw } }),
    });
    return {
      id: res.id,
      to: input.to,
      subject: input.subject,
      body: input.body,
      createdAt: new Date().toISOString(),
      webLink: GMAIL_DRAFTS_LINK,
    };
  }
}

export function validateDraft(input: DraftInput): void {
  if (!input.to.length) throw new IntegrationError("gmail", "INVALID_INPUT", "A draft needs at least one recipient.");
  const bad = input.to.find((a) => !isValidEmail(a.email));
  if (bad) throw new IntegrationError("gmail", "INVALID_INPUT", `Invalid recipient email address: ${bad.email.slice(0, 100)}`);
  if (!input.subject.trim()) throw new IntegrationError("gmail", "INVALID_INPUT", "A draft needs a subject.");
}
