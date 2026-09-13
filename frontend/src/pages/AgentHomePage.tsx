import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, ChevronDown, FileText, History, Link2, Loader2, Sparkles } from "lucide-react";
import type { ProviderId } from "@internflow/shared";
import { DEMO_JOB_URL } from "@internflow/shared";
import { ApplicationStatusBadge, EmptyState, ErrorState, MatchScoreChip, PageHeader, RunStatusPill } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox, Input, Label, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/misc";
import { useIntegrations, useSettings } from "@/hooks/useAppData";
import { useApplications, useRecentRuns } from "@/hooks/useApplications";
import { api, errorMessage } from "@/lib/api";
import { APPS, APP_ORDER, AppIcon, INTEGRATION_STATUS, StatusDot } from "@/lib/apps";
import { formatRelative } from "@/lib/format";

export function AgentHomePage() {
  const navigate = useNavigate();
  const { settings } = useSettings();
  const { integrations } = useIntegrations();
  const runs = useRecentRuns();
  const apps = useApplications();

  const [mode, setMode] = useState<"url" | "text">("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [showOptions, setShowOptions] = useState(false);
  const [failures, setFailures] = useState<ProviderId[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(undefined);
    if (mode === "url" && !/^https?:\/\/\S+$/i.test(url.trim())) return setError("Enter a valid http(s) job posting URL.");
    if (mode === "text" && text.trim().length < 40) return setError("Paste the full job description (at least a few sentences).");
    setSubmitting(true);
    try {
      const res = await api.startRun({
        ...(mode === "url" ? { jobUrl: url.trim() } : { jobDescription: text.trim() }),
        ...(failures.length ? { options: { simulateFailures: failures } } : {}),
      });
      navigate(`/app/runs/${res.runId}`);
    } catch (err) {
      setError(errorMessage(err));
      setSubmitting(false);
    }
  };

  const counts = (apps.data ?? []).reduce<Record<string, number>>((acc, a) => ({ ...acc, [a.status]: (acc[a.status] ?? 0) + 1 }), {});

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <PageHeader
        title="Start an application workflow"
        description="Give the agent a posting — it will coordinate Web, Drive, Gmail, Notion and Calendar, and ask before taking consequential actions."
      />

      <Card className="p-5 sm:p-6">
        <form onSubmit={submit} className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="job-input" className="text-sm font-medium text-ink">
              {mode === "url" ? "Paste an internship or job posting URL" : "Paste the job description"}
            </Label>
            <button type="button" className="text-[13px] font-medium text-accent hover:underline" onClick={() => setMode(mode === "url" ? "text" : "url")}>
              {mode === "url" ? "Paste job description instead" : "Use a URL instead"}
            </button>
          </div>

          {mode === "url" ? (
            <div className="relative">
              <Link2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-4" />
              <Input id="job-input" className="h-11 pl-9 font-mono text-[13px]" placeholder="https://company.com/careers/software-engineering-intern" value={url} onChange={(e) => setUrl(e.target.value)} />
            </div>
          ) : (
            <Textarea id="job-input" rows={8} placeholder="Software Engineering Intern at …" value={text} onChange={(e) => setText(e.target.value)} />
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setMode("url");
                setUrl(DEMO_JOB_URL);
              }}
              className="inline-flex items-center gap-1.5 rounded-full border border-accent-muted bg-accent-soft px-3 py-1 text-xs font-medium text-accent hover:border-accent-line"
            >
              <Sparkles className="size-3.5" /> Use demo job posting
            </button>
            <button type="button" onClick={() => setShowOptions(!showOptions)} className="inline-flex items-center gap-1 text-xs text-ink-3 hover:text-ink">
              Demo options <ChevronDown className={`size-3.5 transition ${showOptions ? "rotate-180" : ""}`} />
            </button>
          </div>

          {showOptions && (
            <div className="rounded-lg border border-line bg-canvas p-3">
              <p className="mb-2 text-xs text-ink-3">Simulate an outage to show graceful recovery:</p>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {(["google_drive", "gmail", "notion", "google_calendar"] as ProviderId[]).map((id) => (
                  <label key={id} className="flex items-center gap-2 text-[13px] text-ink-2">
                    <Checkbox checked={failures.includes(id)} onChange={(e) => setFailures(e.target.checked ? [...failures, id] : failures.filter((f) => f !== id))} />
                    {APPS[id].label}
                  </label>
                ))}
              </div>
            </div>
          )}

          {error && <p className="text-[13px] text-rose-700">{error}</p>}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-ink-3">
              {settings?.demoMode ? "Demo Mode is on — integrations use realistic mock data." : "Live mode — connected accounts will be used."}
            </p>
            <Button type="submit" size="lg" disabled={submitting}>
              {submitting ? <Loader2 className="animate-spin" /> : <ArrowRight />}
              Start Application Analysis
            </Button>
          </div>
        </form>
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {APP_ORDER.map((id) => {
          const status = integrations?.find((i) => i.id === id)?.status ?? "disconnected";
          return (
            <Link key={id} to="/app/integrations" aria-label={`${APPS[id].label}: ${INTEGRATION_STATUS[status].label}`} className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3 transition hover:border-line-strong">
              <AppIcon app={id} size="sm" />
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium">{APPS[id].label}</p>
                <p className="flex items-center gap-1.5 text-xs text-ink-3">
                  <StatusDot status={status} /> {INTEGRATION_STATUS[status].label}
                </p>
              </div>
            </Link>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Card className="p-0">
          <div className="flex items-center gap-2 border-b border-line px-5 py-3.5">
            <History className="size-4 text-ink-3" />
            <h2 className="text-sm font-semibold">Recent agent runs</h2>
          </div>
          {runs.loading ? (
            <div className="space-y-2 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : runs.error ? (
            <ErrorState message={runs.error} onRetry={() => runs.reload()} compact />
          ) : !runs.data?.length ? (
            <EmptyState icon={Sparkles} title="No runs yet" description="Start with the demo job posting to see the agent coordinate five apps." />
          ) : (
            <ul className="divide-y divide-line">
              {runs.data.slice(0, 8).map((r) => (
                <li key={r.id}>
                  <Link to={`/app/runs/${r.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-sunken/50">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{r.role ?? "Analyzing job…"}</p>
                      <p className="truncate text-xs text-ink-3">
                        {r.company ?? "—"} · {r.toolCalls} tool calls · {formatRelative(r.startedAt)}
                      </p>
                    </div>
                    <MatchScoreChip score={r.matchScore} />
                    <RunStatusPill status={r.status} size="sm" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-0">
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <div className="flex items-center gap-2">
              <FileText className="size-4 text-ink-3" />
              <h2 className="text-sm font-semibold">Application tracker</h2>
            </div>
            <Link to="/app/applications" className="text-xs font-medium text-accent hover:underline">
              View all
            </Link>
          </div>
          <div className="space-y-2 p-5">
            {apps.loading ? (
              <Skeleton className="h-24" />
            ) : (
              <>
                <p className="text-3xl font-semibold">{apps.data?.length ?? 0}</p>
                <p className="text-xs text-ink-3">applications tracked</p>
                <div className="flex flex-wrap gap-2 pt-2">
                  {Object.entries(counts).map(([status, n]) => (
                    <span key={status} className="inline-flex items-center gap-1.5">
                      <ApplicationStatusBadge status={status as never} /> <span className="text-xs text-ink-3">{n}</span>
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
