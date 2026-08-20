import { describe, expect, it } from "vitest";

import type { SafeJourneyPlan } from "@/domain/journey/citywide-journey-form";
import {
  compareJourneyChanges,
  type JourneyChangeInput,
  type JourneyPlanSafeSnapshot,
} from "@/domain/notifications/journey-changes";

const TIMESTAMP = "2026-08-20T19:00:00.000Z";
const ARRIVAL = "2026-08-20T19:30:00.000Z";
const HASH_A =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HASH_B =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const HASH_C =
  "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const HASH_D =
  "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";
const HASH_E =
  "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const HASH_F =
  "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";

const source = {
  source: "schedule" as const,
  checkedAt: TIMESTAMP,
  sourceUpdatedAt: TIMESTAMP,
  freshness: "current" as const,
  sourceUrl: "https://511.org/open-data/transit",
};

function plan(overrides: Partial<SafeJourneyPlan> = {}): SafeJourneyPlan {
  return {
    status: "confirmed",
    title: "A private title that must never be sent",
    summary: "A step-free journey is available.",
    departureAt: TIMESTAMP,
    arrivalAt: ARRIVAL,
    durationMinutes: 30,
    legs: [
      {
        type: "walk",
        from: "Market Street",
        to: "5 Fulton stop",
        startAt: TIMESTAMP,
        endAt: "2026-08-20T19:05:00.000Z",
        durationMinutes: 5,
        instruction: "Walk to the stop.",
        geometry: {
          type: "LineString",
          coordinates: [
            [-122.41, 37.78],
            [-122.405, 37.782],
          ],
        },
        accessibility: { state: "confirmed", reasons: [] },
      },
      {
        type: "ride",
        from: "5 Fulton stop",
        to: "Ferry Building",
        startAt: "2026-08-20T19:05:00.000Z",
        endAt: ARRIVAL,
        durationMinutes: 25,
        route: {
          id: "private-route-id",
          name: "5 Fulton",
          color: "#123456",
          destination: "Ferry Building",
        },
        instruction: "Ride Muni toward the waterfront.",
        geometry: {
          type: "LineString",
          coordinates: [
            [-122.405, 37.782],
            [-122.3937, 37.7955],
          ],
        },
        accessibility: { state: "confirmed", reasons: [] },
      },
    ],
    warnings: [],
    changes: [],
    sources: [source],
    map: {
      bounds: { west: -122.42, south: 37.77, east: -122.39, north: 37.8 },
      origin: { type: "Point", coordinates: [-122.41, 37.78] },
      destination: { type: "Point", coordinates: [-122.3937, 37.7955] },
      affectedStops: { type: "FeatureCollection", features: [] },
    },
    ...overrides,
  };
}

function snapshot(
  planOverrides: Partial<SafeJourneyPlan> = {},
  fingerprintOverrides: Partial<
    NonNullable<JourneyPlanSafeSnapshot["fingerprint"]>
  > = {},
): JourneyPlanSafeSnapshot {
  return {
    plan: plan(planOverrides),
    fingerprint: {
      version: 1,
      hash: HASH_A,
      categories: {
        route: HASH_B,
        stop: HASH_C,
        elevator: HASH_D,
        warning: HASH_E,
        eta: HASH_F,
      },
      eta: {
        scheduledDurationSeconds: 1_800,
        currentDurationSeconds: 1_800,
        shiftSeconds: 0,
      },
      ...fingerprintOverrides,
    },
  };
}

function input(
  current: JourneyPlanSafeSnapshot,
  previous: JourneyPlanSafeSnapshot | null = current,
): JourneyChangeInput {
  return { current, previous };
}

function expectCheckingFallback(
  result: ReturnType<typeof compareJourneyChanges>,
) {
  expect(result.sections).toEqual([
    { title: "What changed", items: [] },
    { title: "What is working", items: [] },
    {
      title: "What needs checking",
      items: ["Current journey details need checking."],
    },
  ]);
}

