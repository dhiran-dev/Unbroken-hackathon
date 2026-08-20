import { describe, expect, it } from "vitest";

import {
  JourneyRequestInvalidError,
  createJourneyPlanner,
} from "@/domain/journey/journey";
import type { EvidenceProvenance } from "@/domain/journey/accessibility-evidence";
import type {
  JourneyPlannerCore,
  JourneyPlannerCoreResult,
  SelectedJourneyDraft,
} from "@/domain/journey/journey-planner";
import type { RouteEnginePlace } from "@/domain/journey/route-engine";
import type { PlaceChoice, TransitCatalog } from "@/domain/transit/catalog";

const NOW = new Date("2026-08-20T12:00:00.000Z");
const DEPARTURE = "2026-08-20T12:15:00-07:00";
const DEPARTURE_DATE = new Date(DEPARTURE);

function place(
  id: string,
  name: string,
  latitude: number,
  longitude: number,
  stopIds: string[] = [id.toUpperCase()],
): PlaceChoice {
  return {
    id,
    type: "stop",
    name,
    description: "Muni stop",
    latitude,
    longitude,
    stopIds,
    routeNames: ["N"],
  };
}

function catalogWith(places: PlaceChoice[]): TransitCatalog {
  return {
    async searchPlaces() {
      return structuredClone(places);
    },
    async getPlace(ref) {
      const found = places.find((candidate) => candidate.id === ref.placeId);
      return found ? structuredClone(found) : null;
    },
    async getCoverage() {
      return { available: false };
    },
  };
}

function point(
  name: string,
  latitude: number,
  longitude: number,
  stopId: string | null,
) {
  return { name, latitude, longitude, stopId };
}

function source(
  value: EvidenceProvenance["source"],
  state: EvidenceProvenance["state"],
  checkedAt: Date | null,
  sourceUpdatedAt: Date | null,
  sourceUrl = "https://private.example/internal-source",
): EvidenceProvenance {
  return { source: value, state, checkedAt, sourceUpdatedAt, sourceUrl };
}

function selectedDraft(): SelectedJourneyDraft {
  const firstStart = new Date("2026-08-20T19:15:00.000Z");
  const firstEnd = new Date("2026-08-20T19:25:00.000Z");
  const secondStart = firstEnd;
  const secondEnd = new Date("2026-08-20T19:35:00.000Z");
  return {
    candidateId: "private-candidate-id",
    status: "check_details",
    title: "Some details need checking",
    departureAt: firstStart,
    arrivalAt: secondEnd,
    durationMinutes: 20,
    legs: [
      {
        type: "walk",
        from: point("Origin internal point", 37.75, -122.42, "STOP-A"),
        to: point("Boarding point", 37.755, -122.415, "STOP-B"),
        startAt: firstStart,
        endAt: firstEnd,
        durationMinutes: 10,
        distanceMeters: 250,
        instruction: "Continue to the boarding point.",
        geometry: {
          type: "LineString",
          coordinates: [
            [-122.42, 37.75],
            [-122.415, 37.755],
          ],
        },
        accessibility: {
          state: "unknown",
          reasons: ["STOP_ACCESS_UNKNOWN", "STOP_ACCESS_UNKNOWN"],
        },
      },
      {
        type: "ride",
        from: point("Boarding point", 37.755, -122.415, "STOP-B"),
        to: point("Arrival point", 37.76, -122.41, "STOP-C"),
        startAt: secondStart,
        endAt: secondEnd,
        durationMinutes: 10,
        route: {
          id: "N-JUDAH",
          name: "N",
          color: "#123456",
          destination: "Caltrain",
        },
        instruction: "Take N toward Caltrain.",
        geometry: {
          type: "LineString",
          coordinates: [
            [-122.415, 37.755],
            [-122.41, 37.76],
          ],
        },
        accessibility: { state: "confirmed", reasons: [] },
      },
    ],
    warnings: ["Some details need checking."],
    changes: ["A stop for this journey has moved."],
    sources: [
      source(
        "trip_updates",
        "current",
        new Date("2026-08-20T19:10:00.000Z"),
        new Date("2026-08-20T19:09:00.000Z"),
      ),
      source("alerts", "unavailable", null, null),
      source(
        "service_changes",
        "current",
        new Date("2026-08-20T18:00:00.000Z"),
        null,
      ),
      source(
        "stop_changes",
        "current",
        new Date("2026-08-20T19:11:00.000Z"),
        null,
      ),
      source(
        "station_access",
        "current",
        new Date("2026-08-20T19:12:00.000Z"),
        null,
      ),
      source("elevators", "unavailable", null, null),
    ],
    fingerprint: {
      version: 1,
      hash: "private-fingerprint",
      categories: {
        route: "private-route-fingerprint",
        stop: "private-stop-fingerprint",
        elevator: "private-elevator-fingerprint",
        warning: "private-warning-fingerprint",
        eta: "private-eta-fingerprint",
      },
      eta: {
        scheduledDurationSeconds: 1_200,
        currentDurationSeconds: 1_200,
        shiftSeconds: 0,
      },
    },
  };
}

