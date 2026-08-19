import { ArrowUpRight, CalendarDays, Search, ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AdminExportLinks, AdminPagination, queryFromRecord } from "@/components/admin-list-tools";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { formatPacific } from "@/lib/format";
import {
  incidentStateLabel,
  incidentStateValues,
  runClassificationLabel,
  runClassificationValues,
  statusTone,
} from "@/lib/operator-labels";
import { parseIncidentFilters, queryIncidents } from "@/server/services/admin-data";

export const metadata: Metadata = { title: "Incidents" };
export const dynamic = "force-dynamic";

type IncidentsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function stateClass(state: string) {
  const tone = statusTone(state);
  if (tone === "success") return "border-success/25 bg-success/10 text-success-foreground";
  if (tone === "danger") return "border-destructive/25 bg-destructive/10 text-destructive-content";
  if (tone === "warning") return "border-warning/30 bg-warning/10 text-warning-foreground";
  return "border-border bg-muted text-muted-foreground";
}

export default async function IncidentsPage({ searchParams }: IncidentsPageProps) {
  const params = await searchParams;
  const query = queryFromRecord(params);
  const filters = parseIncidentFilters(params);
  const result = await queryIncidents(filters);
  const get = (key: string) => query.get(key) ?? "";

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-medium text-primary">Safety workflow</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Incidents</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Frozen collections, review evidence, and human-controlled recovery.
          </p>
        </div>
        <AdminExportLinks endpoint="/api/admin/exports/incidents" query={query} />
      </div>

      <Card>
        <CardHeader className="border-b">
          <CardTitle>Find incidents</CardTitle>
          <p className="text-sm leading-6 text-muted-foreground">
            Search the incident title, summary, state, or classification. Filters are saved in the URL.
          </p>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1.5fr)_1fr_1fr_10rem_10rem_auto]" method="get">
            <label className="text-sm font-medium md:col-span-2 xl:col-span-1" htmlFor="incident-q">
              Search
              <span className="relative mt-2 block">
                <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-9" defaultValue={get("q")} id="incident-q" name="q" placeholder="Title, summary, or incident ID" type="search" />
              </span>
            </label>
            <label className="text-sm font-medium" htmlFor="incident-state">
              Workflow state
              <Select className="mt-2" defaultValue={get("state") || "all"} id="incident-state" name="state">
                <option value="all">All states</option>
                {incidentStateValues.map((state) => <option key={state} value={state}>{incidentStateLabel(state)}</option>)}
              </Select>
            </label>
            <label className="text-sm font-medium" htmlFor="incident-classification">
              Reason
              <Select className="mt-2" defaultValue={get("classification") || "all"} id="incident-classification" name="classification">
                <option value="all">All reasons</option>
                {runClassificationValues.map((classification) => <option key={classification} value={classification}>{runClassificationLabel(classification)}</option>)}
              </Select>
            </label>
            <label className="text-sm font-medium" htmlFor="incident-from">
              From
              <Input className="mt-2" defaultValue={get("from")} id="incident-from" name="from" type="date" />
            </label>
            <label className="text-sm font-medium" htmlFor="incident-to">
              To
              <Input className="mt-2" defaultValue={get("to")} id="incident-to" name="to" type="date" />
            </label>
            <label className="text-sm font-medium" htmlFor="incident-sort">
              Order
              <Select className="mt-2" defaultValue={get("sort") || "newest"} id="incident-sort" name="sort">
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
              </Select>
            </label>
            <div className="flex items-end gap-2 md:col-span-2 xl:col-span-1">
              <Button className="min-h-11" type="submit">Search</Button>
              <Link className={buttonVariants({ variant: "ghost", size: "default" })} href="/admin/incidents">Clear</Link>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-col gap-3 border-b sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Recorded incidents</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{result.total.toLocaleString()} matching incident{result.total === 1 ? "" : "s"} · showing up to {filters.pageSize}</p>
          </div>
          <span className="inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-xs text-muted-foreground"><CalendarDays aria-hidden="true" className="size-3.5" /> URL-backed filters</span>
        </CardHeader>
        <CardContent className="p-0 sm:p-0">
          {result.rows.length === 0 ? (
            <div className="p-10 text-center">
              <ShieldAlert aria-hidden="true" className="mx-auto size-5 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">No incidents match these filters</p>
              <p className="mt-1 text-xs text-muted-foreground">Try clearing a filter or review the next source check.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <caption className="sr-only">Incident history</caption>
                <thead className="border-b bg-muted/35 text-xs text-muted-foreground">
                  <tr><th className="px-5 py-3 font-medium sm:px-6">Detected</th><th className="px-4 py-3 font-medium">Incident</th><th className="px-4 py-3 font-medium">State</th><th className="px-4 py-3 font-medium">Reason</th><th className="px-4 py-3 font-medium">Resolution</th><th className="px-5 py-3 text-right font-medium sm:px-6">Evidence</th></tr>
                </thead>
                <tbody className="divide-y">
                  {result.rows.map((incident) => (
                    <tr className="transition-colors hover:bg-muted/25" key={incident.id}>
                      <td className="whitespace-nowrap px-5 py-4 text-xs sm:px-6"><p className="font-medium text-foreground">{formatPacific(incident.detectedAt)}</p><p className="mt-1 font-mono text-[10px] text-muted-foreground">{incident.id}</p></td>
                      <td className="max-w-[28rem] px-4 py-4"><p className="truncate font-medium">{incident.title}</p><p className="mt-1 truncate text-xs text-muted-foreground">{incident.summary}</p></td>
                      <td className="px-4 py-4"><Badge className={stateClass(incident.state)}>{incidentStateLabel(incident.state)}</Badge></td>
                      <td className="px-4 py-4 text-xs text-muted-foreground">{runClassificationLabel(incident.classification)}</td>
                      <td className="px-4 py-4 text-xs text-muted-foreground">{incident.resolvedAt ? formatPacific(incident.resolvedAt) : "Still open"}</td>
                      <td className="px-5 py-4 text-right sm:px-6"><Link aria-label={`Inspect incident ${incident.title}`} className="inline-flex min-h-11 items-center gap-1 text-xs font-medium text-primary hover:underline" href={`/admin/incidents/${incident.id}`}>Inspect <ArrowUpRight aria-hidden="true" className="size-3.5" /></Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <AdminPagination basePath="/admin/incidents" nextCursor={result.nextCursor} pageSize={filters.pageSize} query={query} total={result.total} />
        </CardContent>
      </Card>
    </div>
  );
}
