import { desc } from "drizzle-orm";
import { ArrowUpRight, ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPacific } from "@/lib/format";
import { db } from "@/server/db/client";
import { incidents } from "@/server/db/schema";

export const metadata: Metadata = { title: "Incidents" };
export const dynamic = "force-dynamic";

function stateClass(state: string) {
  if (state === "verified") return "border-success/25 bg-success/10 text-success";
  if (state === "rejected" || state === "preview_rejected") {
    return "border-destructive/25 bg-destructive/10 text-destructive";
  }
  return "border-warning/30 bg-warning/10 text-warning-foreground";
}

export default async function IncidentsPage() {
  const rows = await db
    .select()
    .from(incidents)
    .orderBy(desc(incidents.detectedAt))
    .limit(50);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-primary">Safety workflow</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
          Incidents
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Frozen collections, review evidence, and human-controlled recovery.
        </p>
      </div>
      <Card>
        <CardHeader className="border-b">
          <CardTitle>Recorded incidents</CardTitle>
        </CardHeader>
        <CardContent className="p-0 sm:p-0">
          {rows.length === 0 ? (
            <div className="p-10 text-center">
              <ShieldAlert className="mx-auto size-5 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">No incidents recorded</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Invalid or repeatedly unavailable collections will appear here.
              </p>
            </div>
          ) : (
            <div className="divide-y">
              {rows.map((incident) => (
                <Link
                  className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-muted/25 sm:px-6"
                  href={`/admin/incidents/${incident.id}`}
                  key={incident.id}
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg border bg-muted">
                    <ShieldAlert className="size-4 text-muted-foreground" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{incident.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatPacific(incident.detectedAt)} ·{" "}
                      {incident.classification.replaceAll("_", " ")}
                    </p>
                  </div>
                  <Badge className={stateClass(incident.state)}>
                    {incident.state.replaceAll("_", " ")}
                  </Badge>
                  <ArrowUpRight className="size-4 text-muted-foreground" />
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
