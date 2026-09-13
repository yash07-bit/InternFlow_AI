import { ArrowRight, CheckCircle2, FileSearch, Lock, ShieldCheck, Sparkles, Zap } from "lucide-react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Logo } from "@/components/common";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { APPS, APP_ORDER, AppIcon } from "@/lib/apps";

const FAN_OUT = ["google_drive", "gmail", "google_calendar", "notion"] as const;

export function LandingPage() {
  const navigate = useNavigate();
  const tryDemo = async () => {
    await api.updateSettings({ demoMode: true }).catch(() => undefined);
    navigate("/app");
  };

  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Logo />
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => document.getElementById("how")?.scrollIntoView({ behavior: "smooth" })}>
            How it works
          </Button>
          <Button size="sm" onClick={tryDemo}>
            Try Demo <ArrowRight />
          </Button>
        </div>
      </header>

      <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-20 pt-10 lg:grid-cols-[1.05fr_1fr]">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-xs font-medium text-ink-2">
            <Sparkles className="size-3.5 text-accent" /> Multi-app AI agent
          </span>
          <h1 className="mt-5 text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl">
            Your internship applications, <span className="text-accent">orchestrated by AI.</span>
          </h1>
          <p className="mt-5 text-lg text-ink-2">One agent. Five apps. One complete workflow.</p>
          <p className="mt-3 max-w-xl text-[15px] leading-7 text-ink-3">
            Paste a job posting. InternFlow analyzes it, pulls your resume from Drive, checks Gmail for past recruiter threads, tracks the
            application in Notion, finds a follow-up slot in Calendar — and pauses for your approval before touching anything that matters.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button size="lg" onClick={tryDemo}>
              Try Demo <ArrowRight />
            </Button>
            <Button size="lg" variant="secondary" onClick={() => document.getElementById("how")?.scrollIntoView({ behavior: "smooth" })}>
              See how it works
            </Button>
          </div>
        </div>
        <FlowDiagram />
      </section>

      <section className="border-y border-line bg-surface">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">One task. Multiple apps. Zero context switching.</h2>
          <p className="mt-2 text-ink-3">Every app is a tool the agent decides when to use.</p>
          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {APP_ORDER.map((id) => (
              <div key={id} className="rounded-xl border border-line bg-canvas p-4">
                <AppIcon app={id} size="md" />
                <p className="mt-3 text-sm font-medium">{APPS[id].label}</p>
                <p className="mt-1 text-[13px] leading-5 text-ink-3">{APPS[id].role}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="how" className="mx-auto max-w-6xl px-5 py-16">
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight">This is not "ChatGPT writes my cover letter."</h2>
            <p className="mt-3 text-[15px] leading-7 text-ink-2">
              It's an AI agent that coordinates your entire internship application workflow across multiple applications. It reasons about
              the task, chooses tools, observes results, adapts when an app is down, and keeps you in control.
            </p>
            <ol className="mt-6 space-y-3 text-sm">
              {[
                "Analyze the job posting and extract requirements",
                "Retrieve your latest resume from Google Drive",
                "Score the match with evidence — never invented qualifications",
                "Check Gmail for previous recruiter communication",
                "Draft a grounded cover letter and application answers",
                "Create the tracker record in Notion",
                "Find a follow-up slot in Google Calendar",
                "Ask your approval before drafting emails or scheduling",
              ].map((step, i) => (
                <li key={step} className="flex gap-3">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft font-mono text-xs text-accent">{i + 1}</span>
                  <span className="pt-0.5 text-ink-2">{step}</span>
                </li>
              ))}
            </ol>
          </div>
          <div className="space-y-3">
            <h3 className="text-lg font-semibold">You stay in control</h3>
            <Tier icon={FileSearch} tone="text-emerald-700 bg-emerald-50" title="Read-only · automatic" text="Reading the job page, searching Gmail and Drive, checking Calendar and Notion." />
            <Tier icon={Zap} tone="text-sky-700 bg-sky-50" title="Low-risk writes · tracked" text="Creating and updating your own application tracker record." />
            <Tier icon={Lock} tone="text-amber-800 bg-amber-50" title="Consequential · approval required" text="Email drafts and calendar events wait for your explicit approval. Emails are never sent automatically." />
            <Tier icon={ShieldCheck} tone="text-accent bg-accent-soft" title="Prompt-injection defense" text="Job pages and emails are untrusted data. Hidden instructions are flagged and ignored." />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-20">
        <div className="flex flex-col items-start justify-between gap-4 rounded-2xl bg-ink px-8 py-10 text-white sm:flex-row sm:items-center">
          <div>
            <p className="text-xl font-semibold">See the agent work across five apps.</p>
            <p className="mt-1 text-sm text-white/60">Demo Mode runs end-to-end with realistic mock integrations — no accounts needed.</p>
          </div>
          <Button size="lg" onClick={tryDemo} className="bg-white text-ink hover:bg-white/90">
            Try Demo <ArrowRight />
          </Button>
        </div>
      </section>

      <footer className="border-t border-line py-6 text-center text-xs text-ink-4">InternFlow AI · Built for the Multi-App AI Agent Hackathon</footer>
    </div>
  );
}

function Tier({ icon: Icon, tone, title, text }: { icon: typeof Lock; tone: string; title: string; text: string }) {
  return (
    <div className="flex gap-3 rounded-xl border border-line bg-surface p-4">
      <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${tone}`}>
        <Icon className="size-4" />
      </span>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-[13px] leading-5 text-ink-3">{text}</p>
      </div>
    </div>
  );
}

function FlowDiagram() {
  return (
    <div className="rounded-2xl border border-line bg-surface p-6 shadow-card">
      <div className="flex flex-col items-center gap-3">
        <Node icon={<AppIcon app="web" size="sm" />} label="Job Posting" sub="example.com/software-engineering-internship" />
        <Connector />
        <motion.div
          className="flex items-center gap-3 rounded-xl bg-ink px-5 py-3 text-white"
          animate={{ boxShadow: ["0 0 0 0 rgb(15 118 110 / 0.35)", "0 0 0 10px rgb(15 118 110 / 0)"] }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          <AppIcon app="internflow" size="sm" />
          <div>
            <p className="text-sm font-semibold">AI Agent</p>
            <p className="text-[11px] text-white/60">decides · calls tools · asks approval</p>
          </div>
        </motion.div>
        <Connector />
        <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4">
          {FAN_OUT.map((id, i) => (
            <motion.div
              key={id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 + i * 0.12 }}
              className="flex flex-col items-center gap-2 rounded-xl border border-line bg-canvas px-2 py-3"
            >
              <AppIcon app={id} size="sm" />
              <span className="text-xs font-medium text-ink-2">{APPS[id].short}</span>
            </motion.div>
          ))}
        </div>
        <Connector />
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-800">
          <CheckCircle2 className="size-4" /> Application Ready
        </div>
      </div>
    </div>
  );
}

function Node({ icon, label, sub }: { icon: React.ReactNode; label: string; sub: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-canvas px-4 py-2.5">
      {icon}
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="font-mono text-[11px] text-ink-3">{sub}</p>
      </div>
    </div>
  );
}

const Connector = () => <div className="h-5 w-px bg-gradient-to-b from-line-strong to-accent/60" />;
