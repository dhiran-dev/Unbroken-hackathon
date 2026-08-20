import { describe, expect, it } from "vitest";

import { createJourneyPlannerCore } from "../../src/domain/journey/journey-planner";
import {
  AccessibilityEvidenceInvalidError,
  createAccessibilityEvidence,
  type AccessibilityAssessment,
} from "../../src/domain/journey/accessibility-evidence";
import {
  RouteEngineUnavailableError,
  type RouteCandidate,
} from "../../src/domain/journey/route-engine";
import {
  candidate,
  evidenceSnapshot,
  EVALUATED_AT,
  rideLeg,
  waitLeg,
  walkLeg,
} from "../support/accessibility-evidence";

const request = {
  origin: {
    label: "Powell Street",
    latitude: 37.784,
    longitude: -122.408,
    stopIds: ["15417"],
  },
  destination: {
    label: "Montgomery Street",
    latitude: 37.789,
    longitude: -122.401,
    stopIds: ["16994"],
  },
  departureAt: EVALUATED_AT,
  evaluatedAt: EVALUATED_AT,
};

function confirmedAssessment(value: RouteCandidate): AccessibilityAssessment {
  return {
    candidateId: value.id,
    state: "confirmed",
    delaySeconds: 0,
    legs: value.legs.map((leg, legIndex) => ({
      legIndex,
      type: leg.type,
      state: "confirmed",
      delaySeconds: 0,
      departureDelaySeconds: 0,
      arrivalDelaySeconds: 0,
      dependencies: [
        {
          kind: "stop_access",
          state: "confirmed",
          reasons: [],
        },
      ],
    })),
    sources: [],
  };
}

function assessment(
  value: RouteCandidate,
  state: AccessibilityAssessment["state"],
  options: {
    delaySeconds?: number;
    legStates?: AccessibilityAssessment["legs"][number]["state"][];
    departureDelaySeconds?: number[];
    arrivalDelaySeconds?: number[];
  } = {},
): AccessibilityAssessment {
  const result = confirmedAssessment(value);
  result.state = state;
  result.delaySeconds = options.delaySeconds ?? 0;
  result.legs = result.legs.map((leg, index) => {
    const legState = options.legStates?.[index] ?? state;
    return {
      ...leg,
      state: legState,
      departureDelaySeconds:
        options.departureDelaySeconds?.[index] ?? leg.departureDelaySeconds,
      arrivalDelaySeconds:
        options.arrivalDelaySeconds?.[index] ?? leg.arrivalDelaySeconds,
      dependencies: leg.dependencies.map((dependency) => ({
        ...dependency,
        state: legState,
      })),
    };
  });
  return result;
}

function plannerFor(
  candidates: RouteCandidate[],
  assessments: Record<
    string,
    {
      state: AccessibilityAssessment["state"];
      delaySeconds?: number;
      legStates?: AccessibilityAssessment["legs"][number]["state"][];
      departureDelaySeconds?: number[];
      arrivalDelaySeconds?: number[];
    }
  >,
) {
  return createJourneyPlannerCore({
    routeEngine: {
      async planCandidates() {
        return candidates;
      },
    },
    accessibilityEvidence: {
      async evaluate(value) {
        const selected = assessments[value.id]!;
        return assessment(value, selected.state, selected);
      },
    },
  });
}

function plannerForAssessment(
  routeCandidate: RouteCandidate,
  routeAssessment: AccessibilityAssessment,
) {
  return createJourneyPlannerCore({
    routeEngine: {
      async planCandidates() {
        return [routeCandidate];
      },
    },
    accessibilityEvidence: {
      async evaluate() {
        return routeAssessment;
      },
    },
  });
}

