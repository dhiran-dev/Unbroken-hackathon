import { describe, expect, it } from "vitest";

import {
  BRIGHT_DATA_JUDGE_COLLECTOR_ID,
  BRIGHT_DATA_JUDGE_SOURCE_URL,
} from "@/domain/judge/model";
import {
  createAdminJudgeService,
  type AdminJudgeReaders,
} from "@/server/services/admin-judge";

const checkedAt = new Date("2026-08-20T12:05:00.000Z");

const coverage = {
  status: "current",
  static: {
    status: "current",
    state: "current",
    serviceDate: "2026-08-20",
    activeServiceCount: 6,
    counts: {
      stops: 3_238,
      routes: 68,
      trips: 50_690,
      stopTimes: 1_901_119,
      services: 6,
      shapePoints: 45_308,
    },
    checkedAt,
    sourceUpdatedAt: new Date("2026-08-20T11:59:00.000Z"),
    sourceUrl: "https://511.org/open-data/transit",
  },
  realtime: [
    {
      feedType: "trip_updates",
      status: "current",
      entityCount: 120,
      checkedAt,
      sourceUpdatedAt: null,
      expiresAt: new Date("2026-08-20T12:05:00.000Z"),
      sourceUrl: "https://511.org/open-data/transit",
    },
    {
      feedType: "vehicles",
      status: "current",
      entityCount: 80,
      checkedAt,
      sourceUpdatedAt: null,
      expiresAt: new Date("2026-08-20T12:05:00.000Z"),
      sourceUrl: "https://511.org/open-data/transit",
    },
    {
      feedType: "alerts",
      status: "current",
      entityCount: 4,
      checkedAt,
      sourceUpdatedAt: null,
      expiresAt: new Date("2026-08-20T12:05:00.000Z"),
      sourceUrl: "https://511.org/open-data/transit",
    },
  ],
  sources: [
    {
      key: "elevators",
      label: "Elevator observations",
      status: "current",
      rowCount: 22,
      checkedAt,
      sourceUpdatedAt: null,
      sourceUrl: BRIGHT_DATA_JUDGE_SOURCE_URL,
    },
    {
      key: "accessibility_advisories",
      label: "Accessibility advisories",
      status: "current",
      rowCount: 11,
      checkedAt,
      sourceUpdatedAt: null,
      sourceUrl: "https://www.sfmta.com/travel-transit-updates",
    },
    {
      key: "stop_relocations",
      label: "Stop relocations",
      status: "current",
      rowCount: 6,
      checkedAt,
      sourceUpdatedAt: null,
      sourceUrl:
        "https://www.sfmta.com/travel-updates/temporary-stop-relocations",
    },
    {
      key: "stop_accessibility",
      label: "Accessible-stop guidance",
      status: "current",
      rowCount: 41,
      checkedAt,
      sourceUpdatedAt: null,
      sourceUrl:
        "https://www.sfmta.com/getting-around/sfmta-accessibility/muni-access-guide/access-muni-metro/muni-metro-accessible-stops",
    },
  ],
};

const incident = {
  incident: {
    state: "awaiting_approval",
  },
  reviews: [{ recommendation: "human_review", confidence: 86 }],
  events: [
    {
      id: "00000000-0000-4000-8000-000000000005",
      eventType: "llm.review_completed",
      createdAt: new Date("2026-08-20T12:05:00.000Z"),
      fromState: "awaiting_review",
      toState: "awaiting_approval",
      actorUserId: null,
      details: {
        authorization: "Bearer do-not-display",
        artifact: "/data/incidents/private/llm-review.json",
      },
    },
    {
      id: "00000000-0000-4000-8000-000000000006",
      eventType: "healing.preview_received",
      createdAt: new Date("2026-08-20T12:03:00.000Z"),
      fromState: "heal_requested",
      toState: "preview_received",
      actorUserId: null,
      details: { collectorIdStable: true },
    },
    {
      id: "00000000-0000-4000-8000-000000000004",
      eventType: "healing.preview_validated",
      createdAt: new Date("2026-08-20T12:04:00.000Z"),
      fromState: "preview_received",
      toState: "awaiting_review",
      actorUserId: "operator-secret",
      details: { rawPayload: { station: "private-row" } },
    },
    {
      id: "00000000-0000-4000-8000-000000000001",
      eventType: "incident.detected",
      createdAt: new Date("2026-08-20T12:00:00.000Z"),
      fromState: null,
      toState: "detected",
      actorUserId: null,
      details: { publicationFrozen: true },
    },
    {
      id: "00000000-0000-4000-8000-000000000002",
      eventType: "incident.acknowledged",
      createdAt: new Date("2026-08-20T12:01:00.000Z"),
      fromState: "detected",
      toState: "acknowledged",
      actorUserId: "operator-secret",
      details: { humanInitiated: true },
    },
    {
      id: "00000000-0000-4000-8000-000000000003",
      eventType: "healing.requested",
      createdAt: new Date("2026-08-20T12:02:00.000Z"),
      fromState: "acknowledged",
      toState: "heal_requested",
      actorUserId: "operator-secret",
      details: { promptHash: "a".repeat(64) },
    },
  ],
};

