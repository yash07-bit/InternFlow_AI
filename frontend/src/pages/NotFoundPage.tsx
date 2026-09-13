import { Link } from "react-router-dom";
import { ArrowLeft, Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/common";

export function NotFoundPage({ inApp = false }: { inApp?: boolean }) {
  return (
    <div className={inApp ? "px-4 py-24" : "flex min-h-dvh flex-col px-4 py-6"}>
      {!inApp && <Logo className="mx-auto mb-auto w-fit sm:mx-0" />}
      <div className="mx-auto flex max-w-md flex-col items-center py-16 text-center">
        <span className="mb-4 inline-flex size-12 items-center justify-center rounded-2xl border border-line bg-surface text-ink-3 shadow-card">
          <Compass className="size-6" />
        </span>
        <p className="font-mono text-xs text-ink-3">404</p>
        <h1 className="mt-1 text-xl font-semibold tracking-[-0.02em] text-ink">This page isn't part of the workflow</h1>
        <p className="mt-2 text-sm text-ink-3">The link may be outdated, or the run or application was removed.</p>
        <div className="mt-6 flex gap-2">
          <Button asChild variant="secondary">
            <Link to={inApp ? "/app" : "/"}>
              <ArrowLeft /> {inApp ? "Back to agent" : "Back home"}
            </Link>
          </Button>
        </div>
      </div>
      {!inApp && <div className="mt-auto" />}
    </div>
  );
}
