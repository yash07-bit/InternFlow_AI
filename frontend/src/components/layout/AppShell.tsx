import { NavLink, Outlet, Link } from "react-router-dom";
import { Bot, Cpu, LayoutList, Plug, ArrowUpRight } from "lucide-react";
import { AppDataProvider, engineLabel, useIntegrations, useSettings } from "@/hooks/useAppData";
import { Logo } from "@/components/common";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/misc";
import { Tooltip } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toaster";
import { APP_ORDER, AppIcon, INTEGRATION_STATUS, StatusDot, appMeta } from "@/lib/apps";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/app", label: "Agent", icon: Bot, end: true },
  { to: "/app/applications", label: "Applications", icon: LayoutList, end: false },
  { to: "/app/integrations", label: "Integrations", icon: Plug, end: false },
];

export function AppShell() {
  return (
    <AppDataProvider>
      <div className="flex min-h-dvh flex-col">
        <Header />
        <main className="flex-1">
          <Outlet />
        </main>
      </div>
    </AppDataProvider>
  );
}

function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas/85 backdrop-blur-md supports-[backdrop-filter]:bg-canvas/75">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-2 px-3 sm:gap-4 sm:px-6">
        <Logo to="/app" subtitle />
        <nav aria-label="Primary" className="ml-2 hidden items-center gap-0.5 md:flex">
          {NAV.map((item) => (
            <NavItem key={item.to} {...item} />
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <EngineBadge />
          <ConnectedAppsPopover />
          <DemoModeToggle />
        </div>
      </div>
      <nav aria-label="Primary" className="flex items-center gap-0.5 overflow-x-auto border-t border-line px-3 py-1.5 md:hidden">
        {NAV.map((item) => (
          <NavItem key={item.to} {...item} />
        ))}
      </nav>
    </header>
  );
}

function NavItem({ to, label, icon: Icon, end }: (typeof NAV)[number]) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
          isActive ? "bg-surface text-ink shadow-card ring-1 ring-line" : "text-ink-3 hover:bg-sunken hover:text-ink",
        )
      }
    >
      <Icon className="size-4" />
      {label}
    </NavLink>
  );
}

function EngineBadge() {
  const { settings, loading } = useSettings();
  if (loading && !settings) return <Skeleton className="hidden h-7 w-36 rounded-full lg:block" />;
  if (!settings) return null;
  const configured = settings.llm.provider === "local" || settings.llm.configured;
  return (
    <Tooltip
      content={
        settings.llm.provider === "local"
          ? "Deterministic local planner — no API key needed. Add ANTHROPIC_API_KEY to use Claude."
          : configured
            ? "The agent plans and chooses tools with Claude."
            : "Claude selected but ANTHROPIC_API_KEY is missing — falling back to the local planner."
      }
    >
      <span className="hidden h-7 items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 text-xs text-ink-2 lg:inline-flex">
        <Cpu className="size-3.5 text-ink-3" />
        <span className="font-mono text-[11px]">{engineLabel(settings.llm)}</span>
      </span>
    </Tooltip>
  );
}

function ConnectedAppsPopover() {
  const { integrations, loading, error, reload } = useIntegrations();
  const byId = new Map(integrations?.map((i) => [i.id, i]));
  const live = integrations?.filter((i) => i.status !== "disconnected" && i.status !== "error").length ?? 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-8 items-center gap-2 rounded-lg border border-line bg-surface px-2.5 text-[13px] font-medium text-ink-2 shadow-card transition-colors hover:border-line-strong hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          aria-label="Connected apps"
        >
          <span className="hidden -space-x-1.5 sm:flex">
            {APP_ORDER.map((id) => (
              <span key={id} className="rounded-[6px] ring-2 ring-surface">
                <AppIcon app={id} size="xs" />
              </span>
            ))}
          </span>
          <span className="hidden sm:inline">Connected Apps</span>
          <span className="sm:hidden">Apps</span>
          {integrations && <span className="tabular text-xs text-ink-3">{live}/5</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px]">
        <div className="flex items-center justify-between px-2.5 pt-1.5 pb-2">
          <p className="text-[13px] font-semibold text-ink">Connected apps</p>
          <span className="text-[11px] text-ink-3">Agent can use {live} of 5</span>
        </div>
        {error && !integrations ? (
          <div className="px-2.5 pb-2 text-[13px] text-rose-700">
            {error}{" "}
            <button className="underline" onClick={() => void reload()}>
              Retry
            </button>
          </div>
        ) : (
          <ul className="space-y-0.5">
            {APP_ORDER.map((id) => {
              const meta = appMeta(id);
              const status = byId.get(id);
              const s = status ? INTEGRATION_STATUS[status.status] : undefined;
              return (
                <li key={id} className="flex items-center gap-3 rounded-lg px-2.5 py-2 hover:bg-sunken/70">
                  <AppIcon app={id} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] leading-4 font-medium text-ink">{meta.label}</p>
                    <p className="mt-0.5 truncate text-[11px] leading-4 text-ink-3">{status?.accountLabel ?? meta.role}</p>
                  </div>
                  {loading && !status ? (
                    <Skeleton className="h-4 w-16" />
                  ) : status && s ? (
                    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", s.text)}>
                      <StatusDot status={status.status} />
                      {s.label}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        <Link
          to="/app/integrations"
          className="mt-1 flex items-center justify-between rounded-lg border-t border-line px-2.5 pt-2.5 pb-1.5 text-[13px] font-medium text-accent hover:underline"
        >
          Manage integrations <ArrowUpRight className="size-3.5" />
        </Link>
      </PopoverContent>
    </Popover>
  );
}

function DemoModeToggle() {
  const { settings, loading, updating, setDemoMode } = useSettings();
  const toast = useToast();
  if (loading && !settings) return <Skeleton className="h-8 w-28 rounded-lg" />;
  const checked = !!settings?.demoMode;

  const onChange = async (value: boolean) => {
    try {
      await setDemoMode(value);
      toast({
        variant: "success",
        title: value ? "Demo Mode on" : "Demo Mode off",
        description: value ? "The agent uses demo integrations with fictional data." : "The agent uses your connected accounts.",
      });
    } catch (err) {
      toast({ variant: "error", title: "Couldn't change Demo Mode", description: errorMessage(err) });
    }
  };

  return (
    <label
      className={cn(
        "inline-flex h-8 cursor-pointer items-center gap-2 rounded-lg border px-2.5 text-[13px] font-medium transition-colors",
        checked ? "border-accent-muted bg-accent-soft text-accent" : "border-line bg-surface text-ink-2",
        !settings && "opacity-60",
      )}
    >
      <span className="hidden sm:inline">Demo Mode</span>
      <span className="sm:hidden">Demo</span>
      <span aria-hidden="true" className={cn("hidden size-1.5 rounded-full sm:block", checked ? "bg-accent" : "border border-ink-4")} />
      <Switch checked={checked} disabled={!settings || updating} onCheckedChange={(v) => void onChange(v)} aria-label="Demo Mode" />
    </label>
  );
}
