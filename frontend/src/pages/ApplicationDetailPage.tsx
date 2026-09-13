import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, Copy, ExternalLink, Loader2, RefreshCw, Save } from "lucide-react";
import type { Application, ApplicationStatus } from "@internflow/shared";
import { APPLICATION_STATUSES } from "@internflow/shared";
import { ErrorState, ScoreRing } from "@/components/common";
import { GroundingBadge, JobAnalysisCard, MatchLists, ScoreBreakdown } from "@/components/run/ResultCards";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { NativeSelect, Textarea } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/misc";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toaster";
import { useApplication } from "@/hooks/useApplications";
import { api, errorMessage } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { copyToClipboard } from "@/lib/utils";

export function ApplicationDetailPage() {
  const { id } = useParams();
  const { data: app, loading, error, reload, setData } = useApplication(id);
  const toast = useToast();

  if (loading) return <div className="mx-auto max-w-5xl space-y-4 px-4 py-8"><Skeleton className="h-28" /><Skeleton className="h-96" /></div>;
  if (error || !app) return <div className="mx-auto max-w-3xl px-4 py-16"><ErrorState message={error} onRetry={() => reload()} /></div>;

  const update = async (body: Parameters<typeof api.updateApplication>[1], success: string) => {
    try {
      setData(await api.updateApplication(app.id, body));
      toast({ title: success, variant: "success" });
    } catch (err) {
      toast({ title: "Couldn't save", description: errorMessage(err), variant: "error" });
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-8 sm:px-6">
      <Link to="/app/applications" className="inline-flex items-center gap-1 text-[13px] text-ink-3 hover:text-ink">
        <ArrowLeft className="size-4" /> Applications
      </Link>

      <Card className="flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">{app.role}</h1>
          <p className="text-sm text-ink-3">
            {app.company}
            {app.location ? ` · ${app.location}` : ""}
            {app.followUpDate ? ` · Follow-up ${formatDate(app.followUpDate, { month: "short", day: "numeric" })}` : ""}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect className="h-8 w-40 text-[13px]" value={app.status} onChange={(e) => update({ status: e.target.value as ApplicationStatus }, "Status updated")} aria-label="Status">
              {APPLICATION_STATUSES.map((s) => <option key={s}>{s}</option>)}
            </NativeSelect>
            {app.jobUrl && <LinkOut href={app.jobUrl}>Job posting</LinkOut>}
            {app.tracker?.url && <LinkOut href={app.tracker.url}>Notion page</LinkOut>}
            {app.latestRunId && (
              <Link to={`/app/runs/${app.latestRunId}`} className="text-[13px] text-accent hover:underline">
                Agent run
              </Link>
            )}
          </div>
        </div>
        {app.matchScore !== undefined && <ScoreRing score={app.matchScore} size={96} />}
      </Card>

      <Tabs defaultValue={app.materials ? "cover" : "job"}>
        <TabsList>
          <TabsTrigger value="cover">Cover Letter</TabsTrigger>
          <TabsTrigger value="answers">Application Answers</TabsTrigger>
          <TabsTrigger value="match">Resume Match</TabsTrigger>
          <TabsTrigger value="job">Job Analysis</TabsTrigger>
        </TabsList>

        <TabsContent value="cover">
          <CoverLetterTab app={app} setApp={setData} onSave={update} />
        </TabsContent>
        <TabsContent value="answers">
          <AnswersTab app={app} setApp={setData} onSave={update} />
        </TabsContent>
        <TabsContent value="match">
          {app.match ? (
            <Card className="space-y-5 p-5">
              <ScoreBreakdown match={app.match} />
              <MatchLists match={app.match} />
            </Card>
          ) : (
            <Card className="p-8 text-center text-sm text-ink-3">No resume match for this application yet.</Card>
          )}
        </TabsContent>
        <TabsContent value="job">
          {app.job ? <JobAnalysisCard job={app.job} match={app.match} /> : <Card className="p-8 text-center text-sm text-ink-3">This application was added manually — no job analysis.</Card>}
        </TabsContent>
      </Tabs>
    </div>
  );
}

type TabProps = {
  app: Application;
  setApp: (a: Application) => void;
  onSave: (body: Parameters<typeof api.updateApplication>[1], success: string) => Promise<void>;
};

function useRegenerate(app: Application, setApp: (a: Application) => void, kind: "cover_letter" | "answers") {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      setApp(await api.regenerateMaterials(app.id, { kind }));
      toast({ title: "Regenerated from your resume", variant: "success" });
    } catch (err) {
      toast({ title: "Couldn't regenerate", description: errorMessage(err), variant: "error" });
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

function MaterialsToolbar({ app, onCopy, onSave, dirty, regen, onApprove }: { app: Application; onCopy: () => void; onSave: () => void; dirty: boolean; regen: { busy: boolean; run: () => void }; onApprove: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        {app.materials && <GroundingBadge materials={app.materials} />}
        {app.materials && <Badge tone="outline">{app.materials.generatedWith === "llm" ? "AI-written" : "Template · resume facts only"}</Badge>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" onClick={regen.run} disabled={regen.busy}>
          {regen.busy ? <Loader2 className="animate-spin" /> : <RefreshCw />} Regenerate
        </Button>
        <Button size="sm" variant="ghost" onClick={onCopy}>
          <Copy /> Copy
        </Button>
        <Button size="sm" variant="secondary" onClick={onSave} disabled={!dirty}>
          <Save /> Save edits
        </Button>
        <Button size="sm" onClick={onApprove} disabled={app.status !== "Preparing"}>
          <CheckCircle2 /> {app.status === "Preparing" ? "Approve" : "Approved"}
        </Button>
      </div>
    </div>
  );
}

function CoverLetterTab({ app, setApp, onSave }: TabProps) {
  const toast = useToast();
  const original = app.materials?.coverLetter?.content ?? "";
  const [text, setText] = useState(original);
  useEffect(() => setText(original), [original]);
  const regen = useRegenerate(app, setApp, "cover_letter");
  if (!app.materials?.coverLetter) return <Card className="p-8 text-center text-sm text-ink-3">No cover letter yet — run the agent on this job.</Card>;

  return (
    <Card className="p-0">
      <MaterialsToolbar
        app={app}
        dirty={text !== original}
        regen={regen}
        onCopy={async () => toast({ title: (await copyToClipboard(text)) ? "Copied to clipboard" : "Copy failed", variant: "info" })}
        onSave={() => onSave({ coverLetter: text }, "Cover letter saved")}
        onApprove={() => onSave({ status: "Ready to apply", ...(text !== original ? { coverLetter: text } : {}) }, "Marked ready to apply")}
      />
      <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={20} className="rounded-none border-0 p-5 text-[15px] leading-7 shadow-none focus-visible:ring-0" />
    </Card>
  );
}

function AnswersTab({ app, setApp, onSave }: TabProps) {
  const toast = useToast();
  const answers = app.materials?.answers ?? [];
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  useEffect(() => setDrafts({}), [answers]);
  const regen = useRegenerate(app, setApp, "answers");
  if (!answers.length) return <Card className="p-8 text-center text-sm text-ink-3">No application answers yet — run the agent on this job.</Card>;

  const edited = Object.entries(drafts).map(([id, answer]) => ({ id, answer }));
  const all = answers.map((a) => `${a.question}\n${drafts[a.id] ?? a.answer}`).join("\n\n");

  return (
    <Card className="p-0">
      <MaterialsToolbar
        app={app}
        dirty={edited.length > 0}
        regen={regen}
        onCopy={async () => toast({ title: (await copyToClipboard(all)) ? "Copied all answers" : "Copy failed", variant: "info" })}
        onSave={() => onSave({ answers: edited }, "Answers saved")}
        onApprove={() => onSave({ status: "Ready to apply", ...(edited.length ? { answers: edited } : {}) }, "Marked ready to apply")}
      />
      <div className="divide-y divide-line">
        {answers.map((a) => (
          <div key={a.id} className="space-y-2 p-5">
            <p className="text-sm font-medium">{a.question}</p>
            <Textarea rows={6} value={drafts[a.id] ?? a.answer} onChange={(e) => setDrafts((d) => ({ ...d, [a.id]: e.target.value }))} />
          </div>
        ))}
      </div>
    </Card>
  );
}

function LinkOut({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] text-accent hover:underline">
      {children} <ExternalLink className="size-3" />
    </a>
  );
}
