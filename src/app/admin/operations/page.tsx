import { desc, eq, inArray, sql } from "drizzle-orm";
import { Activity, Bot, CircleCheck, Clock3, Database, RadioTower, Server, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";

import { RunNowButton } from "@/components/run-now-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPacific } from "@/lib/format";
import { db } from "@/server/db/client";
import { collectionRuns, componentChecks, incidents, jobs, trustedSnapshots, workerHeartbeats } from "@/server/db/schema";

export const metadata: Metadata = { title: "Operations" };
export const dynamic = "force-dynamic";

export default async function OperationsPage() {
  const [[latestRun], [latestTrusted], [heartbeat], activeJobs, [incidentCount], [fireworksCheck]] = await Promise.all([
    db.select().from(collectionRuns).orderBy(desc(collectionRuns.createdAt)).limit(1),
    db.select().from(trustedSnapshots).orderBy(desc(trustedSnapshots.acceptedAt)).limit(1),
    db.select({ workerId: workerHeartbeats.workerId, lastSeenAt: workerHeartbeats.lastSeenAt, current: sql<boolean>`${workerHeartbeats.lastSeenAt} >= now() - interval '90 seconds'` }).from(workerHeartbeats).orderBy(desc(workerHeartbeats.lastSeenAt)).limit(1),
    db.select({ id: jobs.id }).from(jobs).where(inArray(jobs.status, ["queued", "running"])),
    db.select({ count: sql<number>`count(*)::int` }).from(incidents).where(inArray(incidents.state, ["detected", "acknowledged", "heal_requested", "preview_received", "preview_rejected", "awaiting_review", "awaiting_approval", "approved", "verification_failed"])),
    db.select().from(componentChecks).where(eq(componentChecks.component, "fireworks")).orderBy(desc(componentChecks.checkedAt)).limit(1),
  ]);
  const workerCurrent = heartbeat?.current ?? false;
  const components = [
    { name: "Web application", detail: "Serving this protected console", healthy: true, icon: Server },
    { name: "PostgreSQL", detail: "Queries operational", healthy: true, icon: Database },
    { name: "Bright Data collector", detail: latestRun ? `${latestRun.status} · ${formatPacific(latestRun.finishedAt)}` : "No collection recorded", healthy: latestRun?.status === "accepted", icon: RadioTower },
    { name: "Worker", detail: workerCurrent ? `Heartbeat ${formatPacific(heartbeat!.lastSeenAt)}` : "No current heartbeat", healthy: workerCurrent, icon: Activity },
    { name: "Fireworks advisory", detail: fireworksCheck?.message ?? "Configured; runs only after deterministic checks", healthy: !fireworksCheck || fireworksCheck.status === "operational", icon: Bot },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div><p className="text-sm font-medium text-primary">System health</p><h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Operations</h1><p className="mt-2 text-sm text-muted-foreground">Live checks, collection health, and response timing.</p></div><RunNowButton /></div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card><CardContent className="pt-5 sm:pt-6"><p className="text-xs text-muted-foreground">Last trusted source update</p><p className="mt-2 text-sm font-semibold">{formatPacific(latestTrusted?.sourceValidAt ?? null)}</p></CardContent></Card>
        <Card><CardContent className="pt-5 sm:pt-6"><p className="text-xs text-muted-foreground">Latest decision</p><p className="mt-2 text-sm font-semibold capitalize">{latestRun?.classification?.replaceAll("_", " ") ?? "No run"}</p></CardContent></Card>
        <Card><CardContent className="pt-5 sm:pt-6"><p className="text-xs text-muted-foreground">Queue depth</p><p className="mt-2 text-sm font-semibold">{activeJobs.length} active job{activeJobs.length === 1 ? "" : "s"}</p></CardContent></Card>
        <Card><CardContent className="pt-5 sm:pt-6"><p className="text-xs text-muted-foreground">Active incidents</p><p className="mt-2 text-sm font-semibold">{incidentCount?.count ?? 0} frozen safely</p></CardContent></Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader className="border-b"><CardTitle>Components</CardTitle></CardHeader>
          <CardContent className="divide-y p-0">
            {components.map(({ name, detail, healthy, icon: Icon }) => (
              <div className="flex items-center gap-3 px-5 py-4 sm:px-6" key={name}><span className="grid size-9 place-items-center rounded-lg border bg-muted"><Icon className="size-4 text-muted-foreground" /></span><div className="min-w-0 flex-1"><p className="text-sm font-medium">{name}</p><p className="mt-0.5 text-xs text-muted-foreground">{detail}</p></div>{healthy ? <CircleCheck className="size-4 text-success" /> : <TriangleAlert className="size-4 text-warning" />}</div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Latest collection</CardTitle></CardHeader>
          <CardContent>{latestRun ? <div className="rounded-xl border bg-muted/20 p-5"><div className="flex items-center justify-between gap-3"><Badge className={latestRun.status === "accepted" ? "border-success/25 bg-success/10 text-success" : ""}>{latestRun.status}</Badge><span className="text-xs text-muted-foreground">{latestRun.rowCount ?? 0} elevators</span></div><p className="mt-4 text-sm font-medium capitalize">{latestRun.classification?.replaceAll("_", " ")}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Source valid {formatPacific(latestRun.sourceValidAt)}</p></div> : <div className="rounded-xl border border-dashed bg-muted/30 p-6 text-center"><Clock3 className="mx-auto size-5 text-muted-foreground" /><p className="mt-3 text-sm font-medium">No completed checks</p></div>}</CardContent>
        </Card>
      </div>
    </div>
  );
}
