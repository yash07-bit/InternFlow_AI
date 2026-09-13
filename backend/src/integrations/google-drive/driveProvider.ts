/** Google Drive (REST v3) provider: file search and resume text extraction. */
import { extractText } from "unpdf";
import type { GoogleClient } from "../google/oauth.js";
import { normalizeError } from "../http.js";
import { IntegrationError, type DriveFile, type DriveProvider } from "../types.js";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const FILE_FIELDS = "id,name,mimeType,modifiedTime,size,webViewLink";
export const MAX_FILE_TEXT_CHARS = 60_000;
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;

const GOOGLE_DOC = "application/vnd.google-apps.document";
const TEXT_TYPES = new Set(["text/plain", "text/markdown", "text/x-markdown"]);

interface ApiFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size?: string;
  webViewLink?: string;
}

const toDriveFile = (f: ApiFile): DriveFile => ({
  id: f.id,
  name: f.name,
  mimeType: f.mimeType,
  modifiedTime: f.modifiedTime,
  sizeBytes: f.size ? Number(f.size) : undefined,
  webViewLink: f.webViewLink,
});

/** Escapes a value for a single-quoted Drive query string. */
export const escapeDriveQuery = (value: string): string => value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

export const normalizeExtractedText = (text: string): string =>
  text.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_FILE_TEXT_CHARS);

export class GoogleDriveProvider implements DriveProvider {
  constructor(private readonly google: GoogleClient) {}

  async searchFiles(query: string, opts: { limit?: number } = {}): Promise<DriveFile[]> {
    const limit = Math.min(Math.max(opts.limit ?? 10, 1), 50);
    const q = query.trim();
    const escaped = escapeDriveQuery(q);
    const params = new URLSearchParams({
      q: q ? `(name contains '${escaped}' or fullText contains '${escaped}') and trashed = false` : "trashed = false",
      fields: `files(${FILE_FIELDS})`,
      pageSize: String(q ? 50 : limit),
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
    });
    // Drive rejects orderBy on fullText queries ("results are in relevance order"), so we sort newest-first locally.
    if (!q) params.set("orderBy", "modifiedTime desc");
    const res = await this.google.json<{ files?: ApiFile[] }>("google_drive", `${DRIVE_API}/files?${params}`);
    return (res.files ?? [])
      .map(toDriveFile)
      .sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime))
      .slice(0, limit);
  }

  async getFileText(fileId: string): Promise<{ file: DriveFile; text: string }> {
    if (!fileId.trim()) throw new IntegrationError("google_drive", "INVALID_INPUT", "A Drive file id is required.");
    const id = encodeURIComponent(fileId);
    const meta = await this.google.json<ApiFile>("google_drive", `${DRIVE_API}/files/${id}?fields=${FILE_FIELDS}&supportsAllDrives=true`);
    const file = toDriveFile(meta);

    if (file.mimeType === GOOGLE_DOC) {
      const res = await this.google.request("google_drive", `${DRIVE_API}/files/${id}/export?mimeType=text/plain`);
      return { file, text: normalizeExtractedText(await res.text()) };
    }

    if (file.mimeType !== "application/pdf" && !TEXT_TYPES.has(file.mimeType)) {
      throw new IntegrationError(
        "google_drive",
        "INVALID_INPUT",
        `Unsupported resume format (${file.mimeType}). Use a Google Doc, PDF, or plain-text/Markdown file.`,
      );
    }
    if ((file.sizeBytes ?? 0) > MAX_DOWNLOAD_BYTES) {
      throw new IntegrationError("google_drive", "INVALID_INPUT", `"${file.name}" is too large to read (max 20 MB).`);
    }

    const res = await this.google.request("google_drive", `${DRIVE_API}/files/${id}?alt=media&supportsAllDrives=true`);
    if (TEXT_TYPES.has(file.mimeType)) return { file, text: normalizeExtractedText(await res.text()) };

    let text: string;
    try {
      const pdf = await extractText(new Uint8Array(await res.arrayBuffer()), { mergePages: true });
      text = normalizeExtractedText(pdf.text);
    } catch (err) {
      if (err instanceof IntegrationError) throw err;
      if (normalizeError("google_drive", err).code === "TIMEOUT") throw normalizeError("google_drive", err);
      throw new IntegrationError("google_drive", "INVALID_INPUT", `Could not extract text from "${file.name}" (the PDF may be corrupted).`);
    }
    if (!text) {
      throw new IntegrationError("google_drive", "INVALID_INPUT", `"${file.name}" contains no extractable text (it may be a scanned image).`);
    }
    return { file, text };
  }
}
