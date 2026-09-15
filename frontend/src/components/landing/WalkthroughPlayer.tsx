import { useImperativeHandle, useRef, useState, type Ref } from "react";
import { Play } from "lucide-react";
import walkthroughUrl from "@docs/video/InternFlow-AI-walkthrough.mp4";
import walkthroughPoster from "@docs/video/walkthrough-poster.jpg";
import { cn } from "@/lib/utils";

export const VIDEO_DURATION = 112;

/** Chapters mirror the caption cards burned into the walkthrough video (start time in seconds). */
export const CHAPTERS = [
  { start: 0, title: "InternFlow AI", text: "One agent. Five apps. One complete workflow." },
  { start: 8, title: "One agent. Five apps.", text: "It coordinates the web, Drive, Gmail, Notion and Calendar — and asks before anything consequential." },
  { start: 22, title: "Demo Mode", text: "Realistic mock integrations behind the same interfaces as the real ones." },
  { start: 30, title: "Start the agent", text: "Use the demo job posting and start the application analysis." },
  { start: 34, title: "Untrusted content, ignored", text: "The page hides instructions for AI assistants. InternFlow flags them and ignores them." },
  { start: 46, title: "The agent coordinates your apps", text: "Latest resume from Drive, an 86% evidence-based match, Gmail history, Notion tracker, a free Calendar slot." },
  { start: 67, title: "Human-in-the-loop approval", text: "A Gmail draft and a calendar reminder touch your accounts, so the agent pauses. Review, edit, approve." },
  { start: 78, title: "Workflow complete", text: "5 apps coordinated, 13 agent actions, 0 context switching." },
  { start: 88, title: "Grounded application materials", text: "Editable cover letter and answers, every claim checked against the resume." },
  { start: 97, title: "Application tracker", text: "Every application lands in the tracker, synced to Notion." },
  { start: 100, title: "Connect real accounts", text: "Turn off Demo Mode and connect your real Google and Notion accounts." },
] as const;

export const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export interface PlayerHandle {
  seek: (seconds: number) => void;
}

export function WalkthroughPlayer({ ref }: { ref?: Ref<PlayerHandle> }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const [time, setTime] = useState(0);

  const seek = (seconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    setStarted(true);
    video.currentTime = seconds;
    setTime(seconds);
    void video.play().catch(() => undefined);
  };
  useImperativeHandle(ref, () => ({ seek }));

  const activeIndex = CHAPTERS.findLastIndex((c) => time >= c.start);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-black shadow-[0_40px_120px_-30px_rgb(15_118_110/0.55)]">
        <div className="flex items-center gap-2 border-b border-white/10 bg-white/[0.04] px-4 py-2.5">
          <span className="size-2.5 rounded-full bg-white/15" />
          <span className="size-2.5 rounded-full bg-white/15" />
          <span className="size-2.5 rounded-full bg-white/15" />
          <span className="mx-auto rounded-md bg-white/[0.06] px-3 py-0.5 font-mono text-[11px] text-white/45">localhost:5173 · Demo Mode</span>
          <span className="font-mono text-[11px] text-white/45 tabular">{formatTime(VIDEO_DURATION)}</span>
        </div>
        <div className="relative aspect-[16/10] bg-black">
          <video
            ref={videoRef}
            className="absolute inset-0 size-full"
            src={walkthroughUrl}
            poster={walkthroughPoster}
            controls={started}
            playsInline
            preload="metadata"
            onPlay={() => setStarted(true)}
            onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          />
          {!started && (
            // Same treatment as the README thumbnail: blurred "Workflow complete" frame, play button, title.
            <button type="button" onClick={() => seek(0)} aria-label="Play the 1:52 walkthrough video" className="group absolute inset-0 overflow-hidden">
              <img src={walkthroughPoster} alt="" className="size-full scale-[1.03] object-cover blur-[3px]" />
              <span className="absolute inset-0 bg-gradient-to-b from-black/35 via-black/45 to-black/85 transition-colors" />
              <span className="absolute top-4 right-4 hidden items-center gap-1.5 rounded-full bg-black/70 px-3 py-1 text-sm font-semibold tabular sm:inline-flex">
                <Play className="size-3 fill-current" /> {formatTime(VIDEO_DURATION)}
              </span>
              <span className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
                <span className="flex size-14 items-center justify-center rounded-full bg-accent ring-[6px] ring-white/15 transition-transform duration-200 group-hover:scale-105 sm:size-24 sm:ring-[10px]">
                  <Play className="ml-1 size-6 fill-current sm:ml-1.5 sm:size-9" />
                </span>
                <span className="mt-4 text-lg font-semibold tracking-[-0.02em] sm:mt-8 sm:text-4xl">
                  InternFlow <span className="text-teal-300">AI</span> — Walkthrough
                </span>
                <span className="mt-2 hidden text-lg text-white/80 sm:block">One agent · Five apps · One complete workflow — click to watch</span>
                <span className="mt-1 text-xs text-white/70 sm:hidden">Tap to watch · {formatTime(VIDEO_DURATION)}</span>
              </span>
            </button>
          )}
        </div>
      </div>

      <nav aria-label="Walkthrough chapters" className="flex flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-2">
        <p className="flex items-center justify-between px-3 pt-2 pb-2 text-[11px] font-semibold tracking-[0.14em] text-white/40 uppercase">
          Chapters
          <span className="font-mono tracking-normal normal-case tabular">
            {formatTime(time)} / {formatTime(VIDEO_DURATION)}
          </span>
        </p>
        <ol className="grid gap-0.5 sm:grid-cols-2 lg:flex-1 lg:grid-cols-1 lg:content-evenly">
          {CHAPTERS.map((chapter, i) => {
            const active = started && i === activeIndex;
            const end = CHAPTERS[i + 1]?.start ?? VIDEO_DURATION;
            const progress = active ? Math.min(1, (time - chapter.start) / (end - chapter.start)) : 0;
            return (
              <li key={chapter.start}>
                <button
                  type="button"
                  onClick={() => seek(chapter.start)}
                  aria-current={active ? "true" : undefined}
                  className={cn(
                    "relative flex w-full gap-3 overflow-hidden rounded-lg px-3 py-[7px] text-left transition-colors",
                    active ? "bg-white/[0.08]" : "hover:bg-white/[0.05]",
                  )}
                >
                  <span className={cn("w-8 shrink-0 pt-px font-mono text-[11px] leading-5 tabular", active ? "text-teal-300" : "text-white/35")}>
                    {formatTime(chapter.start)}
                  </span>
                  <span className="min-w-0">
                    <span className={cn("block text-[13px] leading-5", active ? "font-medium text-white" : "text-white/70")}>{chapter.title}</span>
                    {active && <span className="mt-0.5 block text-xs leading-[18px] text-white/55">{chapter.text}</span>}
                  </span>
                  {active && <span className="absolute bottom-0 left-0 h-0.5 bg-teal-300/80" style={{ width: `${progress * 100}%` }} />}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
    </div>
  );
}
