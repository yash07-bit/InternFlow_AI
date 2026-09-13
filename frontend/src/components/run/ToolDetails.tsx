import { useState, type ReactNode } from "react";
import type { AgentRun, ToolCallRecord } from "@internflow/shared";
import { Braces, Check, Copy } from "lucide-react";
import { SkillIcon } from "@/components/common";
import { formatDate, formatDuration, formatSlot } from "@/lib/format";
import { copyToClipboard, isRecord } from "@/lib/utils";
import { cn } from "@/lib/utils";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] gap-3 py-1 text-[12.5px] leading-5">
      <dt className="text-ink-3">{label}</dt>
      <dd className="min-w-0 break-words text-ink-2">{children}</dd>
    </div>
  );
}

function formatValue(value: unknown): ReactNode {
  if (value == null) return <span className="text-ink-4">—</span>;
  if (typeof value === "string") return value.length > 240 ? `${value.slice(0, 240)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return <span className="font-mono text-[12px]">{String(value)}</span>;
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v === "string" || typeof v === "number")) {
      return value.length ? value.join(", ") : <span className="text-ink-4">none</span>;
    }
    return <span className="text-ink-3">{value.length} item{value.length === 1 ? "" : "s"}</span>;
  }
  if (isRecord(value)) {
    const keys = Object.keys(value);
    return <span className="text-ink-3">{`{ ${keys.slice(0, 4).join(", ")}${keys.length > 4 ? ", …" : ""} }`}</span>;
  }
  return String(value);
}

function humanKey(key: string): string {
  const s = key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Tool-specific, human-friendly view using the structured workflow data the tool produced. */
function KnownToolView({ toolCall, run }: { toolCall: ToolCallRecord; run: AgentRun }) {
  const w = run.workflow;
  const detail = isRecord(toolCall.detail) ? toolCall.detail : undefined;
  if (toolCall.status !== "completed") return null;

  switch (toolCall.tool) {
    case "analyze_job":
      if (!w.job) return null;
      return (
        <dl>
          <Row label="Role">{w.job.title}</Row>
          <Row label="Company">{w.job.company}</Row>
          {w.job.location && <Row label="Location">{w.job.location}</Row>}
          <Row label="Required">{w.job.requirements.join(", ") || "—"}</Row>
          <Row label="Preferred">{w.job.preferred.join(", ") || "—"}</Row>
          <Row label="Extracted with">{w.job.extractedWith === "llm" ? "AI extraction" : "Heuristic parser"}</Row>
        </dl>
      );
    case "search_drive": {
      const files = Array.isArray(detail?.files) ? (detail.files as unknown[]).filter(isRecord) : [];
      if (!files.length) return null;
      return (
        <ul className="space-y-1">
          {files.slice(0, 6).map((f, i) => (
            <li key={String(f.id ?? i)} className="flex items-center justify-between gap-3 text-[12.5px]">
              <span className="truncate text-ink-2">{String(f.name ?? "Untitled")}</span>
              {typeof f.modifiedTime === "string" && <span className="shrink-0 font-mono text-[11px] text-ink-4">{formatDate(f.modifiedTime)}</span>}
            </li>
          ))}
        </ul>
      );
    }
    case "get_resume":
      if (!w.resume) return null;
      return (
        <dl>
          <Row label="File">{w.resume.fileName}</Row>
          <Row label="Candidate">{w.resume.candidate.name}</Row>
          <Row label="Skills">{w.resume.skills.join(", ")}</Row>
          <Row label="Projects">{w.resume.projects.map((p) => p.name).join(", ") || "—"}</Row>
        </dl>
      );
    case "match_resume":
      if (!w.match) return null;
      return (
        <div className="space-y-2">
          <p className="text-[12.5px] text-ink-2">
            Score <span className="font-semibold text-ink">{w.match.score}%</span> = round(65·R + 25·P + 10·E) with R=
            {w.match.breakdown.required.coverage.toFixed(2)}, P={w.match.breakdown.preferred.coverage.toFixed(2)}, E=
            {w.match.breakdown.eligibility.score.toFixed(2)}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {w.match.skills.map((s) => (
              <span key={`${s.category}-${s.skill}`} className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-1.5 py-0.5 text-[11.5px] text-ink-2">
                <SkillIcon status={s.status} className="size-3" /> {s.skill}
              </span>
            ))}
          </div>
        </div>
      );
    case "search_gmail":
      if (!w.emailContext) return null;
      return (
        <div className="space-y-1.5">
          <p className="font-mono text-[11.5px] text-ink-3">query: {w.emailContext.query}</p>
          {w.emailContext.messages.slice(0, 4).map((m) => (
            <div key={m.id} className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-[12px]">
              <div className="flex justify-between gap-2">
                <span className="truncate font-medium text-ink-2">{m.subject}</span>
                <span className="shrink-0 font-mono text-[11px] text-ink-4">{formatDate(m.date)}</span>
              </div>
              <p className="truncate text-ink-3">{m.from.name ?? m.from.email}</p>
            </div>
          ))}
          {!w.emailContext.messages.length && <p className="text-[12.5px] text-ink-3">No matching threads.</p>}
        </div>
      );
    case "check_calendar":
      if (!w.calendarRecommendation) return null;
      return (
        <dl>
          <Row label="Recommended">{formatSlot(w.calendarRecommendation.slot.start, w.calendarRecommendation.slot.end)}</Row>
          <Row label="Events checked">{w.calendarRecommendation.eventsConsidered}</Row>
          <Row label="Timezone">{w.calendarRecommendation.timezone}</Row>
        </dl>
      );
    case "create_application_record":
    case "update_application_record":
      if (!w.trackerRecord) return null;
      return (
        <dl>
          <Row label="Company">{w.trackerRecord.company}</Row>
          <Row label="Role">{w.trackerRecord.role}</Row>
          <Row label="Status">{w.trackerRecord.status}</Row>
          {w.trackerRecord.followUpDate && <Row label="Follow-up">{formatDate(w.trackerRecord.followUpDate)}</Row>}
        </dl>
      );
    case "generate_cover_letter":
      if (!w.generatedMaterials?.coverLetter) return null;
      return (
        <p className="line-clamp-4 text-[12.5px] leading-5 whitespace-pre-line text-ink-2">{w.generatedMaterials.coverLetter.content}</p>
      );
    default:
      return null;
  }
}

export function ToolDetails({ toolCall, run }: { toolCall: ToolCallRecord; run: AgentRun }) {
  const [showRaw, setShowRaw] = useState(false);
  const [copied, setCopied] = useState(false);
  const inputEntries = Object.entries(toolCall.input ?? {});
  const detailEntries = isRecord(toolCall.detail) ? Object.entries(toolCall.detail).slice(0, 8) : [];
  const raw = JSON.stringify({ tool: toolCall.tool, input: toolCall.input, detail: toolCall.detail, error: toolCall.error }, null, 2);

  return (
    <div className="space-y-3 rounded-lg border border-line bg-canvas px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-ink-3">
        <span>app: {toolCall.app}</span>
        <span>risk: {toolCall.riskLevel}</span>
        {toolCall.durationMs != null && <span>duration: {formatDuration(toolCall.durationMs)}</span>}
        <span className="truncate">id: {toolCall.id}</span>
      </div>

      {toolCall.error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-2.5 py-2 text-[12.5px] text-rose-800">
          <span className="font-mono text-[11px] font-semibold">{toolCall.error.code}</span> · {toolCall.error.message}
          {toolCall.error.retryable && <span className="text-rose-600"> · retryable</span>}
        </div>
      )}

      {inputEntries.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] font-medium tracking-wide text-ink-3 uppercase">Input</p>
          <dl>
            {inputEntries.slice(0, 6).map(([k, v]) => (
              <Row key={k} label={humanKey(k)}>
                {formatValue(v)}
              </Row>
            ))}
          </dl>
        </div>
      )}

      <div>
        <p className="mb-1 text-[11px] font-medium tracking-wide text-ink-3 uppercase">Result</p>
        <KnownOrGeneric toolCall={toolCall} run={run} detailEntries={detailEntries} />
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setShowRaw((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 font-mono text-[11px] text-ink-3 hover:bg-sunken hover:text-ink"
          aria-expanded={showRaw}
        >
          <Braces className="size-3.5" /> {showRaw ? "Hide" : "View"} raw JSON
        </button>
        {showRaw && (
          <button
            type="button"
            onClick={async () => {
              if (await copyToClipboard(raw)) {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 font-mono text-[11px] text-ink-3 hover:bg-sunken hover:text-ink"
          >
            {copied ? <Check className="size-3.5 text-emerald-600" /> : <Copy className="size-3.5" />} {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>
      {showRaw && (
        <pre className={cn("max-h-72 overflow-auto rounded-md border border-line bg-surface p-3 font-mono text-[11.5px] leading-[1.55] text-ink-2")}>{raw}</pre>
      )}
    </div>
  );
}

function KnownOrGeneric({
  toolCall,
  run,
  detailEntries,
}: {
  toolCall: ToolCallRecord;
  run: AgentRun;
  detailEntries: [string, unknown][];
}) {
  const hasKnown = hasKnownView(toolCall, run);
  if (hasKnown) return <KnownToolView toolCall={toolCall} run={run} />;
  if (detailEntries.length) {
    return (
      <dl>
        {detailEntries.map(([k, v]) => (
          <Row key={k} label={humanKey(k)}>
            {formatValue(v)}
          </Row>
        ))}
      </dl>
    );
  }
  return <p className="text-[12.5px] text-ink-3">{toolCall.summary ?? (toolCall.status === "running" ? toolCall.activity : "No structured result.")}</p>;
}

function hasKnownView(toolCall: ToolCallRecord, run: AgentRun): boolean {
  if (toolCall.status !== "completed") return false;
  const w = run.workflow;
  switch (toolCall.tool) {
    case "analyze_job":
      return !!w.job;
    case "search_drive":
      return isRecord(toolCall.detail) && Array.isArray(toolCall.detail.files) && toolCall.detail.files.length > 0;
    case "get_resume":
      return !!w.resume;
    case "match_resume":
      return !!w.match;
    case "search_gmail":
      return !!w.emailContext;
    case "check_calendar":
      return !!w.calendarRecommendation;
    case "create_application_record":
    case "update_application_record":
      return !!w.trackerRecord;
    case "generate_cover_letter":
      return !!w.generatedMaterials?.coverLetter;
    default:
      return false;
  }
}
