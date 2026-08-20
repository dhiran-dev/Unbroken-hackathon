import { describe, expect, it } from "vitest";

import {
  AccessibilityEvidenceInvalidError,
  createAccessibilityEvidence,
} from "../../src/domain/journey/accessibility-evidence";
import {
  candidate,
  evidenceSnapshot,
  EVALUATED_AT,
  MemoryAccessibilityEvidenceSource,
  rideLeg,
  waitLeg,
} from "../support/accessibility-evidence";

type Assessment = Awaited<
  ReturnType<ReturnType<typeof createAccessibilityEvidence>["evaluate"]>
>;

function dependency(assessment: Assessment, kind: string) {
  return assessment.legs
    .flatMap((leg) => leg.dependencies)
    .find((item) => item.kind === kind);
}

describe("AccessibilityEvidence safety behavior", () => {
  it.each([
    ["elevators", "stop_access"],
    ["advisories", "accessibility_advisory"],
    ["relocations", "stop_relocation"],
    ["tripUpdates", "trip_operation"],
    ["alerts", "service_alert"],
  ] as const)(
    "keeps an unavailable %s source dependency unknown",
    async (source, kind) => {
      const snapshot = evidenceSnapshot();
      snapshot[source].state = "unavailable";
      const assessment = await createAccessibilityEvidence(
        new MemoryAccessibilityEvidenceSource(snapshot),
      ).evaluate(candidate([rideLeg()]), EVALUATED_AT);

      expect(dependency(assessment, kind)).toMatchObject({
        state: "unknown",
        reasons: [{ code: "SOURCE_UNAVAILABLE" }],
      });
      expect(assessment.state).toBe("unknown");
    },
  );

  it.each(["older", "unavailable"] as const)(
    "keeps a surface stop unknown when guide evidence is %s",
    async (state) => {
      const snapshot = evidenceSnapshot();
      snapshot.guides.state = state;
      const baseRide = rideLeg();
      const assessment = await createAccessibilityEvidence(
        new MemoryAccessibilityEvidenceSource(snapshot),
      ).evaluate(
        candidate([
          waitLeg("SURFACE-1"),
          rideLeg({
            from: { ...baseRide.from, stopId: "SURFACE-1" },
          }),
        ]),
        EVALUATED_AT,
      );

      expect(assessment.legs[0]!.dependencies[0]).toMatchObject({
        state: "unknown",
        reasons: [
          {
            code: state === "older" ? "SOURCE_OLDER" : "SOURCE_UNAVAILABLE",
            entityId: "stop_access",
          },
        ],
      });
    },
  );

  it("treats stale realtime as unknown and never emits its cancellation or alert", async () => {
    const snapshot = evidenceSnapshot();
    snapshot.tripUpdates.state = "older";
    snapshot.alerts.state = "older";
    snapshot.tripUpdates.updates = [
      {
        updateId: "cancel",
        tripId: "TRIP-N-1",
        routeId: "ROUTE-N",
        stopId: null,
        scheduleRelationship: "CANCELED",
        arrivalDelaySeconds: 300,
        departureDelaySeconds: 240,
      },
    ];
    snapshot.alerts.alerts = [
      {
        alertId: "alert",
        effect: "NO_SERVICE",
        activePeriods: [],
        informedEntities: [
          {
            agencyId: "SF",
            routeId: null,
            tripId: null,
            stopId: null,
          },
        ],
      },
    ];

    const assessment = await createAccessibilityEvidence(
      new MemoryAccessibilityEvidenceSource(snapshot),
    ).evaluate(candidate([rideLeg()]), EVALUATED_AT);

    expect(dependency(assessment, "trip_operation")).toEqual({
      kind: "trip_operation",
      state: "unknown",
      reasons: [{ code: "SOURCE_OLDER", entityId: "trip_operation" }],
    });
    expect(dependency(assessment, "service_alert")).toEqual({
      kind: "service_alert",
      state: "unknown",
      reasons: [{ code: "SOURCE_OLDER", entityId: "service_alert" }],
    });
    expect(assessment.delaySeconds).toBe(0);
  });

  it("ignores disruptive evidence when any supplied trip, route, or stop identity mismatches", async () => {
    const snapshot = evidenceSnapshot();
    snapshot.tripUpdates.updates = [
      {
        updateId: "wrong-route",
        tripId: "TRIP-N-1",
        routeId: "ROUTE-J",
        stopId: null,
        scheduleRelationship: "CANCELED",
        arrivalDelaySeconds: null,
        departureDelaySeconds: null,
      },
      {
        updateId: "wrong-stop",
        tripId: "TRIP-N-1",
        routeId: "ROUTE-N",
        stopId: "OTHER",
        scheduleRelationship: "SKIPPED",
        arrivalDelaySeconds: null,
        departureDelaySeconds: null,
      },
    ];
    snapshot.alerts.alerts = [
      {
        alertId: "wrong-trip",
        effect: "NO_SERVICE",
        activePeriods: [],
        informedEntities: [
          {
            agencyId: "SF",
            routeId: "ROUTE-N",
            tripId: "TRIP-N-2",
            stopId: null,
          },
        ],
      },
      {
        alertId: "wrong-stop",
        effect: "NO_SERVICE",
        activePeriods: [],
        informedEntities: [
          {
            agencyId: null,
            routeId: "ROUTE-N",
            tripId: "TRIP-N-1",
            stopId: "OTHER",
          },
        ],
      },
    ];

    const assessment = await createAccessibilityEvidence(
      new MemoryAccessibilityEvidenceSource(snapshot),
    ).evaluate(candidate([rideLeg()]), EVALUATED_AT);

    expect(dependency(assessment, "trip_operation")?.state).toBe("confirmed");
    expect(dependency(assessment, "service_alert")?.state).toBe("confirmed");
  });

  it("turns a total source failure into unavailable provenance and unknown dependencies without events", async () => {
    const evidence = createAccessibilityEvidence({
      async read() {
        throw new Error("private source detail");
      },
    });

    const assessment = await evidence.evaluate(
      candidate([rideLeg()]),
      EVALUATED_AT,
    );

    expect(assessment.state).toBe("unknown");
    expect(assessment.sources).toHaveLength(6);
    expect(
      assessment.sources.every((source) => source.state === "unavailable"),
    ).toBe(true);
    expect(
      assessment.legs
        .flatMap((leg) => leg.dependencies)
        .some((item) => item.state === "blocked"),
    ).toBe(false);
    expect(JSON.stringify(assessment)).not.toContain("private source");
  });

  it.each([
    {
      name: "invalid evaluation time",
      at: new Date("invalid"),
      value: candidate([rideLeg()]),
    },
    {
      name: "empty candidate identity",
      at: EVALUATED_AT,
      value: candidate([rideLeg()], { id: "" }),
    },
    {
      name: "candidate duration inconsistent with its times",
      at: EVALUATED_AT,
      value: candidate([rideLeg()], { durationSeconds: 1 }),
    },
  ])("rejects $name before reading evidence", async ({ at, value }) => {
    let reads = 0;
    const evidence = createAccessibilityEvidence({
      async read() {
        reads += 1;
        return evidenceSnapshot();
      },
    });

    await expect(evidence.evaluate(value, at)).rejects.toEqual(
      new AccessibilityEvidenceInvalidError(),
    );
    expect(reads).toBe(0);
  });

  it("orders allowlisted reasons deterministically and returns defensive copies", async () => {
    const snapshot = evidenceSnapshot();
    snapshot.advisories.advisories = [
      {
        advisoryId: "advisory-z",
        stopIds: ["15417"],
        routeIds: [],
        startsAt: null,
        endsAt: null,
      },
      {
        advisoryId: "advisory-a",
        stopIds: [],
        routeIds: ["ROUTE-N"],
        startsAt: null,
        endsAt: null,
      },
    ];
    const source = new MemoryAccessibilityEvidenceSource(snapshot);
    const evidence = createAccessibilityEvidence(source);
    const first = await evidence.evaluate(candidate([rideLeg()]), EVALUATED_AT);
    const second = await evidence.evaluate(
      candidate([rideLeg()]),
      EVALUATED_AT,
    );

    const reasons = dependency(first, "accessibility_advisory")!.reasons;
    expect(reasons).toEqual([
      {
        code: "ACCESSIBILITY_ADVISORY_ACTIVE",
        entityId: "advisory-a",
      },
      {
        code: "ACCESSIBILITY_ADVISORY_ACTIVE",
        entityId: "advisory-z",
      },
    ]);
    expect(first).toEqual(second);

    first.sources[0]!.checkedAt!.setUTCFullYear(2000);
    first.sources[0]!.sourceUrl = "https://attacker.invalid";
    reasons[0]!.entityId = "changed";
    const third = await evidence.evaluate(candidate([rideLeg()]), EVALUATED_AT);
    expect(third).toEqual(second);
  });

  it("uses blocked over unknown, and unknown over confirmed, for candidate state", async () => {
    const snapshot = evidenceSnapshot();
    snapshot.relocations.state = "unavailable";
    snapshot.alerts.alerts = [
      {
        alertId: "blocked",
        effect: "DETOUR",
        activePeriods: [],
        informedEntities: [
          {
            agencyId: "SF",
            routeId: "ROUTE-N",
            tripId: null,
            stopId: null,
          },
        ],
      },
    ];
    const assessment = await createAccessibilityEvidence(
      new MemoryAccessibilityEvidenceSource(snapshot),
    ).evaluate(candidate([rideLeg()]), EVALUATED_AT);

    expect(dependency(assessment, "stop_relocation")?.state).toBe("unknown");
    expect(dependency(assessment, "service_alert")?.state).toBe("blocked");
    expect(assessment.state).toBe("blocked");
  });
});
