import { Activity, ArrowRight, CircleAlert, CircleCheck, Database, RadioTower } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatAge, formatPacific } from "@/lib/format";
import {
  componentStatusLabel,
  runClassificationLabel,
  runStatusLabel,
  statusTone,
} from "@/lib/operator-labels";
import { getOperationsSnapshot } from "@/server/services/admin-data";

export const metadata: Metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

function toneClass(value: string | null | undefined) {
  const tone = statusTone(value);
  if (tone === "success") return "border-success/25 bg-success/10 text-success-foreground";
  if (tone === "danger") return "border-destructive/25 bg-destructive/10 text-destructive-content";
  if (tone === "warning") return "border-warning/30 bg-warning/10 text-warning-foreground";
  return "border-border bg-muted text-muted-foreground";
}

function StatusIcon({ value }: { value: string }) {
  return statusTone(value) === "success" ? (
    <CircleCheck aria-hidden="true" className="size-4 text-success" />
  ) : (
    <CircleAlert aria-hidden="true" className="size-4 text-warning" />
  );
}

export default async function AdminOverviewPage() {
  const operations = await getOperationsSnapshot();
  const metrics: ReadonlyArray<readonly [string, string, LucideIcon, string]> = [
    [
      "Data trust",
      operations.trust.state === "current"
        ? "Current"
        : operations.trust.state === "held_stale"
          ? "Last trusted data held"
          : "No trusted snapshot",
      CircleCheck,
      operations.trust.sourceValidAt
        ? `${formatAge(operations.trust.ageSeconds ?? 0)} · ${formatPacific(operations.trust.sourceValidAt)}`
        : "A trusted source update is required",
    ],
    [
      "Latest collection",
      operations.latestRun ? runStatusLabel(operations.latestRun.status) : "No collection yet",
      RadioTower,
      operations.latestRun
        ? `${runClassificationLabel(operations.latestRun.classification)} · ${formatPacific(operations.latestRun.createdAt)}`
        : "The worker has not completed a collection",
    ],
    [
      "Database",
      "Operational",
      Database,
      `Query response ${operations.databaseLatencyMs} ms`,
    ],
    [
      "Open incidents",
      String(operations.incidents.active),
      Activity,
      operations.incidents.active === 0
        ? "No recovery workflow is waiting"
        : "Frozen safely until an operator resolves them",
    ],
  ];

  return (
    <div className="space-y-6">
      <div>
        <Badge>Operator workspace</Badge>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">Overview</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          A live summary of trusted accessibility data, collection health, and recovery work.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(([label, value, Icon, detail]) => (
          <Card key={label}>
            <CardContent className="pt-5 sm:pt-6">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
                  <p className="mt-2 text-sm font-semibold">{value}</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p>
                </div>
                <span className="grid size-9 shrink-0 place-items-center rounded-lg border bg-muted">
                  <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader className="border-b">
            <CardTitle>System signal</CardTitle>
            <p className="text-sm leading-6 text-muted-foreground">
              Current checks are time-stamped so a warning can be distinguished from an unknown state.
            </p>
          </CardHeader>
          <CardContent className="divide-y p-0">
            {operations.components.map((component) => (
              <div className="flex items-center gap-3 px-5 py-4 sm:px-6" key={component.key}>
                <span className="grid size-9 shrink-0 place-items-center rounded-lg border bg-muted">
                  <StatusIcon value={component.status} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{component.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{component.detail}</p>
                </div>
                <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${toneClass(component.status)}`}>
                  {componentStatusLabel(component.status)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Operator attention</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl border bg-muted/20 p-4">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Queue</p>
              <p className="mt-2 text-lg font-semibold tabular-nums">{operations.queue.depth}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {operations.queue.collectionActive ? "A collection is queued or running." : "No collection is currently active."}
              </p>
            </div>
            <div className="rounded-xl border bg-muted/20 p-4">
              <p className="text-xs uppercase tracking-wider text-muted-foreground">Worker</p>
              <p className="mt-2 text-sm font-semibold">{componentStatusLabel(operations.worker.status)}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {operations.worker.lastSeenAt
                  ? `Last heartbeat ${formatPacific(operations.worker.lastSeenAt)}`
                  : "No heartbeat has been recorded."}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary hover:underline" href="/admin/operations">
                Open operations <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
              <Link className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary hover:underline" href="/admin/incidents">
                Review incidents <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