describe("journey change comparison seam", () => {
  it("returns ordered empty-change, working, and checking sections for an unchanged plan", () => {
    const result = compareJourneyChanges(input(snapshot(), snapshot()));

    expect(result).toEqual({
      sections: [
        { title: "What changed", items: ["No changes to your journey."] },
        {
          title: "What is working",
          items: ["Your step-free journey is still confirmed."],
        },
        { title: "What needs checking", items: [] },
      ],
    });
  });

  it("summarizes route and stop changes without exposing identifiers", () => {
    const previous = snapshot();
    const current = snapshot(
      {
        legs: previous.plan!.legs.map((leg) =>
          leg.type === "ride" ? { ...leg, from: "Temporary Fulton stop" } : leg,
        ),
      },
      {
        categories: {
          route: HASH_A,
          stop: HASH_B,
          elevator: HASH_D,
          warning: HASH_E,
          eta: HASH_F,
        },
      },
    );

    const result = compareJourneyChanges(input(current, previous));
    const serialized = JSON.stringify(result);

    expect(result.sections[0]).toEqual({
      title: "What changed",
      items: ["Your Muni route changed.", "A boarding or exit stop changed."],
    });
    expect(serialized).not.toContain("private-route-id");
    expect(serialized).not.toContain(HASH_A);
    expect(serialized).not.toContain("fingerprint");
  });

  it("reports an elevator change and puts an active access concern in checking", () => {
    const previous = snapshot();
    const current = snapshot(
      {
        status: "check_details",
        warnings: ["A needed elevator is out of service."],
      },
      {
        categories: {
          route: HASH_B,
          stop: HASH_C,
          elevator: HASH_A,
          warning: HASH_A,
          eta: HASH_F,
        },
      },
    );

    expect(compareJourneyChanges(input(current, previous)).sections).toEqual([
      {
        title: "What changed",
        items: [
          "A step-free route is no longer confirmed.",
          "Elevator access changed.",
          "A journey warning changed.",
        ],
      },
      { title: "What is working", items: [] },
      {
        title: "What needs checking",
        items: [
          "Some journey details need checking.",
          "Elevator access needs checking.",
        ],
      },
    ]);
  });

  it("reports a warning change even when the warning text is not copied into the output", () => {
    const previous = snapshot();
    const current = snapshot(
      { warnings: ["A current service update may affect this journey."] },
      {
        categories: {
          route: HASH_B,
          stop: HASH_C,
          elevator: HASH_D,
          warning: HASH_A,
          eta: HASH_F,
        },
      },
    );

    const result = compareJourneyChanges(input(current, previous));

    expect(result.sections[0].items).toEqual(["A journey warning changed."]);
    expect(result.sections[2].items).toEqual([
      "Some journey details need checking.",
    ]);
    expect(JSON.stringify(result)).not.toContain("SERVICE_ALERT_ACTIVE");
  });

  it.each([
    [4, false],
    [5, true],
  ])(
    "only reports an ETA shift at or above five minutes (%d)",
    (minutes, reported) => {
      const previous = snapshot();
      const current = snapshot(
        { durationMinutes: 30 + minutes },
        {
          categories: {
            route: HASH_B,
            stop: HASH_C,
            elevator: HASH_D,
            warning: HASH_E,
            eta: minutes === 4 ? HASH_A : HASH_B,
          },
          eta: {
            scheduledDurationSeconds: 1_800,
            currentDurationSeconds: (30 + minutes) * 60,
            shiftSeconds: minutes * 60,
          },
        },
      );

      const items = compareJourneyChanges(input(current, previous)).sections[0]
        .items;
      expect(items.some((item) => item.includes("arrival"))).toBe(reported);
      if (reported)
        expect(items).toContain("Your arrival is about 5 minutes later.");
    },
  );

  it("handles a lost confirmation without pretending a replacement route exists", () => {
    const result = compareJourneyChanges(
      input(
        snapshot(
          { status: "unavailable" },
          {
            categories: {
              route: HASH_B,
              stop: HASH_C,
              elevator: HASH_D,
              warning: HASH_E,
              eta: HASH_A,
            },
          },
        ),
        snapshot(),
      ),
    );

    expect(result.sections).toEqual([
      {
        title: "What changed",
        items: ["A step-free route is no longer confirmed."],
      },
      { title: "What is working", items: [] },
      {
        title: "What needs checking",
        items: ["No step-free route is confirmed right now."],
      },
    ]);
  });

  it("defaults to checking when there is no confirmed current plan or baseline", () => {
    const result = compareJourneyChanges({
      current: { plan: null, fingerprint: null },
      previous: null,
    });

    expect(result.sections).toEqual([
      { title: "What changed", items: [] },
      { title: "What is working", items: [] },
      {
        title: "What needs checking",
        items: ["No step-free route is confirmed right now."],
      },
    ]);
  });

  it("uses a safe checking fallback for an invalid current snapshot", () => {
    const result = compareJourneyChanges({
      current: { plan: { status: "confirmed" } } as never,
      previous: snapshot(),
    });

    expect(result.sections).toEqual([
      { title: "What changed", items: [] },
      { title: "What is working", items: [] },
      {
        title: "What needs checking",
        items: ["Current journey details need checking."],
      },
    ]);
  });

  it("falls back safely when the current overall fingerprint hash is malformed", () => {
    const baseline = snapshot();
    const current = {
      ...baseline,
      fingerprint: { ...baseline.fingerprint!, hash: "not-a-hash" },
    };

    expectCheckingFallback(
      compareJourneyChanges({
        current: current as never,
        previous: baseline,
      }),
    );
  });

  it("falls back safely when the current category fingerprint is malformed", () => {
    const baseline = snapshot();
    const current = {
      ...baseline,
      fingerprint: {
        ...baseline.fingerprint!,
        categories: {
          ...baseline.fingerprint!.categories,
          route: "not-a-category-hash",
        },
      },
    };

    expectCheckingFallback(
      compareJourneyChanges({
        current: current as never,
        previous: baseline,
      }),
    );
  });

  it("ignores an invalid previous fingerprint as an unusable baseline", () => {
    const current = snapshot();
    const previousBase = snapshot({
      legs: current.plan!.legs.map((leg) =>
        leg.type === "ride"
          ? { ...leg, from: "A different boarding stop" }
          : leg,
      ),
    });
    const previous = {
      ...previousBase,
      fingerprint: {
        ...previousBase.fingerprint!,
        categories: {
          ...previousBase.fingerprint!.categories,
          route: "not-a-category-hash",
        },
      },
    };

    const result = compareJourneyChanges({
      current,
      previous: previous as never,
    });

    expect(result.sections).toEqual([
      { title: "What changed", items: [] },
      {
        title: "What is working",
        items: ["Your step-free journey is confirmed."],
      },
      { title: "What needs checking", items: [] },
    ]);
  });

  it("is stable across repeated comparison and never emits internal metadata", () => {
    const current = snapshot({ warnings: ["Some details need checking."] });
    const previous = snapshot();
    const first = compareJourneyChanges(input(current, previous));
    const second = compareJourneyChanges(input(current, previous));

    expect(second).toEqual(first);
    expect(JSON.stringify(first)).not.toMatch(
      /fingerprint|private-|LLM|provider/iu,
    );
  });
});
