import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, FileText, Search } from "lucide-react";
import type { ApplicationStatus } from "@internflow/shared";
import { APPLICATION_STATUSES } from "@internflow/shared";
import { EmptyState, ErrorState, MatchScoreChip, PageHeader } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toaster";
import { useApplications } from "@/hooks/useApplications";
import { api, errorMessage } from "@/lib/api";
import { formatDate, formatRelative } from "@/lib/format";

export function ApplicationsPage() {
  const { data, loading, error, reload, setData } = useApplications();
  const toast = useToast();
  const [filter, setFilter] = useState<ApplicationStatus | "All">("All");
  const [query, setQuery] = useState("");

  const rows = useMemo(
    () =>
      (data ?? []).filter(
        (a) => (filter === "All" || a.status === filter) && `${a.company} ${a.role}`.toLowerCase().includes(query.trim().toLowerCase()),
      ),
    [data, filter, query],
  );

  const setStatus = async (id: string, status: ApplicationStatus) => {
    const prev = data;
    setData((d) => d?.map((a) => (a.id === id ? { ...a, status } : a)));
    try {
      await api.updateApplication(id, { status });
      toast({ title: `Status updated to ${status}`, variant: "success" });
    } catch (err) {
      setData(prev);
      toast({ title: "Couldn't update status", description: errorMessage(err), variant: "error" });
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-8 sm:px-6">
      <PageHeader
        title="Application tracker"
        description="Every application the agent prepares is tracked here and mirrored to Notion."
        actions={
          <Button asChild>
            <Link to="/app">New application</Link>
          </Button>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5">
          {(["All", ...APPLICATION_STATUSES] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition ${filter === s ? "border-ink bg-ink text-white" : "border-line bg-surface text-ink-2 hover:border-line-strong"}`}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="relative sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-4" />
          <Input className="pl-9" placeholder="Search company or role" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      <Card className="overflow-hidden p-0">
        {loading ? (
          <div className="space-y-2 p-5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : error ? (
          <ErrorState message={error} onRetry={() => reload()} />
        ) : rows.length === 0 ? (
          <EmptyState icon={FileText} title={data?.length ? "No applications match" : "No applications yet"} description="Run the agent on a job posting to create one." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-line bg-sunken/60 text-left text-xs uppercase tracking-wide text-ink-3">
                <tr>
                  <th className="px-5 py-3 font-medium">Company</th>
                  <th className="px-3 py-3 font-medium">Role</th>
                  <th className="px-3 py-3 font-medium">Match</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3 font-medium">Follow-up</th>
                  <th className="px-3 py-3 font-medium">Updated</th>
                  <th className="px-5 py-3 font-medium">Notion</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((a) => (
                  <tr key={a.id} className="hover:bg-sunken/40">
                    <td className="px-5 py-3">
                      <Link to={`/app/applications/${a.id}`} className="font-medium text-ink hover:text-accent">
                        {a.company}
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-ink-2">{a.role}</td>
                    <td className="px-3 py-3">
                      <MatchScoreChip score={a.matchScore} />
                    </td>
                    <td className="px-3 py-3">
                      <NativeSelect className="h-8 w-36 text-[13px]" value={a.status} onChange={(e) => setStatus(a.id, e.target.value as ApplicationStatus)} aria-label="Status">
                        {APPLICATION_STATUSES.map((s) => (
                          <option key={s}>{s}</option>
                        ))}
                      </NativeSelect>
                    </td>
                    <td className="px-3 py-3 font-mono text-[13px] text-ink-2">{a.followUpDate ? formatDate(a.followUpDate, { month: "short", day: "numeric" }) : "—"}</td>
                    <td className="px-3 py-3 text-[13px] text-ink-3">{formatRelative(a.updatedAt)}</td>
                    <td className="px-5 py-3">
                      {a.trackerUrl ? (
                        <a href={a.trackerUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] text-accent hover:underline">
                          Open <ExternalLink className="size-3" />
                        </a>
                      ) : (
                        <span className="text-[13px] text-ink-4">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
