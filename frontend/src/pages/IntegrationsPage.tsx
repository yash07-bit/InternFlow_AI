import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FlaskConical, Loader2, Plug, Unplug } from "lucide-react";
import type { IntegrationStatus } from "@internflow/shared";
import { ErrorState, PageHeader } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/misc";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toaster";
import { useIntegrations, useSettings } from "@/hooks/useAppData";
import { api, errorMessage } from "@/lib/api";
import { AppIcon, INTEGRATION_STATUS, StatusDot } from "@/lib/apps";

export function IntegrationsPage() {
  const { integrations, loading, error, reload, replace } = useIntegrations();
  const { settings, setDemoMode, updating } = useSettings();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [busy, setBusy] = useState<string>();

  useEffect(() => {
    const connected = params.get("connected");
    const err = params.get("error");
    if (connected) toast({ title: `${connected === "google" ? "Google" : "Notion"} connected`, variant: "success" });
    if (err) toast({ title: "Connection failed", description: err, variant: "error" });
    if (connected || err) {
      setParams({}, { replace: true });
      void reload(true);
    }
  }, [params, setParams, toast, reload]);

  const act = async (i: IntegrationStatus, kind: "connect" | "disconnect") => {
    setBusy(i.id);
    try {
      if (kind === "connect") {
        const res = await api.connectIntegration(i.id);
        if (res.authUrl) return void (window.location.href = res.authUrl);
        replace(res.integration);
        toast({ title: `${i.name} connected`, variant: "success" });
      } else {
        replace(await api.disconnectIntegration(i.id));
        await reload(true); // a Google disconnect affects Gmail, Drive and Calendar
        toast({ title: `${i.name} disconnected`, variant: "info" });
      }
    } catch (err) {
      toast({ title: `Couldn't ${kind} ${i.name}`, description: errorMessage(err), variant: "error" });
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <PageHeader title="Integrations" description="The five apps the agent coordinates. Real and demo providers sit behind the same tool interfaces." />

      <Card className="flex flex-col gap-4 border-accent-muted bg-accent-soft/60 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface text-accent">
            <FlaskConical className="size-4" />
          </span>
          <div>
            <p className="text-sm font-semibold">Demo Mode {settings?.demoMode ? "is on" : "is off"}</p>
            <p className="text-[13px] leading-5 text-ink-2">
              {settings?.demoMode
                ? "Every app is served by a realistic mock provider, so the full workflow runs without OAuth accounts."
                : "The agent uses your connected accounts. Disconnected apps fail gracefully and the workflow continues."}
            </p>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium">
          <Switch checked={!!settings?.demoMode} disabled={updating || !settings} onCheckedChange={(v) => setDemoMode(v)} aria-label="Demo Mode" />
          Demo Mode
        </label>
      </Card>

      {error ? (
        <ErrorState message={error} onRetry={() => reload()} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {loading || !integrations
            ? [0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-52" />)
            : integrations.map((i) => {
                const canConnect = i.authType !== "none" && !settings?.demoMode;
                return (
                  <Card key={i.id} className="flex flex-col p-5">
                    <div className="flex items-start justify-between gap-3">
                      <AppIcon app={i.id} size="md" />
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-canvas px-2.5 py-1 text-xs font-medium text-ink-2">
                        <StatusDot status={i.status} /> {INTEGRATION_STATUS[i.status].label}
                      </span>
                    </div>
                    <p className="mt-4 text-base font-semibold">{i.name}</p>
                    <p className="text-[13px] text-ink-3">{i.description}</p>
                    <ul className="mt-3 flex flex-wrap gap-1.5">
                      {i.capabilities.map((c) => (
                        <li key={c} className="rounded-md bg-sunken px-2 py-0.5 text-[11px] text-ink-2">
                          {c}
                        </li>
                      ))}
                    </ul>
                    <div className="mt-auto flex items-center justify-between gap-3 pt-5">
                      <p className="truncate text-xs text-ink-3">{i.authType === "none" ? "No sign-in needed" : (i.accountLabel ?? (i.configured ? "Credentials configured" : "Not configured"))}</p>
                      {canConnect &&
                        (i.status === "connected" ? (
                          <Button size="sm" variant="danger" disabled={busy === i.id} onClick={() => act(i, "disconnect")}>
                            {busy === i.id ? <Loader2 className="animate-spin" /> : <Unplug />} Disconnect
                          </Button>
                        ) : (
                          <Button size="sm" variant="secondary" disabled={busy === i.id} onClick={() => act(i, "connect")}>
                            {busy === i.id ? <Loader2 className="animate-spin" /> : <Plug />} Connect
                          </Button>
                        ))}
                    </div>
                    {i.lastError && <p className="mt-3 text-xs text-rose-700">{i.lastError}</p>}
                  </Card>
                );
              })}
        </div>
      )}
    </div>
  );
}
