import { describe, expect, it } from "vitest";

import { createAccessibilityEvidence } from "../../src/domain/journey/accessibility-evidence";
import {
  candidate,
  evidenceSnapshot,
  EVALUATED_AT,
  MemoryAccessibilityEvidenceSource,
  rideLeg,
  waitLeg,
  walkLeg,
} from "../support/accessibility-evidence";

async function evaluate(
  legs: import("../../src/domain/journey/route-engine").RouteCandidateLeg[] = [
    rideLeg(),
  ],
  mutate?: (snapshot: ReturnType<typeof evidenceSnapshot>) => void,
) {
  const snapshot = evidenceSnapshot();
  mutate?.(snapshot);
  return createAccessibilityEvidence(
    new MemoryAccessibilityEvidenceSource(snapshot),
  ).evaluate(candidate(legs), EVALUATED_AT);
}

describe("AccessibilityEvidence corrected dependency semantics", () => {
  it("keeps a neutral OTP mapped path unknown with an allowlisted reason", async () => {
    const assessment = await evaluate([walkLeg()]);

    expect(assessment).toMatchObject({
      state: "unknown",
      legs: [
        {
          state: "unknown",
          dependencies: [
            {
              kind: "mapped_path",
              state: "unknown",
              reasons: [
                {
                  code: "MAPPED_PATH_UNCONFIRMED",
                  entityId: "leg:0",
                },
              ],
            },
          ],
        },
      ],
    });
  });

  it.each(["wait", "ride", "transfer"] as const)(
    "keeps a %s leg with a missing stop identity unknown",
    async (type) => {
      const baseRide = rideLeg();
      const legs =
        type === "wait"
          ? [{ ...waitLeg(), from: { ...waitLeg().from, stopId: null } }]
          : type === "ride"
            ? [
                {
                  ...baseRide,
                  from: { ...baseRide.from, stopId: null },
                },
              ]
            : [walkLeg("transfer", null, "16994")];

      const assessment = await evaluate(legs);

      expect(
        assessment.legs[0]!.dependencies.some(
          (item) =>
            item.kind === "stop_access" &&
            item.state === "unknown" &&
            item.reasons.some(
              (reason) =>
                reason.code === "STOP_ACCESS_UNKNOWN" &&
                reason.entityId === "missing_stop_id",
            ),
        ),
      ).toBe(true);
    },
  );

  it("uses guide freshness rather than elevator freshness for a surface stop", async () => {
    const surfaceRide = rideLeg({
      from: { ...rideLeg().from, stopId: "SURFACE-1" },
    });
    const assessment = await evaluate([surfaceRide], (snapshot) => {
      snapshot.elevators.state = "unavailable";
      snapshot.guides.state = "current";
    });

    expect(assessment.legs[0]!.dependencies[0]).toEqual({
      kind: "stop_access",
      state: "unknown",
      reasons: [{ code: "STOP_ACCESS_UNKNOWN", entityId: "SURFACE-1" }],
    });
  });

  it("does not confirm a reviewed station whose station state is unknown", async () => {
    const assessment = await evaluate([rideLeg()], (snapshot) => {
      snapshot.elevators.stations.find(
        (station) => station.stationId === "powell",
      )!.state = "unknown";
    });

    expect(assessment.legs[0]!.dependencies[0]).toMatchObject({
      state: "unknown",
      reasons: [{ code: "ELEVATOR_STATUS_UNKNOWN", entityId: "powell" }],
    });
  });

  it("uses inclusive advisory overlap with the affected leg interval", async () => {
    const assessment = await evaluate([rideLeg()], (snapshot) => {
      snapshot.advisories.advisories = [
        {
          advisoryId: "during-leg",
          stopIds: [],
          routeIds: ["ROUTE-N"],
          startsAt: new Date("2026-08-20T12:10:00.000Z"),
          endsAt: new Date("2026-08-20T12:20:00.000Z"),
        },
        {
          advisoryId: "before-leg",
          stopIds: [],
          routeIds: ["ROUTE-N"],
          startsAt: null,
          endsAt: new Date("2026-08-20T12:01:59.999Z"),
        },
      ];
    });

    expect(
      assessment.legs[0]!.dependencies.find(
        (item) => item.kind === "accessibility_advisory",
      ),
    ).toMatchObject({
      state: "blocked",
      reasons: [
        {
          code: "ACCESSIBILITY_ADVISORY_ACTIVE",
          entityId: "during-leg",
        },
      ],
    });
  });

  it("uses inclusive alert overlap and ignores an intermediate stop-specific alert", async () => {
    const leg = rideLeg({ intermediateStopIds: ["MID"] });
    const assessment = await evaluate([leg], (snapshot) => {
      snapshot.alerts.alerts = [
        {
          alertId: "endpoint",
          effect: "DETOUR",
          activePeriods: [
            {
              startsAt: new Date("2026-08-20T12:12:00.000Z"),
              endsAt: new Date("2026-08-20T12:20:00.000Z"),
            },
          ],
          informedEntities: [
            {
              agencyId: "SF",
              routeId: null,
              tripId: null,
              stopId: "16994",
            },
          ],
        },
        {
          alertId: "intermediate",
          effect: "NO_SERVICE",
          activePeriods: [],
          informedEntities: [
            {
              agencyId: "SF",
              routeId: null,
              tripId: null,
              stopId: "MID",
            },
          ],
        },
      ];
    });

    expect(
      assessment.legs[0]!.dependencies.find(
        (item) => item.kind === "service_alert",
      ),
    ).toMatchObject({
      state: "blocked",
      reasons: [{ code: "SERVICE_ALERT_ACTIVE", entityId: "endpoint" }],
    });
  });

  it("requires relocation route, endpoint, and leg-interval overlap", async () => {
    const leg = rideLeg({ intermediateStopIds: ["MID"] });
    const assessment = await evaluate([leg], (snapshot) => {
      snapshot.relocations.relocations = [
        {
          relocationId: "exact",
          stopId: "15417",
          routeIds: ["ROUTE-N"],
          startsAt: new Date("2026-08-20T12:02:00.000Z"),
          endsAt: new Date("2026-08-20T12:02:00.000Z"),
        },
        {
          relocationId: "wrong-route",
          stopId: "15417",
          routeIds: ["ROUTE-J"],
          startsAt: leg.startAt,
          endsAt: leg.endAt,
        },
        {
          relocationId: "intermediate",
          stopId: "MID",
          routeIds: ["ROUTE-N"],
          startsAt: leg.startAt,
          endsAt: leg.endAt,
        },
      ];
    });

    expect(
      assessment.legs[0]!.dependencies.find(
        (item) => item.kind === "stop_relocation",
      ),
    ).toMatchObject({
      state: "blocked",
      reasons: [{ code: "STOP_RELOCATION_ACTIVE", entityId: "exact" }],
    });
  });

  it.each(["CANCELED", "DELETED"])(
    "blocks a route-compatible trip-wide %s row even when it carries a stop",
    async (relationship) => {
      const assessment = await evaluate([rideLeg()], (snapshot) => {
        snapshot.tripUpdates.updates = [
          {
            updateId: "removed",
            tripId: "TRIP-N-1",
            routeId: "ROUTE-N",
            stopId: "MID",
            scheduleRelationship: relationship,
            arrivalDelaySeconds: null,
            departureDelaySeconds: null,
          },
        ];
      });

      expect(
        assessment.legs[0]!.dependencies.find(
          (item) => item.kind === "trip_operation",
        ),
      ).toMatchObject({
        state: "blocked",
        reasons: [{ code: "TRIP_CANCELLED", entityId: "TRIP-N-1" }],
      });
    },
  );

  it("blocks skipped boarding/alighting stops but ignores skipped intermediates", async () => {
    const leg = rideLeg({ intermediateStopIds: ["MID"] });
    const assessment = await evaluate([leg], (snapshot) => {
      snapshot.tripUpdates.updates = [
        {
          updateId: "mid",
          tripId: "TRIP-N-1",
          routeId: "ROUTE-N",
          stopId: "MID",
          scheduleRelationship: "SKIPPED",
          arrivalDelaySeconds: null,
          departureDelaySeconds: null,
        },
        {
          updateId: "end",
          tripId: "TRIP-N-1",
          routeId: "ROUTE-N",
          stopId: "16994",
          scheduleRelationship: "SKIPPED",
          arrivalDelaySeconds: null,
          departureDelaySeconds: null,
        },
      ];
    });

    expect(
      assessment.legs[0]!.dependencies.find(
        (item) => item.kind === "trip_operation",
      ),
    ).toMatchObject({
      reasons: [{ code: "STOP_SKIPPED", entityId: "16994" }],
    });
  });

  it("derives departure and arrival delay only from endpoints with trip-level fallback", async () => {
    const leg = rideLeg({ intermediateStopIds: ["MID"] });
    const assessment = await evaluate([leg], (snapshot) => {
      snapshot.tripUpdates.updates = [
        {
          updateId: "fallback",
          tripId: "TRIP-N-1",
          routeId: "ROUTE-N",
          stopId: null,
          scheduleRelationship: "SCHEDULED",
          arrivalDelaySeconds: 90,
          departureDelaySeconds: 60,
        },
        {
          updateId: "board",
          tripId: "TRIP-N-1",
          routeId: "ROUTE-N",
          stopId: "15417",
          scheduleRelationship: "SCHEDULED",
          arrivalDelaySeconds: 999,
          departureDelaySeconds: 120,
        },
        {
          updateId: "mid",
          tripId: "TRIP-N-1",
          routeId: "ROUTE-N",
          stopId: "MID",
          scheduleRelationship: "SCHEDULED",
          arrivalDelaySeconds: 1_000,
          departureDelaySeconds: 1_000,
        },
        {
          updateId: "alight",
          tripId: "TRIP-N-1",
          routeId: "ROUTE-N",
          stopId: "16994",
          scheduleRelationship: "SCHEDULED",
          arrivalDelaySeconds: 180,
          departureDelaySeconds: 998,
        },
      ];
    });

    expect(assessment.legs[0]).toMatchObject({
      departureDelaySeconds: 120,
      arrivalDelaySeconds: 180,
      delaySeconds: 180,
    });
  });

  it("accepts an exact finite fractional duration from RouteEngine", async () => {
    const leg = rideLeg();
    const fractional = {
      ...leg,
      endAt: new Date(leg.endAt.getTime() + 500),
      durationSeconds: 600.5,
    };

    await expect(evaluate([fractional])).resolves.toMatchObject({
      legs: [{ type: "ride" }],
    });
  });
});

