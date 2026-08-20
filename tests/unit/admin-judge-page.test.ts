import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import JudgePage from "@/app/admin/judge/page";
import {
  getAdminJudgeEvidence,
  type AdminJudgeEvidence,
} from "@/server/services/admin-judge";

vi.mock("@/server/services/admin-judge", () => ({
  getAdminJudgeEvidence: vi.fn(),
}));

const sourceRows = [
  {
    key: "static_schedule",
    label: "Static schedule",
    kind: "static",
    status: "current",
    count: 6,
    checkedAt: "2026-08-20T12:00:00.000Z",
    sourceUpdatedAt: "2026-08-20T11:59:00.000Z",
    sourceUrl: "https://511.org/open-data/transit",
  },
  ...[
    ["trip_updates", "Trip updates", 120],
    ["vehicles", "Vehicle positions", 80],
    ["alerts", "Service alerts", 4],
  ].map(([key, label, count]) => ({
    key,
    label,
    kind: "realtime",
    status: "current",
    count,
    checkedAt: "2026-08-20T12:00:00.000Z",
    sourceUpdatedAt: null,
    sourceUrl: "https://511.org/open-data/transit",
  })),
  ...[
    ["elevators", "Elevator observations", 22],
    ["accessibility_advisories", "Accessibility advisories", 11],
    ["stop_relocations", "Stop relocations", 6],
    ["stop_accessibility", "Accessible-stop guidance", 41],
  ].map(([key, label, count]) => ({
    key,
    label,
    kind: "trusted",
    status: "current",
    count,
    checkedAt: "2026-08-20T12:00:00.000Z",
    sourceUpdatedAt: null,
    sourceUrl: "https://www.sfmta.com/trusted-source",
  })),
];

const baseEvidence = {
  status: "current",
  synthetic: true,
  sanitized: true,
  collector: {
    name: "SFMTA elevator status trusted collector",
    collectorId: "c_msyjsllt1r9ej5tdub",
    sourceUrl:
      "https://www.sfmta.com/elevator-status/elevatorstatus.php?src=prod",
    identityStable: true,
  },
  functions: [
    {
      key: "navigate",
      label: "Advisory navigate",
      kind: "advisory",
      description: "Open the pinned source.",
      output: "Source identity.",
      safety: "No publication.",
    },
    {
      key: "wait",
      label: "Advisory wait",
      kind: "advisory",
      description: "Bounded observation.",
      output: "Unavailable on timeout.",
      safety: "No inference.",
    },
    {
      key: "parse",
      label: "Structured parser",
      kind: "advisory",
      description: "Fixed fields.",
      output: "Contract checks.",
      safety: "Unknown stays unknown.",
    },
    {
      key: "relocation_on_response_json",
      label: "Relocation on_response JSON interception",
      kind: "interception",
      description: "Allowlisted response.",
      output: "Sanitized summary.",
      safety: "No raw body.",
    },
    {
      key: "accessible_stop_extraction",
      label: "Deterministic accessible-stop extraction",
      kind: "extractor",
      description: "Fixed contract.",
      output: "Safe count.",
      safety: "Unavailable when missing.",
    },
  ],
  source: { status: "current", rows: sourceRows },
  preview: {
    accepted: true,
    contractVersion: "sfmta-elevator-v1",
    collectorIdStable: true,
    structuralFingerprintStable: true,
    identityDiff: { missing: [], added: [] },
    checks: {
      contract: true,
      sourceIdentity: true,
      freshness: true,
      stationCoverage: true,
      uniqueEquipment: true,
      statusValues: true,
      stationConsistency: true,
      stableStructure: true,
    },
  },
  advisory: {
    provider: "Fireworks AI",
    model: "accounts/fireworks/models/deepseek-v4-flash-0731",
    reasoningEffort: "high",
    recommendation: "human_review",
    confidence: 86,
    advisoryOnly: true,
  },
  humanGate: {
    approvalRequired: true,
    automaticApproval: false,
    postApprovalVerificationRequired: true,
    actionsAvailable: false,
  },
  syntheticTimeline: {
    status: "current",
    events: [
      {
        id: "synthetic-detected",
        eventType: "incident.detected",
        createdAt: "2026-08-20T12:00:00.000Z",
        fromState: null,
        toState: "detected",
        actor: "system",
        summary: "A synthetic incident is frozen.",
        evidenceHash: "a".repeat(64),
      },
      {
        id: "synthetic-acknowledged",
        eventType: "incident.acknowledged",
        createdAt: "2026-08-20T12:00:01.000Z",
        fromState: "detected",
        toState: "acknowledged",
        actor: "human",
        summary: "An operator acknowledgement is required.",
        evidenceHash: "a".repeat(64),
      },
      {
        id: "synthetic-heal",
        eventType: "healing.requested",
        createdAt: "2026-08-20T12:00:02.000Z",
        fromState: "acknowledged",
        toState: "heal_requested",
        actor: "human",
        summary: "A bounded preview is requested.",
        evidenceHash: "a".repeat(64),
      },
      {
        id: "synthetic-received",
        eventType: "healing.preview_received",
        createdAt: "2026-08-20T12:00:03.000Z",
        fromState: "heal_requested",
        toState: "preview_received",
        actor: "system",
        summary: "The preview stops at the approval gate.",
        evidenceHash: "a".repeat(64),
      },
      {
        id: "synthetic-validated",
        eventType: "healing.preview_validated",
        createdAt: "2026-08-20T12:00:04.000Z",
        fromState: "preview_received",
        toState: "awaiting_review",
        actor: "system",
        summary: "Deterministic preview checks passed.",
        evidenceHash: "a".repeat(64),
      },
      {
        id: "synthetic-review",
        eventType: "llm.review_completed",
        createdAt: "2026-08-20T12:00:05.000Z",
        fromState: "awaiting_review",
        toState: "awaiting_approval",
        actor: "advisory",
        summary: "Advisory review remains non-authoritative.",
        evidenceHash: "a".repeat(64),
      },
    ],
  },
  liveTimeline: {
    status: "current",
    events: [
      {
        id: "live-detected",
        eventType: "incident.detected",
        createdAt: "2026-08-20T12:00:00.000Z",
        fromState: null,
        toState: "detected",
        actor: "system",
        summary: "A protected incident was detected.",
        evidenceHash: "b".repeat(64),
      },
      {
        id: "live-acknowledged",
        eventType: "incident.acknowledged",
        createdAt: "2026-08-20T12:00:01.000Z",
        fromState: "detected",
        toState: "acknowledged",
        actor: "human",
        summary: "An operator acknowledged the incident.",
        evidenceHash: "b".repeat(64),
      },
      {
        id: "live-heal",
        eventType: "healing.requested",
        createdAt: "2026-08-20T12:00:02.000Z",
        fromState: "acknowledged",
        toState: "heal_requested",
        actor: "human",
        summary: "A bounded preview was requested.",
        evidenceHash: "b".repeat(64),
      },
      {
        id: "live-received",
        eventType: "healing.preview_received",
        createdAt: "2026-08-20T12:00:03.000Z",
        fromState: "heal_requested",
        toState: "preview_received",
        actor: "system",
        summary: "The preview stopped at the approval gate.",
        evidenceHash: "b".repeat(64),
      },
      {
        id: "live-validated",
        eventType: "healing.preview_validated",
        createdAt: "2026-08-20T12:00:04.000Z",
        fromState: "preview_received",
        toState: "awaiting_review",
        actor: "system",
        summary: "Deterministic checks passed.",
        evidenceHash: "b".repeat(64),
      },
      {
        id: "live-review",
        eventType: "llm.review_completed",
        createdAt: "2026-08-20T12:00:05.000Z",
        fromState: "awaiting_review",
        toState: "awaiting_approval",
        actor: "advisory",
        summary: "Advisory review remains non-authoritative.",
        evidenceHash: "b".repeat(64),
      },
    ],
  },
  evidenceHash: "c".repeat(64),
} as unknown as AdminJudgeEvidence;