function readers(
  overrides: Partial<AdminJudgeReaders> = {},
): AdminJudgeReaders {
  return {
    readSourceSummary: async () => coverage,
    readIncidentEvidence: async () => incident,
    ...overrides,
  };
}

describe("operator Bright Data judge projection seam", () => {
  it("presents fixed synthetic functions, safe source summaries, and a typed healing timeline", async () => {
    const result =
      await createAdminJudgeService(readers()).getEvidence(checkedAt);

    expect(result.status).toBe("current");
    expect(result.synthetic).toBe(true);
    expect(result.collector).toEqual({
      name: "SFMTA elevator status trusted collector",
      collectorId: BRIGHT_DATA_JUDGE_COLLECTOR_ID,
      sourceUrl: BRIGHT_DATA_JUDGE_SOURCE_URL,
      identityStable: true,
    });
    expect(result.functions).toHaveLength(5);
    expect(result.functions.map((item) => item.key)).toEqual([
      "navigate",
      "wait",
      "parse",
      "relocation_on_response_json",
      "accessible_stop_extraction",
    ]);
    expect(result.source.status).toBe("current");
    expect(result.source.rows).toHaveLength(8);
    expect(result.source.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "elevators",
          count: 22,
          status: "current",
        }),
        expect.objectContaining({
          key: "stop_relocations",
          count: 6,
          status: "current",
        }),
      ]),
    );
    expect(result.liveTimeline.status).toBe("current");
    expect(result.liveTimeline.events.at(-1)).toMatchObject({
      eventType: "llm.review_completed",
      toState: "awaiting_approval",
      actor: "advisory",
    });
    expect(result.humanGate).toMatchObject({
      approvalRequired: true,
      automaticApproval: false,
      postApprovalVerificationRequired: true,
    });
    expect(result.evidenceHash).toMatch(/^[a-f0-9]{64}$/u);

    const output = JSON.stringify(result);
    expect(output).not.toContain("do-not-display");
    expect(output).not.toContain("/data/incidents");
    expect(output).not.toContain("private-row");
    expect(output).not.toContain("operator-secret");
  });

  it("fails closed when coverage and incident evidence are unavailable", async () => {
    const result = await createAdminJudgeService(
      readers({
        readSourceSummary: async () => null,
        readIncidentEvidence: async () => {
          throw new Error("database unavailable");
        },
      }),
    ).getEvidence(checkedAt);

    expect(result.status).toBe("unavailable");
    expect(result.source.status).toBe("unavailable");
    expect(result.source.rows).toHaveLength(8);
    expect(
      result.source.rows.every((row) => row.status === "unavailable"),
    ).toBe(true);
    expect(result.liveTimeline).toEqual({ status: "unavailable", events: [] });
    expect(result.humanGate).toMatchObject({
      approvalRequired: true,
      automaticApproval: false,
      actionsAvailable: false,
    });
    expect(result.source.rows).not.toContainEqual(
      expect.objectContaining({ count: expect.any(Number) }),
    );
  });

  it("does not turn an invalid source row into a count or current status", async () => {
    const result = await createAdminJudgeService(
      readers({
        readSourceSummary: async () => ({
          status: "current",
          sources: [
            {
              key: "elevators",
              status: "current",
              rowCount: -1,
              checkedAt: new Date("2026-08-20T12:00:00.000Z"),
              sourceUpdatedAt: null,
              sourceUrl: BRIGHT_DATA_JUDGE_SOURCE_URL,
            },
          ],
        }),
      }),
    ).getEvidence(checkedAt);

    expect(result.source.status).toBe("unavailable");
    expect(result.source.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "elevators",
          status: "unavailable",
          count: null,
          checkedAt: null,
        }),
      ]),
    );
    expect(result.source.rows).toHaveLength(8);
  });

  it("does not call readers for an invalid read time and keeps synthetic evidence complete", async () => {
    let reads = 0;
    const result = await createAdminJudgeService(
      readers({
        readSourceSummary: async () => {
          reads += 1;
          return coverage;
        },
        readIncidentEvidence: async () => {
          reads += 1;
          return incident;
        },
      }),
    ).getEvidence(new Date("not-a-date"));

    expect(reads).toBe(0);
    expect(result.status).toBe("unavailable");
    expect(result.source.rows).toHaveLength(8);
    expect(result.syntheticTimeline.status).toBe("current");
    expect(result.syntheticTimeline.events).toHaveLength(7);
  });

  it("marks duplicate or malformed source rows unavailable without hiding the fixed inventory", async () => {
    const duplicateRealtime = await createAdminJudgeService(
      readers({
        readSourceSummary: async () => ({
          ...coverage,
          realtime: [...coverage.realtime, coverage.realtime[0]],
        }),
      }),
    ).getEvidence(checkedAt);

    expect(duplicateRealtime.source.rows).toHaveLength(8);
    expect(duplicateRealtime.source.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "trip_updates",
          status: "unavailable",
          count: null,
        }),
        expect.objectContaining({
          key: "vehicles",
          status: "current",
          count: 80,
        }),
      ]),
    );

    const futureSourceTime = await createAdminJudgeService(
      readers({
        readSourceSummary: async () => ({
          ...coverage,
          sources: coverage.sources.map((row) =>
            row.key === "elevators"
              ? {
                  ...row,
                  sourceUpdatedAt: new Date("2026-08-20T12:06:00.000Z"),
                }
              : row,
          ),
        }),
      }),
    ).getEvidence(checkedAt);

    expect(futureSourceTime.source.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "elevators",
          status: "unavailable",
          count: null,
          sourceUpdatedAt: null,
        }),
      ]),
    );
  });

  it("requires the live incident state to match the final validated event", async () => {
    const result = await createAdminJudgeService(
      readers({
        readIncidentEvidence: async () => ({
          ...incident,
          incident: { state: "verified" },
        }),
      }),
    ).getEvidence(checkedAt);

    expect(result.liveTimeline).toEqual({ status: "unavailable", events: [] });
    expect(result.status).toBe("partial");
  });

  it("keeps the canonical successful verification event visible and rejects tied-history ambiguity", async () => {
    const verificationReadAt = new Date("2026-08-20T12:08:00.000Z");
    const verified = await createAdminJudgeService(
      readers({
        readIncidentEvidence: async () => ({
          ...incident,
          incident: { state: "verified" },
          events: [
            ...incident.events,
            {
              id: "00000000-0000-4000-8000-000000000007",
              eventType: "healing.approved",
              createdAt: new Date("2026-08-20T12:06:00.000Z"),
              fromState: "awaiting_approval",
              toState: "approved",
              actorUserId: "operator-secret",
              details: { explicitHumanApproval: true },
            },
            {
              id: "00000000-0000-4000-8000-000000000008",
              eventType: "healing.verification_succeeded",
              createdAt: new Date("2026-08-20T12:07:00.000Z"),
              fromState: "approved",
              toState: "verified",
              actorUserId: "operator-secret",
              details: { successful: true },
            },
          ],
        }),
      }),
    ).getEvidence(verificationReadAt);

    expect(verified.liveTimeline.status).toBe("current");
    expect(verified.liveTimeline.events.at(-1)).toMatchObject({
      eventType: "healing.verification_succeeded",
      toState: "verified",
    });

    const tied = await createAdminJudgeService(
      readers({
        readIncidentEvidence: async () => ({
          ...incident,
          incident: { state: "verified" },
          events: [
            ...incident.events,
            {
              id: "00000000-0000-4000-8000-000000000010",
              eventType: "healing.approved",
              createdAt: new Date("2026-08-20T12:06:00.000Z"),
              fromState: "awaiting_approval",
              toState: "approved",
              actorUserId: "operator-secret",
              details: { explicitHumanApproval: true },
            },
            {
              id: "00000000-0000-4000-8000-000000000009",
              eventType: "healing.verification_succeeded",
              createdAt: new Date("2026-08-20T12:06:00.000Z"),
              fromState: "approved",
              toState: "verified",
              actorUserId: "operator-secret",
              details: { successful: true },
            },
          ],
        }),
      }),
    ).getEvidence(verificationReadAt);

    expect(tied.liveTimeline).toEqual({
      status: "unavailable",
      events: [],
    });
  });
});