describe("AccessibilityEvidence candidate-context station topology", () => {
  it("requires platform only for a wait and an underground transfer", async () => {
    const assessment = await evaluate(
      [waitLeg(), walkLeg("transfer", "15417", "15417")],
      (snapshot) => {
        const powell = snapshot.elevators.stations.find(
          (station) => station.stationId === "powell",
        )!;
        powell.elevators
          .filter((elevator) =>
            [
              "sfmta:155fa9cd88ca1b910f173175e6d47c76",
              "sfmta:c3c5a5304402993b7c0e65b129cc4425",
            ].includes(elevator.equipmentId),
          )
          .forEach((elevator) => {
            elevator.state = "out_of_service";
          });
      },
    );

    expect(assessment.legs[0]!.dependencies[0]!.state).toBe("confirmed");
    expect(
      assessment.legs[1]!.dependencies.find(
        (item) => item.kind === "stop_access",
      )?.state,
    ).toBe("confirmed");
    expect(assessment.legs[1]!.state).toBe("unknown");
  });

  it("uses the fixed reviewed Powell-Union connected street alternative", async () => {
    const assessment = await evaluate([rideLeg()], (snapshot) => {
      const powell = snapshot.elevators.stations.find(
        (station) => station.stationId === "powell",
      )!;
      powell.elevators
        .filter((elevator) =>
          [
            "sfmta:155fa9cd88ca1b910f173175e6d47c76",
            "sfmta:c3c5a5304402993b7c0e65b129cc4425",
          ].includes(elevator.equipmentId),
        )
        .forEach((elevator) => {
          elevator.state = "out_of_service";
        });
      snapshot.elevators.stations.push({
        stationId: "union-square-market-street",
        state: "accessible",
        elevators: [
          {
            equipmentId: "sfmta:b7e0d164bd118c44d2a1badafae9fde2",
            state: "working",
          },
        ],
      });
    });

    expect(assessment.legs[0]!.dependencies[0]!.state).toBe("confirmed");
  });
});
