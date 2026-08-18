import { desc } from "drizzle-orm";
import { ArrowUpRight, CalendarDays } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDuration, formatPacific } from "@/lib/format";
import { db } from "@/server/db/client";
import { collectionRuns } from "@/server/db/schema";

export const metadata: Metadata = { title: "History" };
export const dynamic = "force-dynamic";

function statusClass(status: string) {
  if (status === "accepted") return "border-success/25 bg-success/10 text-success";
  if (status === "failed") return "border-destructive/25 bg-destructive/10 text-destructive";
  if (status === "rejected") return "border-warning/30 bg-warning/10 text-warning-foreground";
  return "border-border bg-muted text-muted-foreground";
}

export default async function HistoryPage() {
  const runs = await db
    .select()
    .from(collectionRuns)
    .orderBy(desc(collectionRuns.createdAt))
    .limit(25);

  return (
    <div className="space-y-6">
      <div><p className="text-sm font-medium text-primary">Audit trail</p><h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">History</h1><p className="mt-2 text-sm text-muted-foreground">Every collection attempt and trust decision, newest first.</p></div>
      <Card>
        <CardHeader className="border-b"><div className="flex items-center justify-between gap-3"><CardTitle>Collection runs</CardTitle><span className="inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-xs text-muted-foreground"><CalendarDays className="size-3.5" /> Latest 25</span></div></CardHeader>
        <CardContent className="p-0 sm:p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b bg-muted/35 text-xs text-muted-foreground"><tr><th className="px-5 py-3 font-medium sm:px-6">Collected</th><th className="px-4 py-3 font-medium">Decision</th><th className="px-4 py-3 font-medium">Classification</th><th className="px-4 py-3 font-medium">Coverage</th><th className="px-4 py-3 font-medium">Duration</th><th className="px-5 py-3 text-right font-medium sm:px-6">Evidence</th></tr></thead>
              <tbody className="divide-y">
                {runs.map((run) => (
                  <tr className="transition-colors hover:bg-muted/25" key={run.id}>
                    <td className="whitespace-nowrap px-5 py-4 text-xs sm:px-6"><p className="font-medium text-foreground">{formatPacific(run.collectedAt ?? run.createdAt)}</p><p className="mt-1 text-muted-foreground capitalize">{run.trigger.replaceAll("_", " ")}</p></td>
                    <td className="px-4 py-4"><Badge className={statusClass(run.status)}>{run.status}</Badge></td>
                    <td className="px-4 py-4 text-xs text-muted-foreground">{run.classification?.replaceAll("_", " ") ?? "In progress"}</td>
                    <td className="px-4 py-4 text-xs"><span className="font-medium">{run.rowCount ?? "—"}</span> elevators · <span className="font-medium">{run.stationCount ?? "—"}</span> stations</td>
                    <td className="px-4 py-4 text-xs text-muted-foreground">{formatDuration(run.startedAt, run.finishedAt)}</td>
                    <td className="px-5 py-4 text-right sm:px-6"><Link className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline" href={`/admin/runs/${run.id}`}>Inspect <ArrowUpRight className="size-3.5" /></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
