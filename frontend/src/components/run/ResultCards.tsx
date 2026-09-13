import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import type {
  CalendarEvent,
  CalendarRecommendation,
  EmailContext,
  EmailDraft,
  GeneratedMaterials,
  JobData,
  MatchData,
  SkillMatch,
  TrackerRecord,
} from "@internflow/shared";
import { ArrowUpRight, Briefcase, CalendarClock, CircleCheck, Clock, ExternalLink, FileText, MapPin, ShieldCheck, TriangleAlert } from "lucide-react";
import { AppIcon } from "@/lib/apps";
import type { AppId } from "@internflow/shared";
import { ApplicationStatusBadge, MatchScoreChip, ScoreRing, SkillIcon, SKILL_STATUS } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/misc";
import { formatDate, formatSlot, formatTime, parseDate, workModeLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

export function ResultCard({
  app,
  title,
  meta,
  children,
  className,
  tone = "default",
}: {
  app: AppId;
  title: string;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
  tone?: "default" | "warning";
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className={cn("rounded-card border bg-surface shadow-card", tone === "warning" ? "border-amber-200" : "border-line", className)}
    >
      <header className="flex items-center gap-2.5 px-4 pt-3.5 pb-2.5">
        <AppIcon app={app} size="xs" />
        <h3 className="flex-1 text-[13px] font-semibold text-ink">{title}</h3>
        {meta}
      </header>
      <div className="px-4 pb-4">{children}</div>
    </motion.section>
  );
}

// ---------------------------------------------------------------------------
// Job analysis
// ---------------------------------------------------------------------------

export function SkillRows({ skills, names, category }: { skills?: SkillMatch[]; names: string[]; category: "required" | "preferred" }) {
  if (!names.length) return <p className="text-[12.5px] text-ink-4">None listed</p>;
  return (
    <ul className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
      {names.map((name) => {
        const match = skills?.find((s) => s.category === category && s.skill.toLowerCase() === name.toLowerCase()) ?? skills?.find((s) => s.skill.toLowerCase() === name.toLowerCase());
        return (
          <li key={name} className="flex min-w-0 items-center gap-1.5 text-[12.5px] leading-5 text-ink-2" title={match ? SKILL_STATUS[match.status].label : undefined}>
            {match ? <SkillIcon status={match.status} /> : <span className="size-3.5 shrink-0 rounded-full border border-dashed border-line-strong" />}
            <span className="truncate">{name}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function JobFacts({ job }: { job: JobData }) {
  const facts = [
    job.location && { icon: MapPin, text: job.location },
    job.workMode && workModeLabel(job.workMode)?.toLowerCase() !== job.location?.trim().toLowerCase() && { icon: Briefcase, text: workModeLabel(job.workMode) },
    job.duration && { icon: Clock, text: job.duration },
    job.deadline && { icon: CalendarClock, text: `Apply by ${formatDate(job.deadline, { year: "numeric" })}` },
  ].filter(Boolean) as { icon: typeof MapPin; text: string }[];
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {facts.map((f, i) => (
        <span key={`${i}-${f.text}`} className="inline-flex items-center gap-1 text-[12.5px] text-ink-3">
          <f.icon className="size-3.5" /> {f.text}
        </span>
      ))}
    </div>
  );
}

export function JobAnalysisCard({ job, match }: { job: JobData; match?: MatchData }) {
  return (
    <ResultCard app="web" title="Job analysis" meta={<Badge size="sm" tone="outline">{job.extractedWith === "llm" ? "AI extracted" : "Parsed"}</Badge>}>
      <p className="text-[15px] leading-5 font-semibold tracking-[-0.01em] text-ink">{job.title}</p>
      <p className="mt-0.5 text-[13px] text-ink-2">{job.company}</p>
      <div className="mt-2">
        <JobFacts job={job} />
      </div>
      <div className="mt-3.5 space-y-3">
        <div>
          <p className="mb-1.5 text-[11px] font-medium tracking-[0.06em] text-ink-3 uppercase">Required skills</p>
          <SkillRows skills={match?.skills} names={job.requirements} category="required" />
        </div>
        {job.preferred.length > 0 && (
          <div>
            <p className="mb-1.5 text-[11px] font-medium tracking-[0.06em] text-ink-3 uppercase">Preferred skills</p>
            <SkillRows skills={match?.skills} names={job.preferred} category="preferred" />
          </div>
        )}
      </div>
    </ResultCard>
  );
}

// ---------------------------------------------------------------------------
// Match
// ---------------------------------------------------------------------------

export function ScoreBreakdown({ match }: { match: MatchData }) {
  const b = match.breakdown;
  const rows = [
    { key: "R", label: "Required", weight: 65, value: b.required.coverage, note: `${b.required.found} found · ${b.required.partial} partial · ${b.required.missing} missing` },
    { key: "P", label: "Preferred", weight: 25, value: b.preferred.coverage, note: `${b.preferred.found} found · ${b.preferred.partial} partial · ${b.preferred.missing} missing` },
    { key: "E", label: "Eligibility", weight: 10, value: b.eligibility.score, note: b.eligibility.note },
  ];
  return (
    <div className="space-y-2.5">
      {rows.map((r) => (
        <div key={r.key}>
          <div className="flex items-baseline justify-between gap-2 text-[12px]">
            <span className="text-ink-2">
              <span className="mr-1 font-mono text-[11px] text-ink-4">{r.key}</span>
              {r.label} <span className="text-ink-4">×{r.weight}</span>
            </span>
            <span className="font-mono text-[11.5px] text-ink-2 tabular">{Math.round(r.value * 100)}%</span>
          </div>
          <Progress value={r.value * 100} className="mt-1 h-1" label={`${r.label} coverage`} />
          <p className="mt-0.5 truncate text-[11px] text-ink-4" title={r.note}>
            {r.note}
          </p>
        </div>
      ))}
    </div>
  );
}

export function MatchScoreCard({ match }: { match: MatchData }) {
  return (
    <ResultCard app="internflow" title="Resume match">
      <div className="flex items-center gap-4">
        <ScoreRing score={match.score} size={104} />
        <div className="min-w-0 flex-1">
          <ScoreBreakdown match={match} />
        </div>
      </div>
      {match.summary && <p className="mt-3 text-[12.5px] leading-5 text-ink-2">{match.summary}</p>}
      <MatchLists match={match} compact />
    </ResultCard>
  );
}

export function MatchLists({ match, compact = false }: { match: MatchData; compact?: boolean }) {
  const partial = match.skills.filter((s) => s.status === "partial");
  // Partial skills already appear under "Potentially relevant" — don't list them twice.
  const missing = match.gaps.filter((g) => !partial.some((p) => g.toLowerCase().startsWith(p.skill.toLowerCase())));
  return (
    <div className={cn("mt-3.5 grid gap-3.5", !compact && "sm:grid-cols-2")}>
      {match.strengths.length > 0 && (
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium tracking-[0.06em] text-emerald-700 uppercase">
            <CircleCheck className="size-3.5" /> Found in resume
          </p>
          <div className="flex flex-wrap gap-1.5">
            {match.strengths.map((s) => (
              <span key={s} className="rounded-md border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[12px] text-emerald-900">
                {s}
              </span>
            ))}
          </div>
        </div>
      )}
      {partial.length > 0 && (
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium tracking-[0.06em] text-amber-700 uppercase">
            <TriangleAlert className="size-3.5" /> Potentially relevant
          </p>
          <div className="flex flex-wrap gap-1.5">
            {partial.map((s) => (
              <span key={s.skill} className="rounded-md border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[12px] text-amber-900" title={s.evidence.join(" · ")}>
                {s.skill}
              </span>
            ))}
          </div>
        </div>
      )}
      {missing.length > 0 && (
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium tracking-[0.06em] text-rose-700 uppercase">
            <SkillIcon status="missing" className="size-3.5" /> Missing / unclear · Not found
          </p>
          <div className="flex flex-wrap gap-1.5">
            {missing.map((s) => (
              <span key={s} className="rounded-md border border-rose-200 bg-rose-50 px-1.5 py-0.5 text-[12px] text-rose-900">
                {s}
              </span>
            ))}
          </div>
        </div>
      )}
      {match.relevantProjects.length > 0 && (
        <div className={cn(!compact && "sm:col-span-2")}>
          <p className="mb-1.5 text-[11px] font-medium tracking-[0.06em] text-ink-3 uppercase">Relevant projects</p>
          <ul className="space-y-1.5">
            {match.relevantProjects.slice(0, compact ? 3 : 10).map((p) => (
              <li key={p.name} className="rounded-lg border border-line bg-canvas px-2.5 py-2">
                <p className="text-[12.5px] font-medium text-ink">{p.name}</p>
                <p className="mt-0.5 text-[12px] leading-[1.1rem] text-ink-3">{p.reason}</p>
                {p.matchedSkills.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {p.matchedSkills.map((s) => (
                      <span key={s} className="rounded bg-surface px-1.5 py-px font-mono text-[10.5px] text-ink-2 ring-1 ring-line">
                        {s}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

export function EmailHistoryCard({ context }: { context: EmailContext }) {
  const latest = context.messages[0];
  return (
    <ResultCard
      app="gmail"
      title="Email history"
      meta={
        context.found ? (
          <Badge size="sm" tone="success">
            Thread found
          </Badge>
        ) : (
          <Badge size="sm" tone="neutral">
            None
          </Badge>
        )
      }
    >
      {context.found ? (
        <div className="space-y-2">
          <p className="text-[13px] font-medium text-ink">Previous communication found</p>
          <dl className="space-y-1 text-[12.5px]">
            {context.recruiter && (
              <div className="flex gap-2">
                <dt className="w-24 shrink-0 text-ink-3">Recruiter</dt>
                <dd className="min-w-0 truncate text-ink-2">
                  {context.recruiter.name ? `${context.recruiter.name} · ` : ""}
                  <span className="font-mono text-[12px]">{context.recruiter.email}</span>
                </dd>
              </div>
            )}
            {context.lastContactAt && (
              <div className="flex gap-2">
                <dt className="w-24 shrink-0 text-ink-3">Last contact</dt>
                <dd className="text-ink-2">{formatDate(context.lastContactAt)}</dd>
              </div>
            )}
            {(context.lastSubject ?? latest?.subject) && (
              <div className="flex gap-2">
                <dt className="w-24 shrink-0 text-ink-3">Subject</dt>
                <dd className="min-w-0 text-ink-2">{context.lastSubject ?? latest?.subject}</dd>
              </div>
            )}
          </dl>
          {latest?.snippet && <p className="rounded-md bg-sunken px-2.5 py-2 text-[12px] leading-[1.15rem] text-ink-3 italic">“{latest.snippet}”</p>}
          <p className="text-[11.5px] text-ink-4">
            {context.messages.length} message{context.messages.length === 1 ? "" : "s"} · the follow-up will reply in context
          </p>
        </div>
      ) : (
        <p className="text-[13px] text-ink-2">{context.summary || "No previous communication found."}</p>
      )}
    </ResultCard>
  );
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

export function GroundingBadge({ materials, className }: { materials: GeneratedMaterials; className?: string }) {
  const g = materials.grounding;
  if (!g) return null;
  return g.verified && g.unsupportedClaims.length === 0 ? (
    <Badge size="sm" tone="success" className={className} title={g.sourcesUsed.join("\n")}>
      <ShieldCheck /> All claims grounded in your resume
    </Badge>
  ) : (
    <Badge size="sm" tone="warning" className={className}>
      <TriangleAlert /> {g.unsupportedClaims.length} claim{g.unsupportedClaims.length === 1 ? "" : "s"} to review
    </Badge>
  );
}

export function MaterialsCard({ materials, applicationId }: { materials: GeneratedMaterials; applicationId?: string }) {
  const answers = materials.answers?.length ?? 0;
  const base = applicationId ? `/app/applications/${applicationId}` : undefined;
  return (
    <ResultCard
      app="internflow"
      title="Materials ready"
      meta={
        <Badge size="sm" tone="outline">
          {materials.generatedWith === "llm" ? "AI written" : "Template"}
        </Badge>
      }
    >
      <GroundingBadge materials={materials} />
      <ul className="mt-2.5 divide-y divide-line rounded-lg border border-line">
        <MaterialRow
          icon={<FileText className="size-4 text-ink-3" />}
          label="Cover letter"
          detail={materials.coverLetter ? `${materials.coverLetter.content.split(/\s+/).length} words` : "Not generated"}
          to={base && materials.coverLetter ? `${base}?tab=cover-letter` : undefined}
        />
        <MaterialRow
          icon={<FileText className="size-4 text-ink-3" />}
          label="Application answers"
          detail={answers ? `${answers} answer${answers === 1 ? "" : "s"}` : "Not generated"}
          to={base && answers ? `${base}?tab=answers` : undefined}
        />
        <MaterialRow icon={<FileText className="size-4 text-ink-3" />} label="Resume match report" detail="Evidence per skill" to={base ? `${base}?tab=match` : undefined} />
      </ul>
      {!base && <p className="mt-2 text-[11.5px] text-ink-4">Editable once the application is saved.</p>}
    </ResultCard>
  );
}

function MaterialRow({ icon, label, detail, to }: { icon: ReactNode; label: string; detail: string; to?: string }) {
  const inner = (
    <>
      {icon}
      <span className="flex-1 text-[12.5px] font-medium text-ink">{label}</span>
      <span className="text-[12px] text-ink-3">{detail}</span>
      {to && <ArrowUpRight className="size-3.5 text-ink-4 transition-colors group-hover:text-accent" />}
    </>
  );
  return (
    <li>
      {to ? (
        <Link to={to} className="group flex items-center gap-2.5 px-3 py-2 hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
          {inner}
        </Link>
      ) : (
        <div className="flex items-center gap-2.5 px-3 py-2">{inner}</div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Tracker
// ---------------------------------------------------------------------------

export function TrackerCard({ record }: { record: TrackerRecord }) {
  return (
    <ResultCard app="notion" title="Notion tracker" meta={<Badge size="sm" tone="success">Synced</Badge>}>
      <div className="overflow-hidden rounded-lg border border-line">
        <dl className="divide-y divide-line text-[12.5px]">
          <TrackerRow label="Company">{record.company}</TrackerRow>
          <TrackerRow label="Role">{record.role}</TrackerRow>
          <TrackerRow label="Status">
            <ApplicationStatusBadge status={record.status} />
          </TrackerRow>
          <TrackerRow label="Match">
            <MatchScoreChip score={record.matchScore} />
          </TrackerRow>
          <TrackerRow label="Follow-up">{record.followUpDate ? formatDate(record.followUpDate, { weekday: "short" }) : <span className="text-ink-4">Not set</span>}</TrackerRow>
        </dl>
      </div>
      {record.url && (
        <a
          href={record.url}
          target="_blank"
          rel="noreferrer"
          className="mt-2.5 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-ink hover:text-accent hover:underline"
        >
          Open in Notion <ExternalLink className="size-3.5" />
        </a>
      )}
    </ResultCard>
  );
}

function TrackerRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-9 items-center gap-3 px-3 py-1.5">
      <dt className="w-20 shrink-0 text-ink-3">{label}</dt>
      <dd className="min-w-0 flex-1 truncate text-ink">{children}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

export function CalendarCard({ recommendation, event }: { recommendation: CalendarRecommendation; event?: CalendarEvent }) {
  const start = parseDate(recommendation.slot.start);
  return (
    <ResultCard app="google_calendar" title="Follow-up time" meta={event ? <Badge size="sm" tone="success">Scheduled</Badge> : <Badge size="sm" tone="outline">Recommended</Badge>}>
      <div className="flex items-center gap-3">
        {start && (
          <div className="flex w-14 shrink-0 flex-col items-center overflow-hidden rounded-lg border border-line text-center">
            <span className="w-full bg-[#4285F4] py-0.5 text-[10px] font-semibold tracking-wide text-white uppercase">
              {start.toLocaleDateString(undefined, { month: "short" })}
            </span>
            <span className="py-1 text-xl leading-6 font-semibold text-ink tabular">{start.getDate()}</span>
          </div>
        )}
        <div className="min-w-0">
          <p className="text-[11px] font-medium tracking-[0.06em] text-ink-3 uppercase">Recommended follow-up</p>
          <p className="text-[13.5px] leading-5 font-semibold text-ink">
            {start?.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })} · {formatTime(recommendation.slot.start)}
          </p>
        </div>
      </div>
      <p className="mt-2.5 text-[12.5px] leading-5 text-ink-2">{recommendation.reason}</p>
      {recommendation.alternatives.length > 0 && (
        <div className="mt-2.5">
          <p className="mb-1 text-[11px] text-ink-3">Alternatives</p>
          <div className="flex flex-wrap gap-1.5">
            {recommendation.alternatives.slice(0, 3).map((a) => (
              <span key={a.start} className="rounded-md border border-line bg-canvas px-1.5 py-0.5 text-[11.5px] text-ink-2">
                {formatDate(a.start, { weekday: "short" })} · {formatTime(a.start)}
              </span>
            ))}
          </div>
        </div>
      )}
      <p className="mt-2.5 text-[11px] text-ink-4">
        {recommendation.eventsConsidered} events checked · {recommendation.timezone}
      </p>
    </ResultCard>
  );
}

// ---------------------------------------------------------------------------
// Follow-up (after approval)
// ---------------------------------------------------------------------------

export function FollowUpCard({ draft, event }: { draft?: EmailDraft; event?: CalendarEvent }) {
  if (!draft && !event) return null;
  return (
    <ResultCard app="gmail" title="Follow-up prepared" meta={<Badge size="sm" tone="success">Approved</Badge>}>
      <div className="space-y-2">
        {draft && (
          <div className="rounded-lg border border-line px-3 py-2.5">
            <div className="flex items-center gap-2">
              <AppIcon app="gmail" size="xs" bare className="size-3.5" />
              <span className="text-[12.5px] font-medium text-ink">Gmail draft created</span>
              <span className="ml-auto text-[11px] text-ink-4">not sent</span>
            </div>
            <p className="mt-1 truncate text-[12.5px] text-ink-2">{draft.subject}</p>
            <p className="truncate text-[11.5px] text-ink-3">To: {draft.to.map((t) => t.email).join(", ")}</p>
            {draft.webLink && (
              <a href={draft.webLink} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:underline">
                Open draft <ExternalLink className="size-3" />
              </a>
            )}
          </div>
        )}
        {event && (
          <div className="rounded-lg border border-line px-3 py-2.5">
            <div className="flex items-center gap-2">
              <AppIcon app="google_calendar" size="xs" bare className="size-3.5" />
              <span className="text-[12.5px] font-medium text-ink">Calendar reminder scheduled</span>
            </div>
            <p className="mt-1 truncate text-[12.5px] text-ink-2">{event.title}</p>
            <p className="text-[11.5px] text-ink-3">{formatSlot(event.start, event.end)}</p>
            {event.htmlLink && (
              <a href={event.htmlLink} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[12px] font-medium text-accent hover:underline">
                Open event <ExternalLink className="size-3" />
              </a>
            )}
          </div>
        )}
      </div>
    </ResultCard>
  );
}