async function markup(evidence: AdminJudgeEvidence = baseEvidence) {
  vi.mocked(getAdminJudgeEvidence).mockResolvedValue(evidence);
  return renderToStaticMarkup(await JudgePage());
}

describe("operator Bright Data judge page seam", () => {
  beforeEach(() => vi.clearAllMocks());

  it("separates synthetic fixtures from live summaries and exposes keyboard-readable evidence", async () => {
    const html = await markup();

    expect(html).toContain("Bright Data trust evidence");
    expect(html).toContain("Private operator view");
    expect(html).toContain("Synthetic preview fixture");
    expect(html).toContain("Synthetic advisory fixture");
    expect(html).toContain("Live incident timeline");
    expect(html).toContain("Human approval required");
    expect(html).toContain("Automatic approval is disabled");
    expect(html).toContain("Post-approval verification required");
    expect(html).toContain("c_msyjsllt1r9ej5tdub");
    expect(html).toContain("Relocation on_response JSON interception");
    expect(html).toContain("Deterministic accessible-stop extraction");
    expect(html).toContain("Checked by UNBROKEN at");
    expect(html).toContain("SFMTA updated at");

    const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/gu)].map(
      (match) => match[0],
    );
    expect(tables.length).toBeGreaterThanOrEqual(3);
    expect(tables.every((table) => table.includes("<caption"))).toBe(true);
    expect(html).toContain('scope="col"');
    expect(html).toContain('scope="row"');
    expect(html).toContain(
      'href="https://www.sfmta.com/elevator-status/elevatorstatus.php?src=prod"',
    );
    expect(html).not.toContain("/data/incidents");
    expect(html).not.toContain("Bearer");
    expect(html).not.toContain("rawPayload");
  });

  it("keeps the operator route behind the existing operate capability gate", () => {
    const layout = readFileSync(
      new URL("../../src/app/admin/layout.tsx", import.meta.url),
      "utf8",
    );
    expect(layout).toContain("requireOperatorCapability");
    expect(layout).toContain("operate");
  });

  it("renders unavailable evidence without fabricated counts or active decisions", async () => {
    const unavailable = {
      ...baseEvidence,
      status: "unavailable",
      source: {
        status: "unavailable",
        rows: sourceRows.map((row) => ({
          ...row,
          status: "unavailable",
          count: null,
          checkedAt: null,
          sourceUpdatedAt: null,
          sourceUrl: null,
        })),
      },
      liveTimeline: { status: "unavailable", events: [] },
      humanGate: { ...baseEvidence.humanGate, actionsAvailable: false },
    } as unknown as AdminJudgeEvidence;
    const html = await markup(unavailable);

    expect(html).toContain("Evidence unavailable");
    expect(html).toContain("Not available");
    expect(html).not.toContain("120");
    expect(html).not.toContain("80");
    expect(html).not.toContain("41");
    expect(html).toContain("No live incident timeline is available");
    expect(html).toContain(
      "No operator decision can be recorded from this view",
    );
  });
});
