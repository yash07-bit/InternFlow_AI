import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, ArrowRight, CheckCircle2, CircleDashed, Clock, Loader2, RotateCcw, SearchX, ShieldCheck, XCircle } from "lucide-react";
import { motion } from "framer-motion";
import type { AgentRun, Approval, ApprovalAction, CalendarEventPayload, GmailDraftPayload } from "@internflow/shared";
import { EmptyState, ErrorState, RiskBadge, RunStatusPill } from "@/components/common";
import { ActivityTimeline, TimelineSkeleton } from "@/components/run/ActivityTimeline";
import { OrchestrationPanel } from "@/components/run/OrchestrationPanel";
import { CalendarCard, EmailHistoryCard, FollowUpCard, JobAnalysisCard, MatchScoreCard, MaterialsCard, TrackerCard } from "@/components/run/ResultCards";
import { WorkflowStepper } from "@/components/run/WorkflowStepper";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Checkbox, Input, Label, Textarea } from "@/components/ui/input";
import { Progress } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toaster";
import { engineLabel } from "@/hooks/useAppData";
import { useAgentRun } from "@/hooks/useAgentRun";
import { api, errorMessage } from "@/lib/api";
import { AppIcon } from "@/lib/apps";
import { formatElapsed, isActiveStatus, isoToLocalInput, localInputToIso } from "@/lib/format";
import { deriveChecklist, pendingApproval, runTitle } from "@/lib/workflow";

export function RunPage() {
  const { id } = useParams();
  const { run, loading, error, notFound, applyApproval } = useAgentRun(id);

  if (loading && !run) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <TimelineSkeleton />
      </div>
    );
  }
  if (!run) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        {notFound ? (
          <EmptyState
            icon={SearchX}
            title="Run not found"
            description="This agent run doesn't exist or was removed."
            action={
              <Button asChild>
                <Link to="/app">Start a new run</Link>
              </Button>
            }
          />
        ) : (
          <ErrorState title="Couldn't load this run" message={error ?? undefined} onRetry={() => window.location.reload()} />
        )}
      </div>
    );
  }

  const w = run.workflow;
  const approval = pendingApproval(run);
  const { title, company } = runTitle(run);

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-3">Agent run</p>
          <h1 className="mt-1 truncate text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-ink-3">{company ?? "Analyzing job posting…"}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RunStatusPill status={run.status} />
          <Elapsed run={run} />
          <Badge tone={run.mode === "demo" ? "accent" : "info"}>{run.mode === "demo" ? "Demo Mode" : "Live"}</Badge>
          <Badge tone="outline">{engineLabel(run.llm)}</Badge>
        </div>
      </div>

      <WorkflowStepper run={run} />

      {approval && <ApprovalPanel run={run} approval={approval} onResolved={applyApproval} />}
      {run.status === "COMPLETED" && <CompletionSummary run={run} />}
      {run.status === "FAILED" && <FailedPanel run={run} />}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] [&>*]:min-w-0">
        <Card className="p-0">
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h2 className="text-sm font-semibold">Agent activity</h2>
            <span className="font-mono text-xs text-ink-3">{run.toolCalls.length} tool calls</span>
          </div>
          <div className="p-4 sm:p-5">
            <ActivityTimeline run={run} />
          </div>
        </Card>

        <div className="space-y-4">
          <OrchestrationPanel run={run} />
          {w.job && <JobAnalysisCard job={w.job} match={w.match} />}
          {w.match && <MatchScoreCard match={w.match} />}
          {w.emailContext && <EmailHistoryCard context={w.emailContext} />}
          {w.generatedMaterials && <MaterialsCard materials={w.generatedMaterials} applicationId={run.applicationId} />}
          {w.trackerRecord && <TrackerCard record={w.trackerRecord} />}
          {w.calendarRecommendation && <CalendarCard recommendation={w.calendarRecommendation} event={w.calendarEvent} />}
          {(w.followUpDraft || w.calendarEvent) && <FollowUpCard draft={w.followUpDraft} event={w.calendarEvent} />}
        </div>
      </div>
    </div>
  );
}

