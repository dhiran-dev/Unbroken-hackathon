import { count, eq, sql } from "drizzle-orm";
import { ArrowLeft, Check, CircleX } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDuration, formatPacific } from "@/lib/format";
import { checkLabel, runStatusLabel, statusTone } from "@/lib/operator-labels";
import { db } from "@/server/db/client";
import { collectionRuns, observations, rawPayloads } from "@/server/db/schema";

export const metadata: Metadata = { title: "Collection evidence" };
export const dynamic = "force-dynamic";

type ContractReport = {
  checks?: Array<{ id: string; passed: boolean; details: string }>;
  reasonCodes?: string[];
  structuralFingerprint?: string | null;
  previousStructuralFingerprint?: string | null;
  freshnessSeconds?: number | null;
};

export default async function RunDetailPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const [[run], [raw], [counts]] = await Promise.all([
    db.select().from(collectionRuns).where(eq(collectionRuns.id, runId)).limit(1),
    db.select({ payloadHash: rawPayloads.payloadHash, byteLength: rawPayloads.byteLength, expiresAt: rawPayloads.expiresAt, retained: sql<boolean>`${rawPayloads.body} is not null` }).from(rawPayloads).where(eq(rawPayloads.collectionRunId, runId)).limit(1),
    db.select({ count: count() }).from(observations).where(eq(observations.collectionRunId, runId)),
  ]);
  if (!run) notFound();
  const report = (run.contractReport ?? {}) as ContractReport;

  return (
    <div className="space-y-6">
      <div><Link className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground" href="/admin/history"><ArrowLeft aria-hidden="true" className="size-3.5" /> Back to history</Link><div className="mt-4 flex flex-wrap items-center gap-2"><Badge className={statusTone(run.status) === "success" ? "border-success/25 bg-success/10 text-success-foreground" : statusTone(run.status) === "danger" ? "border-destructive/25 bg-destructive/10 text-destructive-content" : "border-warning/30 bg-warning/10 text-warning-foreground"}>{runStatusLabel(run.status)}</Badge><span className="font-mono text-xs text-muted-foreground">{run.id}</span></div><h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">Collection evidence</h1><p className="mt-2 text-sm text-muted-foreground">Deterministic checks and immutable timing for this run.</p></div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card><CardContent className="pt-5 sm:pt-6"><p className="text-xs text-muted-foreground">Source valid</p><p className="mt-2 text-sm font-medium">{formatPacific(run.sourceValidAt)}</p></CardContent></Card>
        <Card><CardContent className="pt-5 sm:pt-6"><p className="text-xs text-muted-foreground">Collected</p><p className="mt-2 text-sm font-medium">{formatPacific(run.collectedAt)}</p></CardContent></Card>
        <Card><CardContent className="pt-5 sm:pt-6"><p className="text-xs text-muted-foreground">Accepted</p><p className="mt-2 text-sm font-medium">{formatPacific(run.acceptedAt)}</p></CardContent></Card>
        <Card><CardContent className="pt-5 sm:pt-6"><p className="text-xs text-muted-foreground">Duration</p><p className="mt-2 text-sm font-medium">{formatDuration(run.startedAt, run.finishedAt)}</p></CardContent></Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card><CardHeader className="border-b"><CardTitle>Contract checks</CardTitle></CardHeader><CardContent className="divide-y p-0">{report.checks?.map((check) => <div className="flex gap-3 px-5 py-4 sm:px-6" key={check.id}>{check.passed ? <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" /> : <CircleX aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-destructive" />}<div><p className="text-sm font-medium capitalize">{checkLabel(check.id)}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{check.details}</p></div></div>) ?? <p className="p-6 text-sm text-muted-foreground">No contract report was produced.</p>}</CardContent></Card>
        <div className="space-y-4"><Card><CardHeader><CardTitle>Coverage</CardTitle></CardHeader><CardContent className="space-y-3 text-sm"><div className="flex justify-between"><span className="text-muted-foreground">Elevators</span><span className="font-medium">{run.rowCount ?? 0}</span></div><div className="flex justify-between"><span className="text-muted-foreground">Stations</span><span className="font-medium">{run.stationCount ?? 0}</span></div><div className="flex justify-between"><span className="text-muted-foreground">Stored observations</span><span className="font-medium">{counts?.count ?? 0}</span></div><div className="flex justify-between"><span className="text-muted-foreground">Freshness</span><span className="font-medium">{report.freshnessSeconds ?? "—"} s</span></div></CardContent></Card><Card><CardHeader><CardTitle>Raw evidence</CardTitle></CardHeader><CardContent className="space-y-2 text-xs text-muted-foreground"><p>{raw?.retained ? `${raw.byteLength.toLocaleString()} bytes retained until ${formatPacific(raw.expiresAt)}` : "The raw body is not retained."}</p>{raw && <p className="break-all font-mono">SHA-256 {raw.payloadHash}</p>}</CardContent></Card></div>
      </div>
    </div>
  );
}
