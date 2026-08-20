import {
  CircleAlert,
  CircleCheck,
  ExternalLink,
  Fingerprint,
  ShieldCheck,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPacific } from "@/lib/format";
import {
  getAdminJudgeEvidence,
  type AdminJudgeEvidence,
} from "@/server/services/admin-judge";

export const metadata: Metadata = { title: "Bright Data trust evidence" };
export const dynamic = "force-dynamic";

function statusLabel(
  status: AdminJudgeEvidence["status"] | "older" | "unavailable",
) {
  if (status === "current") return "Current";
  if (status === "partial") return "Partial";
  if (status === "older") return "Older";
  return "Unavailable";
}

function statusClass(status: string) {
  if (status === "current")
    return "border-success/25 bg-success/10 text-success-foreground";
  if (status === "older" || status === "partial")
    return "border-warning/30 bg-warning/10 text-warning-foreground";
  return "border-destructive/25 bg-destructive/10 text-destructive-content";
}

function statusIcon(status: string) {
  return status === "current" ? (
    <CircleCheck aria-hidden="true" className="size-4 text-success" />
  ) : (
    <CircleAlert aria-hidden="true" className="size-4 text-warning" />
  );
}

function timeLabel(value: string | null) {
  if (!value) return "Not available";
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime())
    ? formatPacific(parsed)
    : "Not available";
}

function countLabel(value: number | null) {
  return value === null ? "Not available" : value.toLocaleString("en-US");
}

function EvidenceStatus({ status }: { status: AdminJudgeEvidence["status"] }) {
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
            Live summaries and incident evidence are current
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            The operator projection passed its allowlist and timeline checks.
            The preview below is synthetic judging evidence, not a live payload.
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
          <h2 className="font-semibold">Evidence is partial</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Older or unavailable source rows remain visible without inferred
            counts, timestamps, or decisions.
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
        <h2 className="font-semibold">Evidence unavailable</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          No trusted live source summary or valid incident timeline is
          available. Counts and operator decisions remain unavailable.
        </p>
      </div>
    </div>
  );
}

