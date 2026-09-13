import { IntegrationError, type DriveFile, type DriveProvider } from "../types.js";
import { MAX_FILE_TEXT_CHARS } from "../google-drive/driveProvider.js";
import { DEMO_DRIVE_FILES, type DemoDriveFile } from "./demoData.js";
import { demoDelay } from "./latency.js";

const STOP_WORDS = new Set(["my", "the", "a", "an", "latest", "newest", "recent", "current", "file", "files", "document", "doc", "of", "for", "and"]);
const SYNONYMS: Record<string, string> = { cv: "resume", "résumé": "resume", curriculum: "resume", vitae: "resume" };

const toDriveFile = (f: DemoDriveFile, now: Date): DriveFile => ({
  id: f.id,
  name: f.name,
  mimeType: f.mimeType,
  modifiedTime: new Date(now.getTime() - f.daysAgoModified * 86_400_000).toISOString(),
  sizeBytes: f.sizeBytes,
  webViewLink: `https://drive.google.com/file/d/${f.id}/view`,
});

export class MockDriveProvider implements DriveProvider {
  async searchFiles(query: string, opts: { limit?: number } = {}): Promise<DriveFile[]> {
    await demoDelay();
    const terms = query
      .toLowerCase()
      .replace(/["'()]/g, " ")
      .split(/[\s,]+/)
      .map((t) => SYNONYMS[t] ?? t)
      .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
    const now = new Date();
    // Files matching more terms rank first; ties (e.g. two resumes) are newest first.
    return DEMO_DRIVE_FILES.map((f) => {
      const haystack = `${f.name}\n${f.text}`.toLowerCase();
      return { f, score: terms.length ? terms.filter((t) => haystack.includes(t)).length : 1 };
    })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.f.daysAgoModified - b.f.daysAgoModified)
      .slice(0, opts.limit ?? 10)
      .map((x) => toDriveFile(x.f, now));
  }

  async getFileText(fileId: string): Promise<{ file: DriveFile; text: string }> {
    await demoDelay();
    const file = DEMO_DRIVE_FILES.find((f) => f.id === fileId);
    if (!file) throw new IntegrationError("google_drive", "NOT_FOUND", `Google Drive file "${fileId}" was not found.`);
    return { file: toDriveFile(file, new Date()), text: file.text.slice(0, MAX_FILE_TEXT_CHARS) };
  }
}
