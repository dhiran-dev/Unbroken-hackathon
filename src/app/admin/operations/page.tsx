import { Activity, Bot, CircleAlert, CircleCheck, Clock3, Database, RadioTower, Server, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { RunNowButton } from "@/components/run-now-button";
import { AdminExportLinks } from "@/components/admin-list-tools";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatAge, formatPacific } from "@/lib/format";
import { componentStatusLabel, runClassificationLabel, runStatusLabel, statusTone } from "@/lib/operator-labels";
import { getOperationsSnapshot } from "@/server/services/admin-data";

export const metadata: Metadata = { title: "Operations" };
export const dynamic = "force-dynamic";

const componentIcons = {
  web: Server,
  database: Database,
  bright_data: RadioTower,
  validator: CircleCheck,
  worker: Activity,
  fireworks: Bot,
} as const;

function statusClass(value: string) {
  const tone = statusTone(value);
  if (tone === "success") return "border-success/25 bg-success/10 text-success-foreground";
  if (tone === "danger") return "border-destructive/25 bg-destructive/10 text-destructive-content";
  if (tone === "warning") return "border-warning/30 bg-warning/10 text-warning-foreground";
  return "border-border bg-muted text-muted-foreground";
}

function StatusIcon({ status }: { status: string }) {
  return statusTone(status) === "success" ? (
    <CircleCheck aria-hidden="true" className="size-4 text-success" />
  ) : statusTone(status) === "danger" ? (
    <CircleAlert aria-hidden="true" className="size-4 text-destructive" />
  ) : (
    <TriangleAlert aria-hidden="true" className="size-4 text-warning" />
  );
}

export default async function OperationsPage() {
  const operations = await getOperationsSnapshot();
  const query = new URLSearchParams();
  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <p className="text-sm font-medium text-primary">System health</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Operations</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Live checks, collection freshness, worker timing, and recovery pressure.
          </p>
        </div>
        <RunNowButton active={operations.queue.collectionActive} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="pt-5 sm:pt-6">
            <p className="text-xs text-muted-foreground">Trusted data</p>
            <p className="mt-2 text-sm font-semibold">
              {operations.trust.state === "current" ? "Current" : operations.trust.state === "held_stale" ? "Last trusted data held" : "Unavailable"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {operations.trust.ageSeconds !== null ? `${formatAge(operations.trust.ageSeconds)} · checked ${formatPacific(operations.trust.sourceValidAt)}` : "No trusted snapshot"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 sm:pt-6">
            <p className="text-xs text-muted-foreground">Recent acceptance rate</p>
            <p className="mt-2 text-sm font-semibold">{operations.metrics.recentAcceptanceRate === null ? "No completed checks" : `${operations.metrics.recentAcceptanceRate}%`}</p>
            <p className="mt-1 text-xs text-muted-foreground">{operations.metrics.recentCompleted} completed checks in the recent window</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 sm:pt-6">
            <p className="text-xs text-muted-foreground">Queue depth</p>
            <p className="mt-2 text-sm font-semibold">{operations.queue.depth} active job{operations.queue.depth === 1 ? "" : "s"}</p>
            <p className="mt-1 text-xs text-muted-foreground">{operations.queue.oldestScheduledFor ? `Oldest scheduled ${formatPacific(operations.queue.oldestScheduledFor)}` : "No queued work"}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 sm:pt-6">
            <p className="text-xs text-muted-foreground">Active incidents</p>
            <p className="mt-2 text-sm font-semibold">{operations.incidents.active}</p>
            <p className="mt-1 text-xs text-muted-foreground">Frozen safely until human resolution</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader className="border-b">
            <CardTitle>Components</CardTitle>
            <p className="text-sm leading-6 text-muted-foreground">Every status includes the last observed time and a plain-language explanation.</p>
          </CardHeader>
          <CardContent className="divide-y p-0">
            {operations.components.map((component) => {
              const Icon = componentIcons[component.key as keyof typeof componentIcons] ?? Activity;
              return (
                <div className="flex items-center gap-3 px-5 py-4 sm:px-6" key={component.key}>
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg border bg-muted">
                    <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{component.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{component.detail}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Checked {formatPacific(component.checkedAt)}{component.latencyMs === null ? "" : ` · ${component.latencyMs} ms`}
                    </p>
                  </div>
                  <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${statusClass(component.status)}`}>
                    <StatusIcon status={component.status} />
                    {componentStatusLabel(component.status)}
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Latest collection</CardTitle></CardHeader>
            <CardContent>
              {operations.latestRun ? (
                <div className="rounded-xl border bg-muted/20 p-5">
                  <div className="flex items-center justify-between gap-3">
                    <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${statusClass(operations.latestRun.status)}`}>
                      {runStatusLabel(operations.latestRun.status)}
                    </span>
                    <span className="text-xs text-muted-foreground">{operations.latestRun.rowCount ?? 0} elevators</span>
                  </div>
                  <p className="mt-4 text-sm font-medium">{runClassificationLabel(operations.latestRun.classification)}</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">Created {formatPacific(operations.latestRun.createdAt)} · source valid {formatPacific(operations.latestRun.sourceValidAt)}</p>
                  <Link className="mt-4 inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline" href={`/admin/runs/${operations.latestRun.id}`}>
                    Inspect collection evidence <span aria-hidden="true" className="ml-1">→</span>
                  </Link>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed bg-muted/30 p-6 text-center">
                  <Clock3 aria-hidden="true" className="mx-auto size-5 text-muted-foreground" />
                  <p className="mt-3 text-sm font-medium">No completed checks</p>
                  <p className="mt-1 text-xs text-muted-foreground">The first worker result will appear here.</p>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Collection trend</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between gap-3"><span className="text-muted-foreground">Last trusted result</span><span className="font-medium">{formatPacific(operations.metrics.lastAcceptedAt)}</span></div>
              <div className="flex justify-between gap-3"><span className="text-muted-foreground">Last rejected result</span><span className="font-medium">{formatPacific(operations.metrics.lastRejectedAt)}</span></div>
              <div className="flex justify-between gap-3"><span className="text-muted-foreground">Last failed result</span><span className="font-medium">{formatPacific(operations.metrics.lastFailedAt)}</span></div>
              <div className="flex justify-between gap-3"><span className="text-muted-foreground">Average duration</span><span className="font-medium">{operations.metrics.averageDurationMs === null ? "Not available" : `${(operations.metrics.averageDurationMs / 1_000).toFixed(1)} s`}</span></div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 border-b sm:flex-row sm:items-center sm:justify-between">
          <div><CardTitle>Operational exports</CardTitle><p className="mt-1 text-sm text-muted-foreground">Download sanitized records from the protected console.</p></div>
          <AdminExportLinks endpoint="/api/admin/exports/runs" query={query} />
        </CardHeader>
        <CardContent className="pt-5 text-xs leading-5 text-muted-foreground">Exports exclude raw payload bodies, credentials, collector tokens, prompts, and private incident files.</CardContent>
      </Card>
    </div>
  );
}