function SourceSummaryTable({ evidence }: { evidence: AdminJudgeEvidence }) {
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Live source summaries</CardTitle>
        <p className="text-sm leading-6 text-muted-foreground">
          Read-only summaries from the existing coverage seam. Raw payloads,
          request headers, credentials, and private artifact paths are never
          rendered.
        </p>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        {evidence.source.rows.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground" role="status">
            No live source summary is available.
          </p>
        ) : (
          <table className="w-full min-w-[900px] text-left text-sm">
            <caption className="sr-only">
              Live source summaries and checked times
            </caption>
            <thead className="border-b bg-muted/20 text-xs text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium sm:px-6" scope="col">
                  Source
                </th>
                <th className="px-4 py-3 font-medium" scope="col">
                  Kind
                </th>
                <th className="px-4 py-3 font-medium" scope="col">
                  Status
                </th>
                <th className="px-4 py-3 text-right font-medium" scope="col">
                  Count
                </th>
                <th className="px-4 py-3 font-medium" scope="col">
                  Checked by UNBROKEN at
                </th>
                <th className="px-5 py-3 font-medium sm:px-6" scope="col">
                  SFMTA updated at
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {evidence.source.rows.map((row) => (
                <tr key={row.key}>
                  <th className="px-5 py-4 font-medium sm:px-6" scope="row">
                    {row.label}
                  </th>
                  <td className="px-4 py-4 text-xs capitalize text-muted-foreground">
                    {row.kind}
                  </td>
                  <td className="px-4 py-4">
                    <span
                      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${statusClass(row.status)}`}
                    >
                      {statusIcon(row.status)} {statusLabel(row.status)}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-right font-semibold tabular-nums">
                    {countLabel(row.count)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-4 text-xs text-muted-foreground">
                    {timeLabel(row.checkedAt)}
                  </td>
                  <td className="whitespace-nowrap px-5 py-4 text-xs text-muted-foreground sm:px-6">
                    {timeLabel(row.sourceUpdatedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}

function FunctionInventory({ evidence }: { evidence: AdminJudgeEvidence }) {
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Fixed extraction function inventory</CardTitle>
        <p className="text-sm leading-6 text-muted-foreground">
          These are bounded, advisory demonstrations for the existing production
          collector. They do not replace the collector or approve a healing
          preview.
        </p>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full min-w-[900px] text-left text-sm">
          <caption className="sr-only">
            Bright Data judge function inventory
          </caption>
          <thead className="border-b bg-muted/20 text-xs text-muted-foreground">
            <tr>
              <th className="px-5 py-3 font-medium sm:px-6" scope="col">
                Function
              </th>
              <th className="px-4 py-3 font-medium" scope="col">
                Role
              </th>
              <th className="px-4 py-3 font-medium" scope="col">
                Observed output
              </th>
              <th className="px-5 py-3 font-medium sm:px-6" scope="col">
                Safety rule
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {evidence.functions.map((item) => (
              <tr key={item.key}>
                <th className="px-5 py-4 font-medium sm:px-6" scope="row">
                  <span>{item.label}</span>
                  <span className="mt-1 block font-mono text-[11px] text-muted-foreground">
                    {item.key}
                  </span>
                </th>
                <td className="px-4 py-4 text-xs capitalize text-muted-foreground">
                  {item.kind}
                </td>
                <td className="max-w-[24rem] px-4 py-4 text-xs leading-5 text-muted-foreground">
                  {item.output}
                </td>
                <td className="max-w-[26rem] px-5 py-4 text-xs leading-5 text-muted-foreground sm:px-6">
                  {item.safety}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function PreviewFixture({ evidence }: { evidence: AdminJudgeEvidence }) {
  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Badge> Synthetic preview fixture </Badge>
            <CardTitle className="mt-2">
              Deterministic preview validation
            </CardTitle>
          </div>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${statusClass(evidence.preview.accepted ? "current" : "unavailable")}`}
          >
            {statusIcon(evidence.preview.accepted ? "current" : "unavailable")}{" "}
            {evidence.preview.accepted
              ? "Accepted for human review"
              : "Unavailable"}
          </span>
        </div>
        <p className="text-sm leading-6 text-muted-foreground">
          Synthetic only: these fixed checks demonstrate the same contract gate
          without presenting source rows or a production payload.
        </p>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <table className="w-full min-w-[660px] text-left text-sm">
          <caption className="sr-only">
            Synthetic deterministic preview checks
          </caption>
          <thead className="border-b bg-muted/20 text-xs text-muted-foreground">
            <tr>
              <th className="px-5 py-3 font-medium sm:px-6" scope="col">
                Check
              </th>
              <th
                className="px-5 py-3 text-right font-medium sm:px-6"
                scope="col"
              >
                Result
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {Object.entries(evidence.preview.checks).map(([key, passed]) => (
              <tr key={key}>
                <th
                  className="px-5 py-3 font-medium capitalize sm:px-6"
                  scope="row"
                >
                  {key.replaceAll(/([A-Z])/gu, " $1")}
                </th>
                <td className="px-5 py-3 text-right sm:px-6">
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success-foreground">
                    <CircleCheck
                      aria-hidden="true"
                      className="size-4 text-success"
                    />
                    {passed ? "Passed" : "Unavailable"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

function AdvisoryFixture({ evidence }: { evidence: AdminJudgeEvidence }) {
  return (
    <Card>
      <CardHeader className="border-b">
        <Badge> Synthetic advisory fixture </Badge>
        <CardTitle className="mt-2">Fireworks structured review</CardTitle>
        <p className="text-sm leading-6 text-muted-foreground">
          This advisory is not a source of truth and cannot approve, save,
          publish, or change routing.
        </p>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Provider</span>
          <span className="font-medium">{evidence.advisory.provider}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Model</span>
          <span className="max-w-[18rem] text-right font-mono text-xs">
            {evidence.advisory.model}
          </span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Reasoning</span>
          <span className="font-medium">
            {evidence.advisory.reasoningEffort}
          </span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Recommendation</span>
          <span className="font-medium">Human review</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Confidence (synthetic)</span>
          <span className="font-medium">{evidence.advisory.confidence}%</span>
        </div>
        <p className="rounded-lg border bg-muted/25 p-3 text-xs leading-5 text-muted-foreground">
          Advisory only. Human approval is still required.
        </p>
      </CardContent>
    </Card>
  );
}

function Timeline({
  title,
  label,
  timeline,
  unavailableCopy,
}: {
  title: string;
  label: string;
  timeline: AdminJudgeEvidence["syntheticTimeline"];
  unavailableCopy: string;
}) {
  return (
    <Card>
      <CardHeader className="border-b">
        <Badge>{label}</Badge>
        <CardTitle className="mt-2">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {timeline.status === "unavailable" ? (
          <p className="text-sm text-muted-foreground">{unavailableCopy}</p>
        ) : (
          <ol className="space-y-4" aria-label={title}>
            {timeline.events.map((event) => (
              <li className="relative flex gap-3" key={event.id}>
                <span className="mt-1 grid size-6 shrink-0 place-items-center rounded-full border bg-muted">
                  <CircleCheck
                    aria-hidden="true"
                    className="size-3.5 text-success"
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{event.summary}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {timeLabel(event.createdAt)} · {event.actor} ·{" "}
                    {event.toState}
                  </p>
                  <p className="mt-1 break-all font-mono text-[10px] text-muted-foreground">
                    Evidence hash {event.evidenceHash}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

export default async function JudgePage() {
  const evidence = await getAdminJudgeEvidence();
  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge>Private operator view</Badge>
            <Badge>Sanitized evidence</Badge>
          </div>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">
            Bright Data trust evidence
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            A read-only judge path for the fixed production collector,
            deterministic preview checks, advisory review, and the human
            approval gate.
          </p>
        </div>
        <Link
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          href="/admin/incidents"
        >
          Open incident controls{" "}
          <ExternalLink aria-hidden="true" className="size-3.5" />
        </Link>
      </div>

      <EvidenceStatus status={evidence.status} />

      <Card>
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2">
            <Fingerprint aria-hidden="true" className="size-4 text-primary" />
            Collector identity
          </CardTitle>
          <p className="text-sm leading-6 text-muted-foreground">
            The identity is fixed across collection, healing, approval, and
            verification.
          </p>
        </CardHeader>
        <CardContent className="grid gap-4 pt-5 sm:grid-cols-3 sm:pt-6">
          <div>
            <p className="text-xs text-muted-foreground">Collector name</p>
            <p className="mt-2 text-sm font-medium">
              {evidence.collector.name}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Fixed collector ID</p>
            <p className="mt-2 break-all font-mono text-xs">
              {evidence.collector.collectorId}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Pinned source</p>
            <a
              className="mt-2 inline-flex min-h-11 items-center gap-1.5 break-all text-xs font-medium text-primary hover:underline"
              href={evidence.collector.sourceUrl}
              rel="noreferrer"
              target="_blank"
            >
              SFMTA elevator status{" "}
              <ExternalLink aria-hidden="true" className="size-3.5 shrink-0" />
            </a>
          </div>
        </CardContent>
      </Card>

      <FunctionInventory evidence={evidence} />
      <SourceSummaryTable evidence={evidence} />

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <PreviewFixture evidence={evidence} />
        <AdvisoryFixture evidence={evidence} />
      </div>

      <Card>
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck aria-hidden="true" className="size-4 text-primary" />
            Human approval required
          </CardTitle>
          <p className="text-sm leading-6 text-muted-foreground">
            A valid preview opens a decision gate; this evidence presentation
            never records a decision.
          </p>
        </CardHeader>
        <CardContent className="space-y-4 pt-5 sm:pt-6">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border bg-muted/20 p-4">
              <p className="text-sm font-medium">
                Automatic approval is disabled
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                The advisory cannot approve or save a collector.
              </p>
            </div>
            <div className="rounded-xl border bg-muted/20 p-4">
              <p className="text-sm font-medium">Explicit human approval</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Reject or approve only in the protected incident controls.
              </p>
            </div>
            <div className="rounded-xl border bg-muted/20 p-4">
              <p className="text-sm font-medium">
                Post-approval verification required
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                A fresh live collection must pass before trust is restored.
              </p>
            </div>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            No operator decision can be recorded from this view. Use the
            existing incident page for the typed human gate.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Timeline
          label="Synthetic judge timeline"
          title="Preview → advisory → human gate"
          timeline={evidence.syntheticTimeline}
          unavailableCopy="No synthetic timeline evidence is available."
        />
        <Timeline
          label="Live incident timeline"
          title="Existing healing evidence"
          timeline={evidence.liveTimeline}
          unavailableCopy="No live incident timeline is available."
        />
      </div>

      <p className="text-right font-mono text-[10px] text-muted-foreground">
        Sanitized evidence hash {evidence.evidenceHash}
      </p>
    </div>
  );
}