function Elapsed({ run }: { run: AgentRun }) {
  const [now, setNow] = useState(Date.now());
  const active = isActiveStatus(run.status);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  const end = run.completedAt ? Date.parse(run.completedAt) : now;
  return (
    <Badge tone="outline" className="font-mono">
      <Clock /> {formatElapsed(Math.max(0, end - Date.parse(run.startedAt)))}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Approval
// ---------------------------------------------------------------------------

function ApprovalPanel({ run, approval, onResolved }: { run: AgentRun; approval: Approval; onResolved: (a: Approval) => void }) {
  const toast = useToast();
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState<"approve" | "reject">();
  const checklist = deriveChecklist(run).filter((c) => c.state === "done").slice(0, 6);

  const decide = async (kind: "approve" | "reject", body: Parameters<typeof api.approve>[1] = {}) => {
    setBusy(kind);
    try {
      const res = kind === "approve" ? await api.approve(approval.id, body) : await api.reject(approval.id);
      onResolved(res.approval);
      setReviewing(false);
      toast({ title: kind === "approve" ? "Approved — the agent is continuing" : "Actions declined", variant: kind === "approve" ? "success" : "info" });
    } catch (err) {
      toast({ title: "Couldn't submit your decision", description: errorMessage(err), variant: "error" });
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="lg:sticky lg:top-16 lg:z-20">
      <Card className="border-amber-300 bg-amber-50/70 p-5 shadow-lg shadow-amber-900/5">
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div className="min-w-0 space-y-3">
            <div className="flex items-center gap-2 text-amber-900">
              <AlertTriangle className="size-5" />
              <h2 className="text-base font-semibold">Approval required</h2>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {checklist.map((c) => (
                <span key={c.label} className="inline-flex items-center gap-1.5 text-[13px] text-ink-2">
                  <CheckCircle2 className="size-3.5 text-emerald-600" /> {c.label}
                </span>
              ))}
            </div>
            <div className="text-sm">
              <span className="text-ink-3">Next action: </span>
              {approval.actions.map((a, i) => (
                <span key={a.id} className="font-medium text-ink">
                  {i > 0 && " · "}
                  {a.title}
                </span>
              ))}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button variant="warning" onClick={() => decide("approve")} disabled={!!busy}>
              {busy === "approve" ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Approve
            </Button>
            <Button variant="secondary" onClick={() => setReviewing(true)} disabled={!!busy}>
              Review
            </Button>
            <Button variant="danger" onClick={() => decide("reject")} disabled={!!busy}>
              {busy === "reject" ? <Loader2 className="animate-spin" /> : <XCircle />} Cancel
            </Button>
          </div>
        </div>
      </Card>
      <ReviewDialog open={reviewing} onOpenChange={setReviewing} approval={approval} busy={!!busy} onApprove={(body) => decide("approve", body)} />
    </motion.div>
  );
}

function ReviewDialog({
  open,
  onOpenChange,
  approval,
  busy,
  onApprove,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  approval: Approval;
  busy: boolean;
  onApprove: (body: { actionIds: string[]; edits: Record<string, Record<string, unknown>> }) => void;
}) {
  const [selected, setSelected] = useState<string[]>(() => approval.actions.map((a) => a.id));
  const [edits, setEdits] = useState<Record<string, Record<string, unknown>>>({});
  const payloadOf = (a: ApprovalAction) => ({ ...a.payload, ...edits[a.id] });
  const edit = (id: string, patch: Record<string, unknown>) => setEdits((e) => ({ ...e, [id]: { ...e[id], ...patch } }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Review before approving</DialogTitle>
          <DialogDescription>Nothing is sent. Edit the details, untick anything you don't want, then approve.</DialogDescription>
        </DialogHeader>
        <DialogBody className="max-h-[65vh] space-y-4 overflow-y-auto">
          {approval.actions.map((a) => {
            const p = payloadOf(a);
            const on = selected.includes(a.id);
            return (
              <div key={a.id} className={`rounded-xl border p-4 ${on ? "border-line bg-surface" : "border-dashed border-line bg-sunken/50 opacity-70"}`}>
                <label className="flex items-start gap-3">
                  <Checkbox className="mt-1" checked={on} onChange={(e) => setSelected(e.target.checked ? [...selected, a.id] : selected.filter((s) => s !== a.id))} />
                  <AppIcon app={a.app} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium">{a.title}</p>
                      <RiskBadge risk={a.riskLevel} />
                    </div>
                    <p className="mt-0.5 text-[13px] text-ink-3">{a.description}</p>
                  </div>
                </label>
                {on && a.type === "CREATE_GMAIL_DRAFT" && (
                  <div className="mt-4 space-y-3 pl-7">
                    <Field label="To">
                      <Input value={(p as unknown as GmailDraftPayload).to.map((t) => t.email).join(", ")} readOnly className="font-mono text-[13px]" />
                    </Field>
                    <Field label="Subject">
                      <Input value={(p as unknown as GmailDraftPayload).subject} onChange={(e) => edit(a.id, { subject: e.target.value })} />
                    </Field>
                    <Field label="Body">
                      <Textarea rows={9} value={(p as unknown as GmailDraftPayload).body} onChange={(e) => edit(a.id, { body: e.target.value })} />
                    </Field>
                  </div>
                )}
                {on && a.type === "CREATE_CALENDAR_EVENT" && (
                  <div className="mt-4 grid gap-3 pl-7 sm:grid-cols-2">
                    <Field label="Title" className="sm:col-span-2">
                      <Input value={(p as unknown as CalendarEventPayload).title} onChange={(e) => edit(a.id, { title: e.target.value })} />
                    </Field>
                    <Field label="Start">
                      <Input
                        type="datetime-local"
                        value={isoToLocalInput((p as unknown as CalendarEventPayload).start)}
                        onChange={(e) => {
                          const start = localInputToIso(e.target.value);
                          if (start) edit(a.id, { start, end: new Date(Date.parse(start) + 30 * 60_000).toISOString() });
                        }}
                      />
                    </Field>
                    <Field label="End">
                      <Input type="datetime-local" value={isoToLocalInput((p as unknown as CalendarEventPayload).end)} onChange={(e) => edit(a.id, { end: localInputToIso(e.target.value) })} />
                    </Field>
                  </div>
                )}
              </div>
            );
          })}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button variant="warning" disabled={busy || selected.length === 0} onClick={() => onApprove({ actionIds: selected, edits })}>
            {busy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Approve {selected.length} action{selected.length === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <Label className="mb-1 block text-xs text-ink-3">{label}</Label>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

function CompletionSummary({ run }: { run: AgentRun }) {
  const stats = run.stats;
  const checklist = deriveChecklist(run);
  const final = [...run.messages].reverse().find((m) => m.kind === "final");

  return (
    <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.35 }}>
      <Card className="overflow-hidden border-emerald-200 p-0">
        <div className="grid md:grid-cols-[1.1fr_1fr]">
          <div className="space-y-4 p-6">
            <div className="flex items-center gap-2 text-emerald-700">
              <CheckCircle2 className="size-5" />
              <p className="text-xs font-semibold uppercase tracking-[0.14em]">Application workflow complete</p>
            </div>
            {final && <p className="text-[15px] leading-7 text-ink-2">{final.text}</p>}
            <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
              {checklist.map((c) => (
                <li key={c.label} className="flex items-center justify-between gap-2 border-b border-dashed border-line py-1 text-[13px]">
                  <span className="text-ink-2">{c.label}</span>
                  {c.state === "done" ? (
                    <CheckCircle2 className="size-4 text-emerald-600" />
                  ) : c.state === "failed" ? (
                    <AlertTriangle className="size-4 text-amber-600" />
                  ) : (
                    <CircleDashed className="size-4 text-ink-4" />
                  )}
                </li>
              ))}
            </ul>
            {run.workflow.warnings.length > 0 && (
              <div className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900">
                {run.workflow.warnings.map((wa) => (
                  <p key={wa} className="flex gap-2">
                    {/untrusted/i.test(wa) ? <ShieldCheck className="mt-0.5 size-4 shrink-0" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" />} {wa}
                  </p>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-col justify-between gap-6 bg-ink p-6 text-white">
            <div className="grid grid-cols-2 gap-4">
              <Stat value={stats?.appsCoordinated.length ?? 0} label="apps coordinated" />
              <Stat value={stats?.agentActions ?? 0} label="agent actions" />
              <Stat value={run.applicationId ? 1 : 0} label="application prepared" />
              <Stat value={0} label="context switching" />
            </div>
            <p className="font-mono text-xs text-white/50">
              {stats?.toolCalls ?? 0} tool calls · {stats?.approvals ?? 0} human approval{stats?.approvals === 1 ? "" : "s"}
            </p>
            <div>
              <div className="mb-2 flex items-center justify-between text-xs text-white/70">
                <span>Application readiness</span>
                <span className="font-mono text-white">{stats?.readiness ?? 0}%</span>
              </div>
              <Progress value={stats?.readiness ?? 0} className="bg-white/15" indicatorClassName="bg-emerald-400" />
            </div>
            {run.applicationId && (
              <Button asChild className="bg-white text-ink hover:bg-white/90">
                <Link to={`/app/applications/${run.applicationId}`}>
                  View Application <ArrowRight />
                </Link>
              </Button>
            )}
          </div>
        </div>
      </Card>
    </motion.div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <p className="text-3xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-white/60">{label}</p>
    </div>
  );
}

function FailedPanel({ run }: { run: AgentRun }) {
  const navigate = useNavigate();
  const retry = async () => {
    const res = await api.startRun(run.input);
    navigate(`/app/runs/${res.runId}`);
  };
  return (
    <Card className="flex flex-col gap-3 border-rose-200 bg-rose-50/60 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex gap-3">
        <XCircle className="mt-0.5 size-5 text-rose-600" />
        <div>
          <p className="text-sm font-semibold text-rose-900">The workflow couldn't finish</p>
          <p className="text-[13px] text-rose-800">{run.error ?? "Something went wrong."}</p>
        </div>
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" asChild>
          <Link to="/app">New run</Link>
        </Button>
        <Button onClick={retry}>
          <RotateCcw /> Run again
        </Button>
      </div>
    </Card>
  );
}
