import { ArrowUpRight, CalendarDays, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AdminExportLinks, AdminPagination, queryFromRecord } from "@/components/admin-list-tools";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { formatDuration, formatPacific } from "@/lib/format";
import { runClassificationLabel, runStatusLabel, runStatusValues, runClassificationValues, triggerLabel } from "@/lib/operator-labels";
import { parseRunFilters, queryRuns } from "@/server/services/admin-data";

export const metadata: Metadata = { title: "History" };
export const dynamic = "force-dynamic";

type HistoryPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function statusClass(status: string) {
  if (status === "accepted") return "border-success/25 bg-success/10 text-success-foreground";
  if (status === "failed") return "border-destructive/25 bg-destructive/10 text-destructive-content";
  if (status === "rejected") return "border-warning/30 bg-warning/10 text-warning-foreground";
  return "border-border bg-muted text-muted-foreground";
}

export default async function HistoryPage({ searchParams }: HistoryPageProps) {
  const params = await searchParams;
  const query = queryFromRecord(params);
  const filters = parseRunFilters(params);
  const result = await queryRuns(filters);
  const get = (key: string) => query.get(key) ?? "";

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div><p className="text-sm font-medium text-primary">Audit trail</p><h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">History</h1><p className="mt-2 text-sm text-muted-foreground">Every collection attempt and trust decision, searchable and exportable.</p></div>
        <AdminExportLinks endpoint="/api/admin/exports/runs" query={query} />
      </div>
      <Card>
        <CardHeader className="border-b">
          <CardTitle>Find collection runs</CardTitle>
          <p className="text-sm leading-6 text-muted-foreground">Filters are kept in the URL so a review can be shared or revisited.</p>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1.4fr)_1fr_1fr_1fr_10rem_10rem_auto]" method="get">
            <label className="text-sm font-medium md:col-span-2 xl:col-span-1" htmlFor="history-q">Search
              <span className="relative mt-2 block"><Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="pl-9" defaultValue={get("q")} id="history-q" name="q" placeholder="Run ID, trigger, or decision" type="search" /></span>
            </label>
            <label className="text-sm font-medium" htmlFor="history-status">Decision
              <Select className="mt-2" defaultValue={get("status") || "all"} id="history-status" name="status"><option value="all">All decisions</option>{runStatusValues.map((status) => <option key={status} value={status}>{runStatusLabel(status)}</option>)}</Select>
            </label>
            <label className="text-sm font-medium" htmlFor="history-classification">Reason
              <Select className="mt-2" defaultValue={get("classification") || "all"} id="history-classification" name="classification"><option value="all">All reasons</option>{runClassificationValues.map((classification) => <option key={classification} value={classification}>{runClassificationLabel(classification)}</option>)}</Select>
            </label>
            <label className="text-sm font-medium" htmlFor="history-trigger">Requested by
              <Select className="mt-2" defaultValue={get("trigger") || "all"} id="history-trigger" name="trigger"><option value="all">All triggers</option><option value="scheduled">Scheduled check</option><option value="manual">Operator requested</option><option value="manual_cli">CLI requested</option><option value="retry">Retry</option></Select>
            </label>
            <label className="text-sm font-medium" htmlFor="history-from">From
              <Input className="mt-2" defaultValue={get("from")} id="history-from" name="from" type="date" />
            </label>
            <label className="text-sm font-medium" htmlFor="history-to">To
              <Input className="mt-2" defaultValue={get("to")} id="history-to" name="to" type="date" />
            </label>
            <label className="text-sm font-medium" htmlFor="history-sort">Order
              <Select className="mt-2" defaultValue={get("sort") || "newest"} id="history-sort" name="sort"><option value="newest">Newest first</option><option value="oldest">Oldest first</option></Select>
            </label>
            <div className="flex items-end gap-2 md:col-span-2 xl:col-span-1"><Button className="min-h-11" type="submit">Search</Button><Link className={buttonVariants({ variant: "ghost", size: "default" })} href="/admin/history">Clear</Link></div>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-col gap-3 border-b sm:flex-row sm:items-center sm:justify-between"><div><CardTitle>Collection runs</CardTitle><p className="mt-1 text-sm text-muted-foreground">{result.total.toLocaleString()} matching run{result.total === 1 ? "" : "s"} · showing up to {filters.pageSize}</p></div><span className="inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-xs text-muted-foreground"><CalendarDays aria-hidden="true" className="size-3.5" /> URL-backed filters</span></CardHeader>
        <CardContent className="p-0 sm:p-0">
          {result.rows.length === 0 ? <div className="p-10 text-center"><p className="text-sm font-medium">No collection runs match these filters</p><p className="mt-1 text-xs text-muted-foreground">Try clearing one filter or wait for the next scheduled check.</p></div> : <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-sm"><caption className="sr-only">Collection run history</caption><thead className="border-b bg-muted/35 text-xs text-muted-foreground"><tr><th scope="col" className="px-5 py-3 font-medium sm:px-6">Created</th><th scope="col" className="px-4 py-3 font-medium">Decision</th><th scope="col" className="px-4 py-3 font-medium">Reason</th><th scope="col" className="px-4 py-3 font-medium">Requested by</th><th scope="col" className="px-4 py-3 font-medium">Coverage</th><th scope="col" className="px-4 py-3 font-medium">Duration</th><th scope="col" className="px-5 py-3 text-right font-medium sm:px-6">Evidence</th></tr></thead><tbody className="divide-y">{result.rows.map((run) => <tr className="transition-colors hover:bg-muted/25" key={run.id}><td className="whitespace-nowrap px-5 py-4 text-xs sm:px-6"><p className="font-medium text-foreground">{formatPacific(run.collectedAt ?? run.createdAt)}</p></td><td className="px-4 py-4"><Badge className={statusClass(run.status)}>{runStatusLabel(run.status)}</Badge></td><td className="px-4 py-4 text-xs text-muted-foreground">{runClassificationLabel(run.classification)}</td><td className="px-4 py-4 text-xs text-muted-foreground">{triggerLabel(run.trigger)}</td><td className="px-4 py-4 text-xs"><span className="font-medium">{run.rowCount ?? "—"}</span> elevators · <span className="font-medium">{run.stationCount ?? "—"}</span> stations</td><td className="px-4 py-4 text-xs text-muted-foreground">{formatDuration(run.startedAt, run.finishedAt)}</td><td className="px-5 py-4 text-right sm:px-6"><Link aria-label={`Inspect collection run ${run.id}`} className="inline-flex min-h-11 items-center gap-1 text-xs font-medium text-primary hover:underline" href={`/admin/runs/${run.id}`}>Inspect <ArrowUpRight aria-hidden="true" className="size-3.5" /></Link></td></tr>)}</tbody></table></div>}
          <AdminPagination basePath="/admin/history" nextCursor={result.nextCursor} pageSize={filters.pageSize} query={query} total={result.total} />
        </CardContent>
      </Card>
    </div>
  );
}
