import type { EmailDraft, EmailMessage } from "@internflow/shared";
import { GMAIL_DRAFTS_LINK, validateDraft } from "../gmail/gmailProvider.js";
import type { DraftInput, GmailProvider } from "../types.js";
import { DEMO_USER, demoEmails } from "./demoData.js";
import { filterEmails } from "./gmailQuery.js";
import { demoDelay } from "./latency.js";

/** Drafts created in Demo Mode, per user, for the server process lifetime. */
const draftsByUser = new Map<string, EmailDraft[]>();

export function listMockDrafts(userId: string): EmailDraft[] {
  return [...(draftsByUser.get(userId) ?? [])];
}

export function resetMockGmail(): void {
  draftsByUser.clear();
}

export class MockGmailProvider implements GmailProvider {
  constructor(private readonly userId: string) {}

  async searchEmails(query: string, opts: { limit?: number } = {}): Promise<EmailMessage[]> {
    await demoDelay();
    const now = new Date();
    return filterEmails(demoEmails(now), query, DEMO_USER.email, now)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, opts.limit ?? 10);
  }

  async createDraft(input: DraftInput): Promise<EmailDraft> {
    await demoDelay();
    validateDraft(input);
    const drafts = draftsByUser.get(this.userId) ?? [];
    const draft: EmailDraft = {
      id: `draft-demo-${drafts.length + 1}`,
      to: input.to,
      subject: input.subject,
      body: input.body,
      createdAt: new Date().toISOString(),
      webLink: GMAIL_DRAFTS_LINK,
    };
    drafts.push(draft);
    draftsByUser.set(this.userId, drafts);
    return draft;
  }
}