function plannerFor(
  result: JourneyPlannerCoreResult,
  options: { places?: PlaceChoice[]; clock?: () => Date } = {},
) {
  const core: JourneyPlannerCore = {
    async plan() {
      return result;
    },
  };
  return createJourneyPlanner({
    catalog: catalogWith(
      options.places ?? [
        place("stop:origin", "Origin", 37.75, -122.42, ["STOP-A"]),
        place("stop:destination", "Destination", 37.76, -122.41, ["STOP-C"]),
      ],
    ),
    core,
    clock: options.clock ?? (() => new Date(NOW)),
  });
}

function expectInvalid(action: () => Promise<unknown>) {
  return expect(action()).rejects.toBeInstanceOf(JourneyRequestInvalidError);
}

describe("public journey planner facade", () => {
  it("resolves catalog choices once, captures one evaluation clock, and projects an allowlisted plan", async () => {
    const places = [
      place("stop:origin", "Origin", 37.75, -122.42, ["STOP-A"]),
      place("stop:destination", "Destination", 37.76, -122.41, ["STOP-C"]),
    ];
    const requests: Array<{
      origin: RouteEnginePlace;
      destination: RouteEnginePlace;
      departureAt: Date;
      evaluatedAt: Date;
    }> = [];
    let clockReads = 0;
    const planner = createJourneyPlanner({
      catalog: catalogWith(places),
      core: {
        async plan(request) {
          requests.push(request);
          return { kind: "selected", journey: selectedDraft() };
        },
      },
      clock: () => {
        clockReads += 1;
        return new Date(NOW);
      },
    });

    const result = await planner.plan({
      origin: { type: "catalog", placeId: "stop:origin" },
      destination: { type: "catalog", placeId: "stop:destination" },
      departureAt: DEPARTURE,
    });

    expect(clockReads).toBe(1);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      origin: {
        label: "Origin",
        latitude: 37.75,
        longitude: -122.42,
        stopIds: ["STOP-A"],
      },
      destination: {
        label: "Destination",
        latitude: 37.76,
        longitude: -122.41,
        stopIds: ["STOP-C"],
      },
      departureAt: DEPARTURE_DATE,
      evaluatedAt: NOW,
    });
    expect(result).toMatchObject({
      status: "check_details",
      title: "Some details need checking",
      departureAt: "2026-08-20T19:15:00.000Z",
      arrivalAt: "2026-08-20T19:35:00.000Z",
      durationMinutes: 20,
    });
    expect(result).not.toHaveProperty("candidateId");
    expect(result).not.toHaveProperty("fingerprint");
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("private-");
    expect(serialized).not.toContain("candidateId");
    expect(serialized).not.toContain("fingerprint");
    expect(serialized).not.toContain("MAPPED_PATH_UNCONFIRMED");
    expect(serialized).not.toContain("STOP_ACCESS_UNKNOWN");
    expect(result.legs[0]).toEqual({
      type: "walk",
      from: "Origin internal point",
      to: "Boarding point",
      startAt: "2026-08-20T19:15:00.000Z",
      endAt: "2026-08-20T19:25:00.000Z",
      durationMinutes: 10,
      instruction: "Continue to the boarding point.",
      geometry: {
        type: "LineString",
        coordinates: [
          [-122.42, 37.75],
          [-122.415, 37.755],
        ],
      },
      accessibility: {
        state: "unknown",
        reasons: ["Step-free stop access details need checking."],
      },
    });
  });

  it("accepts a validated one-time current location and labels it exactly", async () => {
    let request: RouteEnginePlace | undefined;
    const planner = createJourneyPlanner({
      catalog: catalogWith([
        place("stop:destination", "Destination", 37.76, -122.41, ["STOP-C"]),
      ]),
      core: {
        async plan(value) {
          request = value.origin;
          return {
            kind: "unavailable",
            status: "unavailable",
            title: "No step-free route confirmed",
          };
        },
      },
      clock: () => new Date(NOW),
    });

    await planner.plan({
      origin: {
        type: "current_location",
        latitude: 37.75,
        longitude: -122.42,
        accuracyMeters: 12.5,
      },
      destination: { type: "catalog", placeId: "stop:destination" },
      departureAt: DEPARTURE,
    });

    expect(request).toEqual({
      label: "Current location",
      latitude: 37.75,
      longitude: -122.42,
      stopIds: [],
    });
  });

  it.each([
    {
      name: "unselected catalog ID",
      request: {
        origin: { type: "catalog", placeId: "stop:missing" },
        destination: { type: "catalog", placeId: "stop:destination" },
        departureAt: DEPARTURE,
      },
    },
    {
      name: "raw name instead of a catalog reference",
      request: {
        origin: "Origin",
        destination: { type: "catalog", placeId: "stop:destination" },
        departureAt: DEPARTURE,
      },
    },
    {
      name: "extra request key",
      request: {
        origin: { type: "catalog", placeId: "stop:origin" },
        destination: { type: "catalog", placeId: "stop:destination" },
        departureAt: DEPARTURE,
        query: "private",
      },
    },
    {
      name: "inaccurate current location",
      request: {
        origin: {
          type: "current_location",
          latitude: 37.75,
          longitude: -122.42,
          accuracyMeters: 1_001,
        },
        destination: { type: "catalog", placeId: "stop:destination" },
        departureAt: DEPARTURE,
      },
    },
    {
      name: "current location outside route boundary",
      request: {
        origin: {
          type: "current_location",
          latitude: 37.9,
          longitude: -122.42,
          accuracyMeters: 10,
        },
        destination: { type: "catalog", placeId: "stop:destination" },
        departureAt: DEPARTURE,
      },
    },
    {
      name: "impossible timestamp",
      request: {
        origin: { type: "catalog", placeId: "stop:origin" },
        destination: { type: "catalog", placeId: "stop:destination" },
        departureAt: "2026-02-30T12:00:00-08:00",
      },
    },
    {
      name: "timestamp without offset",
      request: {
        origin: { type: "catalog", placeId: "stop:origin" },
        destination: { type: "catalog", placeId: "stop:destination" },
        departureAt: "2026-08-20T12:00:00",
      },
    },
    {
      name: "same catalog endpoint",
      request: {
        origin: { type: "catalog", placeId: "stop:origin" },
        destination: { type: "catalog", placeId: "stop:origin" },
        departureAt: DEPARTURE,
      },
    },
  ])("rejects $name with a safe typed error", async ({ request }) => {
    const planner = plannerFor({
      kind: "unavailable",
      status: "unavailable",
      title: "No step-free route confirmed",
    });
    await expectInvalid(() => planner.plan(request as never));
  });

  it("returns a complete unavailable plan with only map data when the core has no route", async () => {
    const planner = plannerFor({
      kind: "unavailable",
      status: "unavailable",
      title: "No step-free route confirmed",
    });

    const result = await planner.plan({
      origin: { type: "catalog", placeId: "stop:origin" },
      destination: { type: "catalog", placeId: "stop:destination" },
      departureAt: DEPARTURE,
    });

    expect(result).toMatchObject({
      status: "unavailable",
      title: "No step-free route confirmed",
      departureAt: "2026-08-20T19:15:00.000Z",
      arrivalAt: "2026-08-20T19:15:00.000Z",
      durationMinutes: 0,
      legs: [],
      warnings: [],
      changes: [],
      sources: [],
    });
    expect(result.map).toEqual({
      origin: { type: "Point", coordinates: [-122.42, 37.75] },
      destination: { type: "Point", coordinates: [-122.41, 37.76] },
      bounds: { west: -122.42, south: 37.75, east: -122.41, north: 37.76 },
      affectedStops: { type: "FeatureCollection", features: [] },
    });
  });

  it("maps provenance conservatively, preserves null check times, and deduplicates affected stops", async () => {
    const draft = selectedDraft();
    const planner = plannerFor({ kind: "selected", journey: draft });
    const result = await planner.plan({
      origin: { type: "catalog", placeId: "stop:origin" },
      destination: { type: "catalog", placeId: "stop:destination" },
      departureAt: DEPARTURE,
    });

    expect(result.sources).toEqual([
      {
        source: "arrivals",
        checkedAt: "2026-08-20T19:10:00.000Z",
        sourceUpdatedAt: "2026-08-20T19:09:00.000Z",
        freshness: "current",
        sourceUrl: "https://511.org/open-data/transit",
      },
      {
        source: "elevators",
        checkedAt: null,
        sourceUpdatedAt: null,
        freshness: "unavailable",
        sourceUrl:
          "https://www.sfmta.com/elevator-status/elevatorstatus.php?src=prod",
      },
      {
        source: "service_changes",
        checkedAt: null,
        sourceUpdatedAt: null,
        freshness: "unavailable",
        sourceUrl: "https://511.org/open-data/transit",
      },
      {
        source: "service_changes",
        checkedAt: "2026-08-20T18:00:00.000Z",
        sourceUpdatedAt: null,
        freshness: "current",
        sourceUrl:
          "https://www.sfmta.com/travel-transit-updates?field_transit_type_disrupted_value=Accessibility",
      },
      {
        source: "station_access",
        checkedAt: "2026-08-20T19:12:00.000Z",
        sourceUpdatedAt: null,
        freshness: "current",
        sourceUrl:
          "https://www.sfmta.com/getting-around/sfmta-accessibility/muni-access-guide/access-muni-metro/muni-metro-accessible-stops",
      },
      {
        source: "stop_changes",
        checkedAt: "2026-08-20T19:11:00.000Z",
        sourceUpdatedAt: null,
        freshness: "current",
        sourceUrl:
          "https://www.sfmta.com/travel-updates/temporary-stop-relocations",
      },
    ]);
    expect(result.map.bounds).toEqual({
      west: -122.42,
      south: 37.75,
      east: -122.41,
      north: 37.76,
    });
    expect(result.map.affectedStops).toEqual({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-122.42, 37.75] },
          properties: {
            id: "STOP-A",
            name: "Origin internal point",
            accessibility: "unknown",
          },
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-122.415, 37.755] },
          properties: {
            id: "STOP-B",
            name: "Boarding point",
            accessibility: "unknown",
          },
        },
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-122.41, 37.76] },
          properties: {
            id: "STOP-C",
            name: "Arrival point",
            accessibility: "confirmed",
          },
        },
      ],
    });
  });

  it.each([
    { status: "confirmed", title: "Step-free details confirmed" },
    { status: "check_details", title: "Some details need checking" },
    { status: "updates_unavailable", title: "Current updates are unavailable" },
  ] as const)(
    "projects every selected rider status with exact wording",
    async ({ status, title }) => {
      const draft = selectedDraft();
      draft.status = status;
      const planner = plannerFor({ kind: "selected", journey: draft });
      const result = await planner.plan({
        origin: { type: "catalog", placeId: "stop:origin" },
        destination: { type: "catalog", placeId: "stop:destination" },
        departureAt: DEPARTURE,
      });
      expect(result.status).toBe(status);
      expect(result.title).toBe(title);
    },
  );

  it("keeps repeated calls byte-for-byte deterministic", async () => {
    const planner = plannerFor({ kind: "selected", journey: selectedDraft() });
    const request = {
      origin: { type: "catalog", placeId: "stop:origin" } as const,
      destination: { type: "catalog", placeId: "stop:destination" } as const,
      departureAt: DEPARTURE,
    };
    const first = await planner.plan(request);
    const second = await planner.plan(request);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
