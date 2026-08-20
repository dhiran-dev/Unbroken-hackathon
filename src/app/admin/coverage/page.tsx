import {
  CircleAlert,
  CircleCheck,
  Clock3,
  Database,
  ExternalLink,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPacific } from "@/lib/format";
import {
  getAdminCoverage,
  type AdminCoverageSnapshot,
  type AdminCoverageStatus,
} from "@/server/services/admin-coverage";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Citywide coverage" };
export const dynamic = "force-dynamic";

type CoveragePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type CoverageRow = {
  key: string;
  label: string;
  kind: "Realtime feed" | "Trusted source";
  status: AdminCoverageStatus;
  count: number | null;
  checkedAt: Date | null;
  sourceUpdatedAt: Date | null;
  sourceUrl: string | null;
};

const staticCountLabels = {
  stops: "Stops",
  routes: "Routes",
  trips: "Trips",
  stopTimes: "Scheduled stop times",
  services: "Service calendars",
  shapePoints: "Route shape points",
} as const;

const realtimeLabels = {
  trip_updates: "Trip updates",
  vehicles: "Vehicle positions",
  alerts: "Service alerts",
} as const;

const statusOptions = ["all", "current", "older", "unavailable"] as const;
type StatusFilter = (typeof statusOptions)[number];

function statusFilter(value: string | string[] | undefined): StatusFilter {
  const candidate = Array.isArray(value) ? value[0] : value;
  return statusOptions.includes(candidate as StatusFilter)
    ? (candidate as StatusFilter)
    : "all";
}

function statusLabel(status: AdminCoverageStatus) {
  if (status === "current") return "Current";
  if (status === "older") return "Older";
  return "Unavailable";
}

function statusClass(status: AdminCoverageStatus) {
  if (status === "current") {
    return "border-success/25 bg-success/10 text-success-foreground";
  }
  if (status === "older") {
    return "border-warning/30 bg-warning/10 text-warning-foreground";
  }
  return "border-destructive/25 bg-destructive/10 text-destructive-content";
}

function statusIcon(status: AdminCoverageStatus) {
  if (status === "current") return CircleCheck;
  return CircleAlert;
}

function countLabel(value: number | null) {
  return value === null ? "Not available" : value.toLocaleString("en-US");
}

function timestampLabel(value: Date | null) {
  return value ? formatPacific(value) : "Not provided";
}

function sourceRows(coverage: AdminCoverageSnapshot): CoverageRow[] {
  return [
    ...coverage.realtime.map((feed) => ({
      key: `realtime:${feed.feedType}`,
      label: realtimeLabels[feed.feedType],
      kind: "Realtime feed" as const,
      status: feed.status,
      count: feed.entityCount,
      checkedAt: feed.checkedAt,
      sourceUpdatedAt: feed.sourceUpdatedAt,
      sourceUrl: feed.sourceUrl,
    })),
    ...coverage.sources.map((source) => ({
      key: `source:${source.key}`,
      label: source.label,
      kind: "Trusted source" as const,
      status: source.status,
      count: source.rowCount,
      checkedAt: source.checkedAt,
      sourceUpdatedAt: source.sourceUpdatedAt,
      sourceUrl: source.sourceUrl,
    })),
  ];
}