describe("journey planner core", () => {
  it("selects a confirmed journey through the public core seam", async () => {
    const routeCandidate = candidate([rideLeg()]);
    const planner = createJourneyPlannerCore({
      routeEngine: {
        async planCandidates() {
          return [routeCandidate];
        },
      },
      accessibilityEvidence: {
        async evaluate(value) {
          return confirmedAssessment(value);
        },
      },
    });

    const result = await planner.plan(request);

    expect(result).toMatchObject({
      kind: "selected",
      journey: {
        status: "confirmed",
        title: "Step-free details confirmed",
        candidateId: "candidate-1",
        departureAt: new Date("2026-08-20T12:02:00.000Z"),
        arrivalAt: new Date("2026-08-20T12:12:00.000Z"),
        durationMinutes: 10,
      },
    });
  });

  it("uses one immutable evidence snapshot for all five candidates", async () => {
    let reads = 0;
    const evidence = createAccessibilityEvidence({
      async read() {
        reads += 1;
        const snapshot = evidenceSnapshot();
        if (reads > 1) {
          snapshot.elevators.stations.find(
            (station) => station.stationId === "powell",
          )!.state = "unavailable";
        }
        return snapshot;
      },
    });
    const candidates = Array.from({ length: 5 }, (_, index) =>
      candidate([rideLeg()], { id: `candidate-${index + 1}` }),
    );
    const planner = createJourneyPlannerCore({
      routeEngine: {
        async planCandidates() {
          return candidates;
        },
      },
      accessibilityEvidence: evidence,
    });

    const result = await planner.plan(request);

    expect(result).toMatchObject({
      kind: "selected",
      journey: {
        candidateId: "candidate-1",
        status: "confirmed",
      },
    });
    expect(reads).toBe(1);
  });

  it.each([
    {
      name: "wrong candidate ID",
      mutate: (value: AccessibilityAssessment) => {
        value.candidateId = "another-candidate";
      },
    },
    {
      name: "missing leg assessment",
      mutate: (value: AccessibilityAssessment) => {
        value.legs = [];
      },
    },
    {
      name: "duplicate leg index",
      mutate: (value: AccessibilityAssessment) => {
        value.legs = [value.legs[0]!, { ...value.legs[0]! }];
      },
    },
    {
      name: "wrong leg type",
      mutate: (value: AccessibilityAssessment) => {
        value.legs[0] = { ...value.legs[0]!, type: "walk" };
      },
    },
    {
      name: "confirmed aggregate with unknown leg and dependency",
      mutate: (value: AccessibilityAssessment) => {
        value.legs[0] = {
          ...value.legs[0]!,
          state: "unknown",
          dependencies: [
            {
              kind: "stop_access",
              state: "unknown",
              reasons: [{ code: "STOP_ACCESS_UNKNOWN", entityId: "15417" }],
            },
          ],
        };
      },
    },
  ])("fails a candidate closed for $name", async ({ mutate }) => {
    const routeCandidate = candidate([rideLeg()]);
    const invalid = confirmedAssessment(routeCandidate);
    mutate(invalid);

    await expect(
      plannerForAssessment(routeCandidate, invalid).plan(request),
    ).resolves.toEqual({
      kind: "unavailable",
      status: "unavailable",
      title: "No step-free route confirmed",
    });
  });

  it("fails a candidate closed when leg assessments are reordered", async () => {
    const routeCandidate = candidate([walkLeg(), rideLeg()]);
    const invalid = confirmedAssessment(routeCandidate);
    invalid.legs = [invalid.legs[1]!, invalid.legs[0]!];

    await expect(
      plannerForAssessment(routeCandidate, invalid).plan(request),
    ).resolves.toEqual({
      kind: "unavailable",
      status: "unavailable",
      title: "No step-free route confirmed",
    });
  });

  it("fails closed when a batch evidence result is missing a candidate", async () => {
    const first = candidate([rideLeg()], { id: "first" });
    const second = candidate([rideLeg()], { id: "second" });
    const planner = createJourneyPlannerCore({
      routeEngine: {
        async planCandidates() {
          return [first, second];
        },
      },
      accessibilityEvidence: {
        async evaluate(value) {
          return confirmedAssessment(value);
        },
        async evaluateCandidates() {
          return [confirmedAssessment(first)];
        },
      },
    });

    await expect(planner.plan(request)).resolves.toEqual({
      kind: "unavailable",
      status: "unavailable",
      title: "No step-free route confirmed",
    });
  });

  it("propagates unexpected dependency exceptions without exposing them in a result", async () => {
    const failure = new Error("private unexpected detail");
    const planner = createJourneyPlannerCore({
      routeEngine: {
        async planCandidates() {
          throw failure;
        },
      },
      accessibilityEvidence: {
        async evaluate(value) {
          return confirmedAssessment(value);
        },
      },
    });

    await expect(planner.plan(request)).rejects.toBe(failure);
  });

  it.each([
    {
      name: "returns unavailable when no candidates are returned",
      routeError: false,
      evidenceError: false,
      candidates: [] as RouteCandidate[],
      assessments: {},
    },
    {
      name: "returns unavailable when every candidate is blocked",
      routeError: false,
      evidenceError: false,
      candidates: [candidate([rideLeg()], { id: "blocked" })],
      assessments: { blocked: { state: "blocked" as const } },
    },
    {
      name: "never selects an inconsistent assessment containing a blocked leg",
      routeError: false,
      evidenceError: false,
      candidates: [candidate([rideLeg()], { id: "blocked-leg" })],
      assessments: {
        "blocked-leg": {
          state: "unknown" as const,
          legStates: ["blocked"] as AccessibilityAssessment["state"][],
        },
      },
    },
    {
      name: "returns unavailable for a safe route dependency failure",
      routeError: true,
      evidenceError: false,
      candidates: [] as RouteCandidate[],
      assessments: {},
    },
    {
      name: "returns unavailable for a safe evidence dependency failure",
      routeError: false,
      evidenceError: true,
      candidates: [candidate([rideLeg()], { id: "candidate" })],
      assessments: { candidate: { state: "confirmed" as const } },
    },
  ])(
    "$name",
    async ({ routeError, evidenceError, candidates, assessments }) => {
      const planner = createJourneyPlannerCore({
        routeEngine: {
          async planCandidates() {
            if (routeError) throw new RouteEngineUnavailableError();
            return candidates;
          },
        },
        accessibilityEvidence: {
          async evaluate(value) {
            if (evidenceError) throw new AccessibilityEvidenceInvalidError();
            const selected = assessments[
              value.id as keyof typeof assessments
            ] as {
              state: AccessibilityAssessment["state"];
              legStates?: AccessibilityAssessment["state"][];
            };
            return assessment(value, selected.state, selected);
          },
        },
      });

      await expect(planner.plan(request)).resolves.toEqual({
        kind: "unavailable",
        status: "unavailable",
        title: "No step-free route confirmed",
      });
    },
  );

  it("does not award the confirmed-walking preference to production mapped paths that remain unknown", async () => {
    const longWalk = {
      ...walkLeg(),
      distanceMeters: 500,
    };
    const shortWalk = {
      ...walkLeg(),
      distanceMeters: 20,
    };
    const quickerLongWalk = candidate([longWalk, rideLeg()], {
      id: "quicker-long-walk",
    });
    const slowerRide = rideLeg({
      endAt: new Date("2026-08-20T12:20:00.000Z"),
      durationSeconds: 1_080,
    });
    const slowerShortWalk = candidate([shortWalk, slowerRide], {
      id: "slower-short-walk",
    });
    const planner = createJourneyPlannerCore({
      routeEngine: {
        async planCandidates() {
          return [slowerShortWalk, quickerLongWalk];
        },
      },
      accessibilityEvidence: createAccessibilityEvidence({
        async read() {
          return evidenceSnapshot();
        },
      }),
    });

    const result = await planner.plan(request);

    expect(result).toMatchObject({
      kind: "selected",
      journey: {
        candidateId: "quicker-long-walk",
        status: "check_details",
      },
    });
    if (result.kind !== "selected") return;
    expect(result.journey.legs[0]).toMatchObject({
      type: "walk",
      accessibility: {
        state: "unknown",
        reasons: ["MAPPED_PATH_UNCONFIRMED"],
      },
    });
  });

  it("ranks with the final adjusted timeline instead of only the top-level delay", async () => {
    const delayed = candidate([rideLeg()], {
      id: "delayed-departure",
      durationSeconds: 300,
    });
    const steady = candidate([rideLeg()], {
      id: "steady",
      durationSeconds: 600,
    });
    const delayedAssessment = confirmedAssessment(delayed);
    delayedAssessment.legs[0]!.departureDelaySeconds = 900;
    delayedAssessment.legs[0]!.arrivalDelaySeconds = 900;
    const steadyAssessment = confirmedAssessment(steady);
    const planner = createJourneyPlannerCore({
      routeEngine: {
        async planCandidates() {
          return [delayed, steady];
        },
      },
      accessibilityEvidence: {
        async evaluate(value) {
          return value.id === delayed.id ? delayedAssessment : steadyAssessment;
        },
      },
    });

    const result = await planner.plan(request);

    expect(result).toMatchObject({
      kind: "selected",
      journey: { candidateId: "steady" },
    });
  });

  it.each([
    {
      name: "excludes blocked candidates",
      candidates: [
        candidate([rideLeg()], { id: "blocked" }),
        candidate([rideLeg()], { id: "unknown" }),
      ],
      assessments: {
        blocked: { state: "blocked" as const },
        unknown: { state: "unknown" as const },
      },
      expected: "unknown",
    },
    {
      name: "prefers confirmed evidence over a faster unknown journey",
      candidates: [
        candidate([rideLeg()], { id: "unknown", durationSeconds: 300 }),
        candidate([rideLeg()], { id: "confirmed", durationSeconds: 900 }),
      ],
      assessments: {
        unknown: { state: "unknown" as const },
        confirmed: { state: "confirmed" as const },
      },
      expected: "confirmed",
    },
    {
      name: "prefers fewer transfers between equally confirmed journeys",
      candidates: [
        candidate([rideLeg()], { id: "two", transferCount: 2 }),
        candidate([rideLeg()], { id: "one", transferCount: 1 }),
      ],
      assessments: {
        two: { state: "confirmed" as const },
        one: { state: "confirmed" as const },
      },
      expected: "one",
    },
    {
      name: "prefers shorter confirmed walking distance",
      candidates: [
        candidate([walkLeg(), rideLeg()], {
          id: "long",
          durationSeconds: 600,
        }),
        candidate([walkLeg(), rideLeg()], {
          id: "short",
          durationSeconds: 600,
        }),
      ].map((value, index) => ({
        ...value,
        legs: value.legs.map((leg) =>
          leg.type === "walk"
            ? { ...leg, distanceMeters: index ? 80 : 250 }
            : leg,
        ),
      })),
      assessments: {
        long: {
          state: "confirmed" as const,
          legStates: ["confirmed", "confirmed"],
        },
        short: {
          state: "confirmed" as const,
          legStates: ["confirmed", "confirmed"],
        },
      },
      expected: "short",
    },
    {
      name: "prefers lower current duration after delay",
      candidates: [
        candidate(
          [
            rideLeg({
              endAt: new Date("2026-08-20T12:07:00.000Z"),
              durationSeconds: 300,
            }),
          ],
          { id: "candidate-a-delayed" },
        ),
        candidate([rideLeg()], { id: "candidate-z-current" }),
      ],
      assessments: {
        "candidate-a-delayed": {
          state: "confirmed" as const,
          departureDelaySeconds: [600],
          arrivalDelaySeconds: [600],
        },
        "candidate-z-current": { state: "confirmed" as const },
      },
      expected: "candidate-z-current",
    },
    {
      name: "uses candidate ID as the stable final tie-break",
      candidates: [
        candidate([rideLeg()], { id: "candidate-z" }),
        candidate([rideLeg()], { id: "candidate-a" }),
      ],
      assessments: {
        "candidate-z": { state: "confirmed" as const },
        "candidate-a": { state: "confirmed" as const },
      },
      expected: "candidate-a",
    },
  ])("$name", async ({ candidates, assessments, expected }) => {
    const result = await plannerFor(
      candidates,
      assessments as unknown as Parameters<typeof plannerFor>[1],
    ).plan(request);

    expect(result.kind).toBe("selected");
    if (result.kind === "selected") {
      expect(result.journey.candidateId).toBe(expected);
    }
  });

  it("keeps wait wording clear and downgrades unsafe live timing without collapsing ride duration", async () => {
    const waitingCandidate = candidate([waitLeg(), rideLeg()], {
      id: "wait-then-ride",
    });
    const waitingAssessment = confirmedAssessment(waitingCandidate);
    const waiting = await plannerForAssessment(
      waitingCandidate,
      waitingAssessment,
    ).plan(request);
    expect(waiting).toMatchObject({
      kind: "selected",
      journey: {
        legs: [
          { type: "wait", instruction: "Wait at 15417." },
          { type: "ride", instruction: "Take N toward Caltrain." },
        ],
      },
    });

    const timingCandidate = candidate([rideLeg()], {
      id: "timing-uncertain",
    });
    const timingAssessment = confirmedAssessment(timingCandidate);
    timingAssessment.legs[0]!.departureDelaySeconds = 700;
    timingAssessment.legs[0]!.arrivalDelaySeconds = -60;
    const timing = await plannerForAssessment(
      timingCandidate,
      timingAssessment,
    ).plan(request);

    expect(timing).toMatchObject({
      kind: "selected",
      journey: {
        status: "check_details",
        title: "Some details need checking",
        legs: [
          {
            type: "ride",
            durationMinutes: 10,
            accessibility: {
              state: "unknown",
              reasons: ["CURRENT_TIMING_UNCERTAIN"],
            },
          },
        ],
        warnings: ["Current timing details need checking."],
      },
    });
  });

  it("builds ordered plain instructions, current times, and defensive copies", async () => {
    const transfer = {
      ...walkLeg("transfer", "16994", null),
      startAt: new Date("2026-08-20T12:12:00.000Z"),
      endAt: new Date("2026-08-20T12:14:00.000Z"),
    };
    const routeCandidate = candidate([walkLeg(), rideLeg(), transfer], {
      id: "described",
    });
    const routeAssessment = assessment(routeCandidate, "unknown", {
      delaySeconds: 61,
      legStates: ["unknown", "unknown", "unknown"],
    });
    routeAssessment.legs[0]!.dependencies = [
      {
        kind: "mapped_path",
        state: "unknown",
        reasons: [
          { code: "MAPPED_PATH_UNCONFIRMED", entityId: "private-leg-id" },
        ],
      },
    ];
    routeAssessment.legs[1]!.departureDelaySeconds = 700;
    routeAssessment.legs[1]!.arrivalDelaySeconds = -60;
    routeAssessment.sources = [
      {
        source: "elevators",
        state: "current",
        checkedAt: new Date("2026-08-20T11:59:00.000Z"),
        sourceUpdatedAt: new Date("2026-08-20T11:58:00.000Z"),
        sourceUrl:
          "https://www.sfmta.com/elevator-status/elevatorstatus.php?src=prod",
      },
    ];

    const result = await plannerForAssessment(
      routeCandidate,
      routeAssessment,
    ).plan(request);
    expect(result.kind).toBe("selected");
    if (result.kind !== "selected") return;

    expect(result.journey).toMatchObject({
      status: "check_details",
      title: "Some details need checking",
      departureAt: new Date("2026-08-20T12:00:00.000Z"),
      arrivalAt: new Date("2026-08-20T12:25:40.000Z"),
      durationMinutes: 26,
      changes: ["Estimated arrival is 12 minutes later."],
      legs: [
        {
          type: "walk",
          instruction:
            "Continue from Place to 15417. This path avoids mapped stairs. Some sidewalk details may be missing.",
          accessibility: {
            state: "unknown",
            reasons: ["MAPPED_PATH_UNCONFIRMED"],
          },
        },
        {
          type: "ride",
          instruction: "Take N toward Caltrain.",
          route: {
            id: "ROUTE-N",
            name: "N",
            color: "#003399",
            destination: "Caltrain",
          },
          startAt: new Date("2026-08-20T12:13:40.000Z"),
          endAt: new Date("2026-08-20T12:23:40.000Z"),
          durationMinutes: 10,
        },
        {
          type: "transfer",
          instruction:
            "Transfer from 16994 to Place. This path avoids mapped stairs. Some sidewalk details may be missing.",
          startAt: new Date("2026-08-20T12:23:40.000Z"),
          endAt: new Date("2026-08-20T12:25:40.000Z"),
        },
      ],
    });
    expect(result.journey.sources).toEqual(routeAssessment.sources);
    for (const [index, leg] of result.journey.legs.entries()) {
      if (index > 0) {
        expect(leg.startAt.getTime()).toBeGreaterThanOrEqual(
          result.journey.legs[index - 1]!.endAt.getTime(),
        );
      }
    }
    expect(result.journey.arrivalAt.getTime()).toBeGreaterThanOrEqual(
      result.journey.legs.at(-1)!.endAt.getTime(),
    );

    routeCandidate.legs[0]!.from.name = "changed";
    routeCandidate.legs[0]!.geometry.coordinates[0]![0] = 0;
    routeAssessment.sources[0]!.checkedAt!.setUTCFullYear(2000);
    expect(result.journey.legs[0]!.from.name).not.toBe("changed");
    expect(result.journey.legs[0]!.geometry.coordinates[0]![0]).toBe(-122.41);
    expect(result.journey.sources[0]!.checkedAt).toEqual(
      new Date("2026-08-20T11:59:00.000Z"),
    );
  });

  it.each([
    {
      source: "trip_updates" as const,
      expectedStatus: "updates_unavailable",
      expectedTitle: "Current updates are unavailable",
    },
    {
      source: "alerts" as const,
      expectedStatus: "updates_unavailable",
      expectedTitle: "Current updates are unavailable",
    },
    {
      source: "elevators" as const,
      expectedStatus: "check_details",
      expectedTitle: "Some details need checking",
    },
  ])(
    "maps unknown $source evidence to exact rider status wording",
    async ({ source, expectedStatus, expectedTitle }) => {
      const routeCandidate = candidate([rideLeg()]);
      const routeAssessment = assessment(routeCandidate, "unknown");
      routeAssessment.sources = [
        {
          source,
          state: "unavailable",
          checkedAt: null,
          sourceUpdatedAt: null,
          sourceUrl: "https://511.org/open-data/transit",
        },
      ];
      const result = await plannerForAssessment(
        routeCandidate,
        routeAssessment,
      ).plan(request);

      expect(result).toMatchObject({
        kind: "selected",
        journey: { status: expectedStatus, title: expectedTitle },
      });
    },
  );

  it("uses allowlisted warnings and exact boarding relocation detail without exposing other source text", async () => {
    const routeCandidate = candidate([rideLeg()]);
    const routeAssessment = assessment(routeCandidate, "unknown");
    routeAssessment.legs[0]!.dependencies = [
      {
        kind: "stop_relocation",
        state: "unknown",
        reasons: [
          {
            code: "STOP_RELOCATION_ACTIVE",
            entityId: "private-relocation-483",
          },
        ],
        relocations: [
          {
            relocationId: "private-relocation-483",
            role: "boarding",
            instruction: "Board at Fifth Street near Market Street.",
          },
        ],
      },
      {
        kind: "service_alert",
        state: "unknown",
        reasons: [
          { code: "SERVICE_ALERT_ACTIVE", entityId: "private-alert-992" },
        ],
      },
    ];
    routeAssessment.sources = [
      {
        source: "elevators",
        state: "older",
        checkedAt: new Date("2026-08-20T11:00:00.000Z"),
        sourceUpdatedAt: null,
        sourceUrl:
          "https://www.sfmta.com/elevator-status/elevatorstatus.php?src=prod",
      },
    ];

    const first = await plannerForAssessment(
      routeCandidate,
      routeAssessment,
    ).plan(request);
    const second = await plannerForAssessment(
      routeCandidate,
      routeAssessment,
    ).plan(request);

    expect(first).toMatchObject({
      kind: "selected",
      journey: {
        status: "check_details",
        title: "Some details need checking",
        legs: [
          {
            instruction:
              "Board at Fifth Street near Market Street. Then take N toward Caltrain.",
          },
        ],
        warnings: [
          "A current service update may affect this journey.",
          "A stop for this journey has moved.",
          "Some information is older than expected.",
        ],
        changes: ["Boarding uses a temporary stop."],
      },
    });
    expect(second).toEqual(first);
    if (first.kind !== "selected") return;
    expect(
      JSON.stringify({
        title: first.journey.title,
        instructions: first.journey.legs.map((leg) => leg.instruction),
        warnings: first.journey.warnings,
        changes: first.journey.changes,
      }),
    ).not.toMatch(/private-|GTFS|OTP|GraphQL|schema|fingerprint|protobuf/i);
  });

  it("appends an exact alighting relocation after the normal ride instruction", async () => {
    const routeCandidate = candidate([rideLeg()]);
    const routeAssessment = assessment(routeCandidate, "unknown");
    routeAssessment.legs[0]!.dependencies = [
      {
        kind: "stop_relocation",
        state: "unknown",
        reasons: [
          { code: "STOP_RELOCATION_ACTIVE", entityId: "move-alighting" },
        ],
        relocations: [
          {
            relocationId: "move-alighting",
            role: "alighting",
            instruction: "Get off at Market Street near Second Street.",
          },
        ],
      },
    ];

    const result = await plannerForAssessment(
      routeCandidate,
      routeAssessment,
    ).plan(request);

    expect(result).toMatchObject({
      kind: "selected",
      journey: {
        status: "check_details",
        legs: [
          {
            instruction:
              "Take N toward Caltrain. Get off at Market Street near Second Street.",
          },
        ],
      },
    });
  });

  it("creates semantic category hashes with five-minute ETA materiality", async () => {
    async function fingerprintFor(
      options: {
        routeName?: string;
        tripId?: string;
        geometryDelta?: number;
        serviceDayOffset?: number;
        relocationId?: string;
        elevatorId?: string;
        warningId?: string;
        sourceState?: "current" | "older";
        etaDelaySeconds?: number;
      } = {},
    ) {
      const dayOffsetMs = (options.serviceDayOffset ?? 0) * 86_400_000;
      const ride = rideLeg({
        routeName: options.routeName ?? "N",
        tripId: options.tripId ?? "TRIP-N-1",
      });
      if (options.geometryDelta) {
        ride.geometry.coordinates[1]![0] += options.geometryDelta;
      }
      ride.startAt = new Date(ride.startAt.getTime() + dayOffsetMs);
      ride.endAt = new Date(ride.endAt.getTime() + dayOffsetMs);
      const routeCandidate = candidate([ride]);
      const etaDelaySeconds = options.etaDelaySeconds ?? 0;
      const routeAssessment = assessment(routeCandidate, "unknown", {
        delaySeconds: etaDelaySeconds,
      });
      routeAssessment.legs[0]!.departureDelaySeconds = etaDelaySeconds;
      routeAssessment.legs[0]!.arrivalDelaySeconds = etaDelaySeconds;
      routeAssessment.legs[0]!.dependencies = [
        {
          kind: "stop_access",
          state: "unknown",
          reasons: [{ code: "STOP_ACCESS_UNKNOWN", entityId: "15417" }],
        },
        ...(options.relocationId
          ? [
              {
                kind: "stop_relocation" as const,
                state: "unknown" as const,
                reasons: [
                  {
                    code: "STOP_RELOCATION_ACTIVE" as const,
                    entityId: options.relocationId,
                  },
                ],
                relocations: [
                  {
                    relocationId: options.relocationId,
                    role: "boarding" as const,
                    instruction: "Board at Fifth Street near Market Street.",
                  },
                ],
              },
            ]
          : []),
        ...(options.elevatorId
          ? [
              {
                kind: "stop_access" as const,
                state: "unknown" as const,
                reasons: [
                  {
                    code: "ELEVATOR_STATUS_UNKNOWN" as const,
                    entityId: options.elevatorId,
                  },
                ],
              },
            ]
          : []),
        ...(options.warningId
          ? [
              {
                kind: "service_alert" as const,
                state: "unknown" as const,
                reasons: [
                  {
                    code: "SERVICE_ALERT_ACTIVE" as const,
                    entityId: options.warningId,
                  },
                ],
              },
            ]
          : []),
      ];
      routeAssessment.sources = [
        {
          source: "elevators",
          state: options.sourceState ?? "current",
          checkedAt: new Date("2026-08-20T11:59:00.000Z"),
          sourceUpdatedAt: null,
          sourceUrl:
            "https://www.sfmta.com/elevator-status/elevatorstatus.php?src=prod",
        },
      ];
      const result = await plannerForAssessment(
        routeCandidate,
        routeAssessment,
      ).plan(request);
      if (result.kind !== "selected") throw new Error("expected selected");
      return result.journey.fingerprint;
    }

    const base = await fingerprintFor();
    const same = await fingerprintFor();
    const nextServiceDay = await fingerprintFor({ serviceDayOffset: 1 });
    const harmlessPrivateRouteChange = await fingerprintFor({
      tripId: "TRIP-N-OTHER",
      geometryDelta: 0.001,
    });
    const routeChanged = await fingerprintFor({ routeName: "T" });
    const relocationA = await fingerprintFor({ relocationId: "move-a" });
    const relocationB = await fingerprintFor({ relocationId: "move-b" });
    const elevatorA = await fingerprintFor({ elevatorId: "elevator-a" });
    const elevatorB = await fingerprintFor({ elevatorId: "elevator-b" });
    const warningA = await fingerprintFor({ warningId: "alert-a" });
    const warningB = await fingerprintFor({ warningId: "alert-b" });
    const sourceChanged = await fingerprintFor({ sourceState: "older" });
    const fourMinutes = await fingerprintFor({ etaDelaySeconds: 240 });
    const fiveMinutes = await fingerprintFor({ etaDelaySeconds: 300 });

    expect(base).toEqual(same);
    expect(base.version).toBe(1);
    expect([
      base.hash,
      base.categories.route,
      base.categories.stop,
      base.categories.elevator,
      base.categories.warning,
      base.categories.eta,
    ]).toEqual(Array(6).fill(expect.stringMatching(/^[a-f0-9]{64}$/)));

    expect(nextServiceDay.categories.eta).toBe(base.categories.eta);
    expect(harmlessPrivateRouteChange.categories.route).toBe(
      base.categories.route,
    );

    expect(routeChanged.categories.route).not.toBe(base.categories.route);
    expect(routeChanged.categories.stop).toBe(base.categories.stop);

    expect(relocationB.categories.stop).not.toBe(relocationA.categories.stop);
    expect(elevatorB.categories.elevator).not.toBe(
      elevatorA.categories.elevator,
    );
    expect(warningB.categories.warning).not.toBe(warningA.categories.warning);
    expect(sourceChanged.categories.warning).not.toBe(base.categories.warning);

    expect(fourMinutes.categories.eta).toBe(base.categories.eta);
    expect(fiveMinutes.categories.eta).not.toBe(base.categories.eta);
    expect(fiveMinutes.eta.shiftSeconds).toBe(300);
    expect(fiveMinutes.hash).not.toBe(base.hash);
  });
});
