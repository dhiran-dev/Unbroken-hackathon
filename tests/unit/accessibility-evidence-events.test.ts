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

type Assessment = Awaited<
  ReturnType<ReturnType<typeof createAccessibilityEvidence>["evaluate"]>
>;

function dependency(assessment: Assessment, kind: string) {
  return assessment.legs
    .flatMap((leg) => leg.dependencies)
    .find((item) => item.kind === kind);
}

async function evaluate(snapshot = evidenceSnapshot()) {
  return createAccessibilityEvidence(
    new MemoryAccessibilityEvidenceSource(snapshot),
  ).evaluate(candidate([rideLeg()]), EVALUATED_AT);
}

describe("AccessibilityEvidence current events", () => {
  it("blocks only the exact reviewed path whose required elevator group is fully out of service", async () => {
    const snapshot = evidenceSnapshot();
    const powell = snapshot.elevators.stations.find(
      (station) => station.stationId === "powell",
    )!;
    powell.elevators.find(
      (elevator) =>
        elevator.equipmentId === "sfmta:98a3cedeeef224f548f6dd9257fe9ab3",
    )!.state = "out_of_service";

    const assessment = await createAccessibilityEvidence(
      new MemoryAccessibilityEvidenceSource(snapshot),
    ).evaluate(candidate([waitLeg(), rideLeg()]), EVALUATED_AT);

    expect(assessment.state).toBe("blocked");
    expect(assessment.legs[0]!.dependencies[0]).toEqual({
      kind: "stop_access",
      state: "blocked",
      reasons: [
        {
          code: "ELEVATOR_OUT_OF_SERVICE",
          entityId: "sfmta:98a3cedeeef224f548f6dd9257fe9ab3",
        },
      ],
    });
  });

  it("keeps an exact surface stop unknown because current guides have no reviewed stop IDs", async () => {
    const baseRide = rideLeg();
    const assessment = await createAccessibilityEvidence(
      new MemoryAccessibilityEvidenceSource(),
    ).evaluate(
      candidate([
        waitLeg("SURFACE-1"),
        rideLeg({ from: { ...baseRide.from, stopId: "SURFACE-1" } }),
      ]),
      EVALUATED_AT,
    );

    expect(assessment.state).toBe("unknown");
    expect(assessment.legs[0]!.dependencies).toEqual([
      {
        kind: "stop_access",
        state: "unknown",
        reasons: [{ code: "STOP_ACCESS_UNKNOWN", entityId: "SURFACE-1" }],
      },
    ]);
  });

  it.each([
    { name: "stop", stopIds: ["15417"], routeIds: [] },
    { name: "route", stopIds: [], routeIds: ["ROUTE-N"] },
  ])(
    "blocks a current exact $name accessibility advisory",
    async ({ stopIds, routeIds }) => {
      const snapshot = evidenceSnapshot();
      snapshot.advisories.advisories = [
        {
          advisoryId: "advisory-1",
          stopIds,
          routeIds,
          startsAt: new Date("2026-08-20T11:00:00.000Z"),
          endsAt: new Date("2026-08-20T13:00:00.000Z"),
        },
      ];

      expect(
        dependency(await evaluate(snapshot), "accessibility_advisory"),
      ).toEqual({
        kind: "accessibility_advisory",
        state: "blocked",
        reasons: [
          {
            code: "ACCESSIBILITY_ADVISORY_ACTIVE",
            entityId: "advisory-1",
          },
        ],
      });
    },
  );

  it("ignores inactive and mismatched exact advisory entities", async () => {
    const snapshot = evidenceSnapshot();
    snapshot.advisories.advisories = [
      {
        advisoryId: "wrong",
        stopIds: ["15418"],
        routeIds: [],
        startsAt: null,
        endsAt: null,
      },
      {
        advisoryId: "ended",
        stopIds: ["15417"],
        routeIds: [],
        startsAt: null,
        endsAt: new Date("2026-08-20T11:59:59.000Z"),
      },
    ];

    expect(
      dependency(await evaluate(snapshot), "accessibility_advisory"),
    ).toMatchObject({ state: "confirmed", reasons: [] });
  });

  it.each([
    {
      name: "outside its active time",
      stopId: "15417",
      startsAt: "2026-08-20T13:00:00.000Z",
      expected: "confirmed",
    },
    {
      name: "for another exact stop",
      stopId: "15418",
      startsAt: "2026-08-20T11:00:00.000Z",
      expected: "confirmed",
    },
    {
      name: "for the exact boarding stop",
      stopId: "15417",
      startsAt: "2026-08-20T11:00:00.000Z",
      expected: "unknown",
    },
  ])(
    "classifies a relocation $name",
    async ({ stopId, startsAt, expected }) => {
      const snapshot = evidenceSnapshot();
      snapshot.relocations.relocations = [
        {
          relocationId: "move-1",
          stopId,
          startsAt: new Date(startsAt),
          routeIds: ["ROUTE-N"],
          temporaryStop: "Fifth Street near Market Street",
          boardingInstruction: "Board at Fifth Street near Market Street.",
          endsAt: new Date("2026-08-20T14:00:00.000Z"),
        },
      ];

      const relocation = dependency(
        await evaluate(snapshot),
        "stop_relocation",
      );
      expect(relocation?.state).toBe(expected);
      if (expected === "unknown") {
        expect(relocation?.relocations).toEqual([
          {
            relocationId: "move-1",
            role: "boarding",
            instruction: "Board at Fifth Street near Market Street.",
          },
        ]);
      }
    },
  );

  it("keeps boarding and alighting relocation roles distinct", async () => {
    const snapshot = evidenceSnapshot();
    snapshot.relocations.relocations = [
      {
        relocationId: "move-boarding",
        stopId: "15417",
        routeIds: ["ROUTE-N"],
        temporaryStop: "Fifth Street near Market Street",
        boardingInstruction: "Board at Fifth Street near Market Street.",
        startsAt: new Date("2026-08-20T11:00:00.000Z"),
        endsAt: new Date("2026-08-20T14:00:00.000Z"),
      },
      {
        relocationId: "move-alighting",
        stopId: "16994",
        routeIds: ["ROUTE-N"],
        temporaryStop: "Second Street near Market Street",
        boardingInstruction: "Board at Second Street near Market Street.",
        startsAt: new Date("2026-08-20T11:00:00.000Z"),
        endsAt: new Date("2026-08-20T14:00:00.000Z"),
      },
    ];

    expect(
      dependency(await evaluate(snapshot), "stop_relocation")?.relocations,
    ).toEqual([
      {
        relocationId: "move-alighting",
        role: "alighting",
        instruction: "Get off at Second Street near Market Street.",
      },
      {
        relocationId: "move-boarding",
        role: "boarding",
        instruction: "Board at Fifth Street near Market Street.",
      },
    ]);
  });

  it("does not duplicate a relocation when one stop is both ride endpoints", async () => {
    const snapshot = evidenceSnapshot();
    snapshot.relocations.relocations = [
      {
        relocationId: "move-loop",
        stopId: "15417",
        routeIds: ["ROUTE-N"],
        temporaryStop: "Fifth Street near Market Street",
        boardingInstruction: "Board at Fifth Street near Market Street.",
        startsAt: new Date("2026-08-20T11:00:00.000Z"),
        endsAt: new Date("2026-08-20T14:00:00.000Z"),
      },
    ];
    const base = rideLeg();
    const loop = rideLeg({ to: { ...base.from } });
    const assessment = await createAccessibilityEvidence(
      new MemoryAccessibilityEvidenceSource(snapshot),
    ).evaluate(candidate([loop]), EVALUATED_AT);

    expect(dependency(assessment, "stop_relocation")?.relocations).toEqual([
      {
        relocationId: "move-loop",
        role: "boarding",
        instruction: "Board at Fifth Street near Market Street.",
      },
    ]);
  });

  it.each([
    {
      relationship: "CANCELED",
      stopId: null,
      code: "TRIP_CANCELLED",
    },
    {
      relationship: "SKIPPED",
      stopId: "16994",
      code: "STOP_SKIPPED",
    },
  ])(
    "blocks an exact $relationship trip update",
    async ({ relationship, stopId, code }) => {
      const snapshot = evidenceSnapshot();
      snapshot.tripUpdates.updates = [
        {
          updateId: "update-1",
          tripId: "TRIP-N-1",
          routeId: "ROUTE-N",
          stopId,
          scheduleRelationship: relationship,
          arrivalDelaySeconds: null,
          departureDelaySeconds: null,
        },
      ];

      expect(
        dependency(await evaluate(snapshot), "trip_operation"),
      ).toMatchObject({
        state: "blocked",
        reasons: [{ code, entityId: stopId ?? "TRIP-N-1" }],
      });
    },
  );

  it("propagates only bounded exact delays without blocking", async () => {
    const snapshot = evidenceSnapshot();
    const update = (
      input: Partial<(typeof snapshot.tripUpdates.updates)[number]>,
    ) => ({
      updateId: "update",
      tripId: "TRIP-N-1",
      routeId: "ROUTE-N",
      stopId: "16994",
      scheduleRelationship: "SCHEDULED",
      arrivalDelaySeconds: null,
      departureDelaySeconds: null,
      ...input,
    });
    snapshot.tripUpdates.updates = [
      update({
        updateId: "wrong-trip",
        tripId: "TRIP-N-2",
        arrivalDelaySeconds: 1_000,
      }),
      update({
        updateId: "wrong-route",
        routeId: "ROUTE-J",
        arrivalDelaySeconds: 900,
      }),
      update({
        updateId: "wrong-stop",
        stopId: "OTHER",
        arrivalDelaySeconds: 800,
      }),
      update({
        updateId: "exact-departure",
        stopId: "15417",
        departureDelaySeconds: 180,
      }),
      update({
        updateId: "exact-arrival",
        arrivalDelaySeconds: 240,
      }),
    ];

    const assessment = await evaluate(snapshot);
    expect(assessment).toMatchObject({
      state: "confirmed",
      delaySeconds: 240,
    });
    expect(assessment.legs[0]).toMatchObject({
      state: "confirmed",
      delaySeconds: 240,
      departureDelaySeconds: 180,
      arrivalDelaySeconds: 240,
    });
  });

  it.each([
    { effect: "DETOUR", expected: "blocked" },
    { effect: "ADDITIONAL_SERVICE", expected: "confirmed" },
  ])(
    "classifies an exact active $effect alert",
    async ({ effect, expected }) => {
      const snapshot = evidenceSnapshot();
      snapshot.alerts.alerts = [
        {
          alertId: "alert-1",
          effect,
          activePeriods: [
            {
              startsAt: new Date("2026-08-20T11:00:00.000Z"),
              endsAt: new Date("2026-08-20T13:00:00.000Z"),
            },
          ],
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

      expect(dependency(await evaluate(snapshot), "service_alert")?.state).toBe(
        expected,
      );
    },
  );

  it("applies an agency-wide alert only to exact agency SF", async () => {
    const agencyState = async (agencyId: string) => {
      const snapshot = evidenceSnapshot();
      snapshot.alerts.alerts = [
        {
          alertId: "alert-agency",
          effect: "NO_SERVICE",
          activePeriods: [],
          informedEntities: [
            {
              agencyId,
              routeId: null,
              tripId: null,
              stopId: null,
            },
          ],
        },
      ];
      return dependency(await evaluate(snapshot), "service_alert")?.state;
    };

    await expect(agencyState("SF")).resolves.toBe("blocked");
    await expect(agencyState("BA")).resolves.toBe("unknown");
  });

  it.each([
    ["elevators", "stop_access"],
    ["advisories", "accessibility_advisory"],
    ["relocations", "stop_relocation"],
    ["tripUpdates", "trip_operation"],
    ["alerts", "service_alert"],
  ] as const)(
    "keeps an older %s source dependency unknown",
    async (source, kind) => {
      const snapshot = evidenceSnapshot();
      snapshot[source].state = "older";

      expect(dependency(await evaluate(snapshot), kind)).toMatchObject({
        state: "unknown",
        reasons: [{ code: "SOURCE_OLDER" }],
      });
    },
  );

  it("classifies walk, wait, ride, and transfer dependencies", async () => {
    const assessment = await createAccessibilityEvidence(
      new MemoryAccessibilityEvidenceSource(),
    ).evaluate(
      candidate([
        walkLeg(),
        waitLeg(),
        rideLeg(),
        walkLeg("transfer", "16994", "16994"),
      ]),
      EVALUATED_AT,
    );

    expect(assessment.legs.map((leg) => [leg.type, leg.state])).toEqual([
      ["walk", "unknown"],
      ["wait", "confirmed"],
      ["ride", "confirmed"],
      ["transfer", "unknown"],
    ]);
    expect(
      assessment.legs.map((leg) => leg.dependencies.map(({ kind }) => kind)),
    ).toEqual([
      ["mapped_path"],
      ["stop_access"],
      [
        "stop_access",
        "stop_access",
        "accessibility_advisory",
        "stop_relocation",
        "trip_operation",
        "service_alert",
      ],
      ["mapped_path", "stop_access"],
    ]);
  });
});
