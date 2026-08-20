import type {
  AccessibilityEvidenceSnapshot,
  AccessibilityEvidenceSource,
} from "../../src/domain/journey/accessibility-evidence";
import type {
  RouteCandidate,
  RouteCandidateLeg,
} from "../../src/domain/journey/route-engine";

export const EVALUATED_AT = new Date("2026-08-20T12:00:00.000Z");

const point = (stopId: string | null, longitude: number) => ({
  name: stopId ?? "Place",
  latitude: 37.78,
  longitude,
  stopId,
});

export function candidate(
  legs: RouteCandidateLeg[],
  overrides: Partial<RouteCandidate> = {},
): RouteCandidate {
  const departureAt = new Date(
    Math.min(...legs.map((leg) => leg.startAt.getTime())),
  );
  const arrivalAt = new Date(
    Math.max(...legs.map((leg) => leg.endAt.getTime())),
  );
  return {
    id: "candidate-1",
    departureAt,
    arrivalAt,
    durationSeconds: (arrivalAt.getTime() - departureAt.getTime()) / 1_000,
    walkingDistanceMeters: legs.reduce(
      (total, leg) =>
        total +
        (leg.type === "walk" || leg.type === "transfer"
          ? leg.distanceMeters
          : 0),
      0,
    ),
    transferCount: legs.filter((leg) => leg.type === "transfer").length,
    legs,
    ...overrides,
  };
}

export function rideLeg(
  overrides: Partial<Extract<RouteCandidateLeg, { type: "ride" }>> = {},
): Extract<RouteCandidateLeg, { type: "ride" }> {
  return {
    type: "ride",
    from: point("15417", -122.408),
    to: point("16994", -122.401),
    startAt: new Date("2026-08-20T12:02:00.000Z"),
    endAt: new Date("2026-08-20T12:12:00.000Z"),
    durationSeconds: 600,
    geometry: {
      type: "LineString",
      coordinates: [
        [-122.408, 37.78],
        [-122.401, 37.79],
      ],
    },
    routeId: "ROUTE-N",
    tripId: "TRIP-N-1",
    mode: "tram",
    routeName: "N",
    routeColor: "#003399",
    headsign: "Caltrain",
    intermediateStopIds: [],
    ...overrides,
  };
}

export function waitLeg(
  stopId = "15417",
): Extract<RouteCandidateLeg, { type: "wait" }> {
  return {
    type: "wait",
    from: point(stopId, -122.408),
    to: point(stopId, -122.408),
    startAt: EVALUATED_AT,
    endAt: new Date("2026-08-20T12:02:00.000Z"),
    durationSeconds: 120,
    geometry: {
      type: "LineString",
      coordinates: [
        [-122.408, 37.78],
        [-122.408, 37.78],
      ],
    },
  };
}

export function walkLeg(
  type: "walk" | "transfer" = "walk",
  fromStopId: string | null = null,
  toStopId: string | null = "15417",
): Extract<RouteCandidateLeg, { type: "walk" | "transfer" }> {
  return {
    type,
    from: point(fromStopId, -122.41),
    to: point(toStopId, -122.408),
    startAt: EVALUATED_AT,
    endAt: new Date("2026-08-20T12:02:00.000Z"),
    durationSeconds: 120,
    distanceMeters: 120,
    geometry: {
      type: "LineString",
      coordinates: [
        [-122.41, 37.78],
        [-122.408, 37.78],
      ],
    },
  };
}

const current = (sourceUrl: string) => ({
  state: "current" as const,
  checkedAt: new Date("2026-08-20T11:59:00.000Z"),
  sourceUpdatedAt: new Date("2026-08-20T11:58:00.000Z"),
  sourceUrl,
});

export function evidenceSnapshot(): AccessibilityEvidenceSnapshot {
  return {
    elevators: {
      ...current(
        "https://www.sfmta.com/elevator-status/elevatorstatus.php?src=prod",
      ),
      stations: [
        {
          stationId: "powell",
          state: "accessible",
          elevators: [
            {
              equipmentId: "sfmta:155fa9cd88ca1b910f173175e6d47c76",
              state: "working",
            },
            {
              equipmentId: "sfmta:c3c5a5304402993b7c0e65b129cc4425",
              state: "working",
            },
            {
              equipmentId: "sfmta:98a3cedeeef224f548f6dd9257fe9ab3",
              state: "working",
            },
          ],
        },
        {
          stationId: "montgomery",
          state: "accessible",
          elevators: [
            {
              equipmentId: "sfmta:ad36806b15e83e02c44614b61db96a11",
              state: "working",
            },
            {
              equipmentId: "sfmta:98fffe110ab693e3e61a450eb40cf195",
              state: "working",
            },
          ],
        },
      ],
    },
    advisories: {
      ...current(
        "https://www.sfmta.com/travel-transit-updates?field_transit_type_disrupted_value=Accessibility",
      ),
      advisories: [],
    },
    relocations: {
      ...current(
        "https://www.sfmta.com/travel-updates/temporary-stop-relocations",
      ),
      relocations: [],
    },
    guides: {
      ...current(
        "https://www.sfmta.com/getting-around/sfmta-accessibility/muni-access-guide/access-muni-metro/muni-metro-accessible-stops",
      ),
    },
    tripUpdates: {
      ...current("https://511.org/open-data/transit"),
      updates: [],
    },
    alerts: {
      ...current("https://511.org/open-data/transit"),
      alerts: [],
    },
  };
}

export class MemoryAccessibilityEvidenceSource implements AccessibilityEvidenceSource {
  constructor(
    public snapshot: AccessibilityEvidenceSnapshot = evidenceSnapshot(),
  ) {}

  async read() {
    return structuredClone(this.snapshot);
  }
}
