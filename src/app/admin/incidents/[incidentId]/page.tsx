import { ArrowLeft, Bot, CheckCircle2, CircleDot, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { IncidentActions } from "@/components/incident-actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPacific } from "@/lib/format";
import { IncidentNotFoundError, incidentDetail } from "@/server/services/incidents";

export const metadata: Metadata = { title: "Incident evidence" };
export const dynamic = "force-dynamic";

export default async function IncidentPage({
  params,
}: {
  params: Promise<{ incidentId: string }>;
}) {
  const { incidentId } = await params;
  let detail;
  try {
    detail = await incidentDetail(incidentId);
  } catch (error) {
    if (error instanceof IncidentNotFoundError) notFound();
    throw error;
  }

  const latestReview = detail.reviews[0];
  const deterministic = detail.events.find(
    (event) => event.eventType === "healing.preview_validated" ||
      event.eventType === "healing.preview_rejected",
  );
  const contractReport = deterministic?.details.contractReport as
    | { checks?: Array<{ id: string; passed: boolean; details: string }> }
    | undefined;

  const verified = detail.incident.state === "verified";
  return (
    <div className="space-y-6">
      <div>
        <Link
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          href="/admin/incidents"
        >
          <ArrowLeft className="size-3.5" /> Back to incidents
        </Link>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Badge>{detail.incident.state.replaceAll("_", " ")}</Badge>
          <span className="font-mono text-xs text-muted-foreground">
            {detail.incident.id}
          </span>
        </div>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
          {detail.incident.title}
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          {detail.incident.summary}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-5 sm:pt-6">
            <p className="text-xs text-muted-foreground">Classification</p>
            <p className="mt-2 text-sm font-medium capitalize">
              {detail.incident.classification.replaceAll("_", " ")}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 sm:pt-6">
            <p className="text-xs text-muted-foreground">Detected</p>
            <p className="mt-2 text-sm font-medium">
              {formatPacific(detail.incident.detectedAt)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 sm:pt-6">
            <p className="text-xs text-muted-foreground">Publication</p>
            <p className="mt-2 inline-flex items-center gap-2 text-sm font-medium">
              <ShieldCheck className="size-4 text-success" /> {verified ? "Verified and restored" : "Last trusted data held"}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          {contractReport?.checks && (
            <Card>
              <CardHeader className="border-b">
                <CardTitle>Deterministic preview checks</CardTitle>
              </CardHeader>
              <CardContent className="divide-y p-0">
                {contractReport.checks.map((check) => (
                  <div className="flex gap-3 px-5 py-4 sm:px-6" key={check.id}>
                    {check.passed ? (
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                    ) : (
                      <CircleDot className="mt-0.5 size-4 shrink-0 text-destructive" />
                    )}
                    <div>
                      <p className="text-sm font-medium capitalize">
                        {check.id.replaceAll("_", " ")}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        {check.details}
                      </p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="border-b">
              <CardTitle>Evidence timeline</CardTitle>
            </CardHeader>
            <CardContent className="divide-y p-0">
              {detail.events.map((event) => (
                <div className="flex gap-3 px-5 py-4 sm:px-6" key={event.id}>
                  <CircleDot className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium">
                      {event.eventType.replaceAll(".", " ")}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatPacific(event.createdAt)} ·{" "}
                      {event.toState.replaceAll("_", " ")}
                    </p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Recovery controls</CardTitle>
            </CardHeader>
            <CardContent>
              <IncidentActions
                incidentId={detail.incident.id}
                state={detail.incident.state}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bot className="size-4" /> Fireworks advisory
              </CardTitle>
            </CardHeader>
            <CardContent>
              {latestReview ? (
                <div className="space-y-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Recommendation</span>
                    <span className="font-medium capitalize">
                      {latestReview.recommendation?.replaceAll("_", " ") ??
                        "Human review"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Confidence</span>
                    <span className="font-medium">
                      {latestReview.confidence ?? "—"}%
                    </span>
                  </div>
                  <p className="text-xs leading-5 text-muted-foreground">
                    Advisory only. It cannot approve or change the collector.
                  </p>
                </div>
              ) : (
                <p className="text-xs leading-5 text-muted-foreground">
                  Available only after every deterministic preview check passes.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