function CoverageStatus({
  status,
}: {
  status: AdminCoverageSnapshot["status"];
}) {
  if (status === "current") {
    return (
      <div
        className="flex items-start gap-3 rounded-xl border border-success/25 bg-success/10 p-4"
        role="status"
      >
        <CircleCheck
          aria-hidden="true"
          className="mt-0.5 size-5 shrink-0 text-success"
        />
        <div>
          <h2 className="font-semibold">
            All fixed coverage sources are current
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Every static, realtime, and trusted source summary passed the
            operator read contract.
          </p>
        </div>
      </div>
    );
  }
  if (status === "partial") {
    return (
      <div
        className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4"
        role="status"
      >
        <CircleAlert
          aria-hidden="true"
          className="mt-0.5 size-5 shrink-0 text-warning"
        />
        <div>
          <h2 className="font-semibold">Coverage is partial</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Older or unavailable entries remain visible with no inferred counts
            or timestamps.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div
      className="flex items-start gap-3 rounded-xl border border-destructive/25 bg-destructive/10 p-4"
      role="status"
    >
      <CircleAlert
        aria-hidden="true"
        className="mt-0.5 size-5 shrink-0 text-destructive"
      />
      <div>
        <h2 className="font-semibold">Coverage is unavailable</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          No trusted coverage summary is available. Counts are not inferred from
          failed reads.
        </p>
      </div>
    </div>
  );
}

function StaticCoverageCard({
  coverage,
}: {
  coverage: AdminCoverageSnapshot["static"];
}) {
  const counts = coverage.counts;
  if (coverage.status === "unavailable" || !counts) {
    return (
      <Card>
        <CardContent className="flex items-start gap-3 py-8">
          <CircleAlert
            aria-hidden="true"
            className="mt-0.5 size-5 shrink-0 text-destructive"
          />
          <div>
            <h2 className="font-semibold">Static schedule unavailable</h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              No checked static snapshot is available for the operator view.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="border-b bg-muted/25">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Database aria-hidden="true" className="size-4 text-primary" />
              Static schedule coverage
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Active service date {coverage.serviceDate} ·{" "}
              {countLabel(coverage.activeServiceCount)} active calendars
            </p>
          </div>
          <Badge className={statusClass(coverage.status)}>
            {statusLabel(coverage.status)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full min-w-96 text-left">
          <caption className="sr-only">
            Rows in the active checked static schedule
          </caption>
          <thead className="border-b text-sm text-muted-foreground">
            <tr>
              <th className="px-5 py-3 font-medium sm:px-6" scope="col">
                Schedule data
              </th>
              <th
                className="px-5 py-3 text-right font-medium sm:px-6"
                scope="col"
              >
                Rows
              </th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(staticCountLabels).map(([key, label]) => (
              <tr className="border-b last:border-b-0" key={key}>
                <th className="px-5 py-3 font-medium sm:px-6" scope="row">
                  {label}
                </th>
                <td className="px-5 py-3 text-right font-semibold tabular-nums sm:px-6">
                  {countLabel(counts[key as keyof typeof counts])}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
      <div
        className={cn(
          "flex flex-col gap-2 border-t px-5 py-4 text-sm",
          "sm:flex-row sm:items-center sm:justify-between sm:px-6",
        )}
      >
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Clock3 aria-hidden="true" className="size-3.5" />
            Checked by UNBROKEN at {formatPacific(coverage.checkedAt)}
          </span>
          <span>
            SFMTA updated at {timestampLabel(coverage.sourceUpdatedAt)}
          </span>
        </div>
        {coverage.sourceUrl && (
          <a
            className="inline-flex min-h-11 items-center gap-1.5 font-medium text-primary hover:underline"
            href={coverage.sourceUrl}
            rel="noreferrer"
            target="_blank"
          >
            Official static source
            <span className="sr-only">(opens in a new tab)</span>
            <ExternalLink aria-hidden="true" className="size-3.5" />
          </a>
        )}
      </div>
    </Card>
  );
}

function CoverageSourcesTable({
  rows,
  filter,
}: {
  rows: CoverageRow[];
  filter: StatusFilter;
}) {
  const visibleRows =
    filter === "all" ? rows : rows.filter((row) => row.status === filter);
  return (
    <Card>
      <CardHeader className="border-b bg-muted/25">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <CardTitle>Realtime and trusted source summaries</CardTitle>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Counts come from trusted snapshot summaries. Payloads, hashes,
              collector IDs, and credentials are never shown here.
            </p>
          </div>
          <form
            action="/admin/coverage"
            className="flex flex-wrap items-end gap-2"
            method="get"
          >
            <div>
              <label
                className="mb-1 block text-xs font-medium"
                htmlFor="coverage-status-filter"
              >
                Filter coverage sources
              </label>
              <select
                className="min-h-11 rounded-lg border bg-background px-3 text-sm"
                defaultValue={filter}
                id="coverage-status-filter"
                name="statusFilter"
              >
                <option value="all">All statuses</option>
                <option value="current">Current</option>
                <option value="older">Older</option>
                <option value="unavailable">Unavailable</option>
              </select>
            </div>
            <button
              className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "min-h-11",
              )}
              type="submit"
            >
              Apply filter
            </button>
            {filter !== "all" && (
              <Link
                className={cn(
                  buttonVariants({ variant: "ghost", size: "sm" }),
                  "min-h-11",
                )}
                href="/admin/coverage"
              >
                Clear
              </Link>
            )}
          </form>
        </div>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        {visibleRows.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground" role="status">
            No coverage sources match this filter.
          </p>
        ) : (
          <table className="w-full min-w-[980px] text-left text-sm">
            <caption className="sr-only">
              Realtime feeds and trusted source coverage
            </caption>
            <thead className="border-b bg-muted/20 text-xs text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium sm:px-6" scope="col">
                  Coverage source
                </th>
                <th className="px-4 py-3 font-medium" scope="col">
                  Kind
                </th>
                <th className="px-4 py-3 font-medium" scope="col">
                  Status
                </th>
                <th className="px-4 py-3 text-right font-medium" scope="col">
                  Records
                </th>
                <th className="px-4 py-3 font-medium" scope="col">
                  Checked by UNBROKEN at
                </th>
                <th className="px-4 py-3 font-medium" scope="col">
                  SFMTA updated at
                </th>
                <th
                  className="px-5 py-3 text-right font-medium sm:px-6"
                  scope="col"
                >
                  Official source
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {visibleRows.map((row) => {
                const Icon = statusIcon(row.status);
                return (
                  <tr key={row.key}>
                    <th className="px-5 py-4 font-medium sm:px-6" scope="row">
                      {row.label}
                    </th>
                    <td className="px-4 py-4 text-muted-foreground">
                      {row.kind}
                    </td>
                    <td className="px-4 py-4">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
                          statusClass(row.status),
                        )}
                      >
                        <Icon aria-hidden="true" className="size-3.5" />
                        {statusLabel(row.status)}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-right font-semibold tabular-nums">
                      {countLabel(row.count)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-xs text-muted-foreground">
                      {timestampLabel(row.checkedAt)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-xs text-muted-foreground">
                      {timestampLabel(row.sourceUpdatedAt)}
                    </td>
                    <td className="px-5 py-4 text-right sm:px-6">
                      {row.sourceUrl ? (
                        <a
                          className="inline-flex min-h-11 items-center gap-1 font-medium text-primary hover:underline"
                          href={row.sourceUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          Open
                          <span className="sr-only">
                            {row.label} source (opens in a new tab)
                          </span>
                          <ExternalLink
                            aria-hidden="true"
                            className="size-3.5"
                          />
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          Not available
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

export default async function AdminCoveragePage({
  searchParams,
}: CoveragePageProps) {
  const params = await searchParams;
  const filter = statusFilter(params.statusFilter);
  const coverage = await getAdminCoverage();
  return (
    <div className="space-y-6">
      <div>
        <Badge>Operator evidence</Badge>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
          Citywide coverage
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          Current static, realtime, and trusted source summaries for the
          citywide planner. This private view shows evidence counts and
          provenance times without raw payloads.
        </p>
      </div>
      <CoverageStatus status={coverage.status} />
      <StaticCoverageCard coverage={coverage.static} />
      <CoverageSourcesTable rows={sourceRows(coverage)} filter={filter} />
    </div>
  );
}
