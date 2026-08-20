import { describe, expect, it } from "vitest";

import {
  BRIGHT_DATA_JUDGE_COLLECTOR_ID,
  BRIGHT_DATA_JUDGE_SOURCE_URL,
  buildJudgeTimeline,
  getJudgeFunctionInventory,
  hashJudgeEvidence,
  redactJudgeEvidence,
  transitionJudgeState,
  type JudgeTimelineInput,
} from "@/domain/judge/model";

describe("Bright Data judge evidence domain seam", () => {
  it("pins the production collector and source identity", () => {
    expect(BRIGHT_DATA_JUDGE_COLLECTOR_ID).toBe("c_msyjsllt1r9ej5tdub");
    expect(BRIGHT_DATA_JUDGE_SOURCE_URL).toBe(
      "https://www.sfmta.com/elevator-status/elevatorstatus.php?src=prod",
    );
  });

  it("returns the fixed advisory function inventory", () => {
    expect(getJudgeFunctionInventory()).toEqual([
      expect.objectContaining({ key: "navigate", kind: "advisory" }),
      expect.objectContaining({ key: "wait", kind: "advisory" }),
      expect.objectContaining({ key: "parse", kind: "advisory" }),
      expect.objectContaining({
        key: "relocation_on_response_json",
        kind: "interception",
      }),
      expect.objectContaining({
        key: "accessible_stop_extraction",
        kind: "extractor",
      }),
    ]);
  });

  it("redacts secret, raw, and private artifact fields before hashing", () => {
    const evidence = {
      authorization: "Bearer production-token",
      api_key: "key-do-not-display",
      rawPayload: { station: "private-source-row" },
      privateArtifactPath: "/data/incidents/private/preview.json",
      sourceUrl: BRIGHT_DATA_JUDGE_SOURCE_URL,
      summary: "The deterministic preview passed.",
    };
    const sanitized = redactJudgeEvidence(evidence);

    expect(JSON.stringify(sanitized)).not.toContain("production-token");
    expect(JSON.stringify(sanitized)).not.toContain("key-do-not-display");
    expect(JSON.stringify(sanitized)).not.toContain("private-source-row");
    expect(JSON.stringify(sanitized)).not.toContain("/data/incidents");
    expect(sanitized).toMatchObject({
      authorization: "[REDACTED]",
      api_key: "[REDACTED]",
      rawPayload: "[REDACTED]",
      privateArtifactPath: "[REDACTED]",
      sourceUrl: BRIGHT_DATA_JUDGE_SOURCE_URL,
    });

    const hash = hashJudgeEvidence(sanitized);
    expect(hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(hashJudgeEvidence(sanitized)).toBe(hash);
    expect(hashJudgeEvidence({ ...evidence, summary: "changed" })).not.toBe(
      hash,
    );
  });

  it("keeps the preview and verification gate typed and human-controlled", () => {
    expect(transitionJudgeState("preview_received", "validate_preview")).toBe(
      "awaiting_review",
    );
    expect(transitionJudgeState("awaiting_review", "approve")).toBe("approved");
    expect(transitionJudgeState("approved", "verify")).toBe("verified");
    expect(() => transitionJudgeState("preview_received", "approve")).toThrow(
      /cannot transition/u,
    );
    expect(() =>
      transitionJudgeState("awaiting_review", "auto_approve"),
    ).toThrow(/Unknown judge action/u);
  });

  it("sorts a valid timeline and fails closed for an invalid transition", () => {
    const validEvents: JudgeTimelineInput[] = [
      {
        id: "detected",
        eventType: "incident.detected",
        createdAt: "2026-08-20T12:00:00.000Z",
        fromState: null,
        toState: "detected",
        actor: "system",
        summary: "A protected incident was detected.",
      },
      {
        id: "acknowledged",
        eventType: "incident.acknowledged",
        createdAt: "2026-08-20T12:00:30.000Z",
        fromState: "detected",
        toState: "acknowledged",
        actor: "human",
        summary: "An operator acknowledged the incident.",
      },
      {
        id: "heal-requested",
        eventType: "healing.requested",
        createdAt: "2026-08-20T12:00:45.000Z",
        fromState: "acknowledged",
        toState: "heal_requested",
        actor: "human",
        summary: "A bounded healing preview was requested.",
      },
      {
        id: "received",
        eventType: "healing.preview_received",
        createdAt: "2026-08-20T12:00:55.000Z",
        fromState: "heal_requested",
        toState: "preview_received",
        actor: "system",
        summary: "A bounded preview was received.",
      },
      {
        id: "preview",
        eventType: "healing.preview_validated",
        createdAt: "2026-08-20T12:01:00.000Z",
        fromState: "preview_received",
        toState: "awaiting_review",
        actor: "system",
        summary: "All deterministic preview checks passed.",
      },
      {
        id: "approval-gate",
        eventType: "llm.review_completed",
        createdAt: "2026-08-20T12:02:00.000Z",
        fromState: "awaiting_review",
        toState: "awaiting_approval",
        actor: "advisory",
        summary: "Advisory review remains non-authoritative.",
      },
      {
        id: "approve",
        eventType: "human.approved",
        createdAt: "2026-08-20T12:03:00.000Z",
        fromState: "awaiting_approval",
        toState: "approved",
        actor: "human",
        summary: "Explicit human approval recorded.",
      },
      {
        id: "verification-succeeded",
        eventType: "healing.verification_succeeded",
        createdAt: "2026-08-20T12:04:00.000Z",
        fromState: "approved",
        toState: "verified",
        actor: "human",
        summary: "Fresh verification passed for the fixed collector.",
      },
    ];

    const timeline = buildJudgeTimeline(validEvents);
    expect(timeline.status).toBe("current");
    expect(timeline.events.map((event) => event.id)).toEqual([
      "detected",
      "acknowledged",
      "heal-requested",
      "received",
      "preview",
      "approval-gate",
      "approve",
      "verification-succeeded",
    ]);
    expect(timeline.events[5]).toMatchObject({
      actor: "advisory",
      toState: "awaiting_approval",
    });
    expect(timeline.events.at(-1)).toMatchObject({
      eventType: "healing.verification_succeeded",
      toState: "verified",
    });

    const invalid = buildJudgeTimeline([
      {
        id: "invalid-approve",
        eventType: "human.approved",
        createdAt: "2026-08-20T12:01:00.000Z",
        fromState: "preview_received",
        toState: "approved",
        actor: "human",
        summary: "Approval without a validated preview.",
      },
    ]);
    expect(invalid).toEqual({ status: "unavailable", events: [] });

    const forgedVerification = buildJudgeTimeline([
      {
        id: "detected",
        eventType: "incident.detected",
        createdAt: "2026-08-20T12:00:00.000Z",
        fromState: null,
        toState: "detected",
        actor: "system",
        summary: "A protected incident was detected.",
      },
      {
        id: "forged-verification",
        eventType: "healing.verification_succeeded",
        createdAt: "2026-08-20T12:01:00.000Z",
        fromState: "detected",
        toState: "detected",
        actor: "human",
        summary: "A forged verification result was supplied.",
      },
    ]);
    expect(forgedVerification).toEqual({
      status: "unavailable",
      events: [],
    });
  });

  it("requires the real initial transition and rejects future timeline events", () => {
    const missingInitial = buildJudgeTimeline([
      {
        id: "mid-incident",
        eventType: "incident.acknowledged",
        createdAt: "2026-08-20T12:00:00.000Z",
        fromState: "detected",
        toState: "acknowledged",
        actor: "human",
        summary: "An operator acknowledged the incident.",
      },
    ]);
    expect(missingInitial).toEqual({ status: "unavailable", events: [] });

    const future = buildJudgeTimeline(
      [
        {
          id: "detected",
          eventType: "incident.detected",
          createdAt: "2026-08-20T12:00:00.000Z",
          fromState: null,
          toState: "detected",
          actor: "system",
          summary: "A protected incident was detected.",
        },
        {
          id: "acknowledged",
          eventType: "incident.acknowledged",
          createdAt: "2026-08-20T12:06:00.000Z",
          fromState: "detected",
          toState: "acknowledged",
          actor: "human",
          summary: "An operator acknowledged the incident.",
        },
      ],
      new Date("2026-08-20T12:05:00.000Z"),
    );
    expect(future).toEqual({ status: "unavailable", events: [] });
  });

  it("allows a second healing request after rejection and rejects forged self-state evidence", () => {
    const retry = buildJudgeTimeline([
      {
        id: "detected",
        eventType: "incident.detected",
        createdAt: "2026-08-20T12:00:00.000Z",
        fromState: null,
        toState: "detected",
        actor: "system",
        summary: "A protected incident was detected.",
      },
      {
        id: "acknowledged",
        eventType: "incident.acknowledged",
        createdAt: "2026-08-20T12:00:01.000Z",
        fromState: "detected",
        toState: "acknowledged",
        actor: "human",
        summary: "An operator acknowledged the incident.",
      },
      {
        id: "heal",
        eventType: "healing.requested",
        createdAt: "2026-08-20T12:00:02.000Z",
        fromState: "acknowledged",
        toState: "heal_requested",
        actor: "human",
        summary: "A bounded healing preview was requested.",
      },
      {
        id: "received",
        eventType: "healing.preview_received",
        createdAt: "2026-08-20T12:00:03.000Z",
        fromState: "heal_requested",
        toState: "preview_received",
        actor: "system",
        summary: "A bounded preview was received.",
      },
      {
        id: "preview-rejected",
        eventType: "healing.preview_rejected",
        createdAt: "2026-08-20T12:00:04.000Z",
        fromState: "preview_received",
        toState: "preview_rejected",
        actor: "system",
        summary: "Deterministic preview checks failed.",
      },
      {
        id: "rejected",
        eventType: "healing.rejected",
        createdAt: "2026-08-20T12:00:05.000Z",
        fromState: "preview_rejected",
        toState: "rejected",
        actor: "human",
        summary: "The proposal was rejected.",
      },
      {
        id: "retry-heal",
        eventType: "healing.requested",
        createdAt: "2026-08-20T12:00:06.000Z",
        fromState: "rejected",
        toState: "heal_requested",
        actor: "human",
        summary: "A new bounded healing preview was requested.",
      },
    ]);
    expect(retry.status).toBe("current");
    expect(retry.events.at(-1)).toMatchObject({
      eventType: "healing.requested",
      fromState: "rejected",
      toState: "heal_requested",
    });

    const forgedEvents = [
      {
        id: "forged-proposal",
        eventType: "healing.proposal_rejected",
        fromState: "awaiting_approval" as const,
        toState: "awaiting_approval" as const,
        actor: "system" as const,
        summary: "A forged proposal rejection was supplied.",
      },
      {
        id: "forged-review",
        eventType: "llm.review_requires_human",
        fromState: "awaiting_approval" as const,
        toState: "awaiting_approval" as const,
        actor: "system" as const,
        summary: "A forged review event was supplied.",
      },
      {
        id: "forged-gate",
        eventType: "human.approval_gate_opened",
        fromState: "awaiting_review" as const,
        toState: "awaiting_review" as const,
        actor: "system" as const,
        summary: "A forged approval gate event was supplied.",
      },
    ];
    for (const event of forgedEvents) {
      expect(
        buildJudgeTimeline([
          {
            id: "initial",
            eventType: "incident.detected",
            createdAt: "2026-08-20T12:00:00.000Z",
            fromState: null,
            toState: "detected",
            actor: "system",
            summary: "A protected incident was detected.",
          },
          {
            ...event,
            createdAt: "2026-08-20T12:00:01.000Z",
          },
        ]),
      ).toEqual({ status: "unavailable", events: [] });
    }
  });
});
