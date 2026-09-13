import type { ProviderSet, WebProvider } from "../types.js";
import { HttpWebProvider } from "../web/webProvider.js";
import { MockCalendarProvider, resetMockCalendar } from "./mockCalendar.js";
import { MockDriveProvider } from "./mockDrive.js";
import { MockGmailProvider, resetMockGmail } from "./mockGmail.js";
import { MockNotionProvider, resetMockNotion } from "./mockNotion.js";
import { DemoAwareWebProvider } from "./mockWeb.js";

export { listMockDrafts } from "./mockGmail.js";

/** Demo Mode provider set. Mock state is per user and lives for the server process lifetime. */
export function createMockProviders(userId: string, realWeb: WebProvider = new HttpWebProvider()): ProviderSet {
  return {
    drive: new MockDriveProvider(),
    gmail: new MockGmailProvider(userId),
    calendar: new MockCalendarProvider(userId),
    notion: new MockNotionProvider(userId),
    web: new DemoAwareWebProvider(realWeb),
  };
}

/** Test hook: clears in-memory drafts, calendar events and tracker rows. */
export function resetMockState(): void {
  resetMockGmail();
  resetMockCalendar();
  resetMockNotion();
}
