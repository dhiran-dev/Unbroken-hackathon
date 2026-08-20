import { describe, expect, it } from "vitest";

import type { PublicAccessibility } from "@/domain/accessibility/model";

import {
  ACCESSIBILITY_ADVISORY_SOURCE_URL,
  type AccessibilityAdvisoryView,
} from "@/server/transit/accessibility-advisories";
import {
  STOP_ACCESSIBILITY_GUIDE_SOURCE_URL,
  type StopAccessibilityGuideView,
} from "@/server/transit/stop-accessibility-guides";
import {
  STOP_RELOCATION_SOURCE_URL,
  type StopRelocationView,
} from "@/server/transit/stop-relocations";
import {
  createPublicCitywideStatus,
  ELEVATOR_SOURCE_URL,
  REALTIME_SOURCE_URL,
  type PublicCitywideStatusReads,
  type PublicRealtimeAlertsView,
} from "@/server/citywide-status/public-citywide-status";
import { filterPublicCitywideStatus } from "@/server/citywide-status/status-runtime";

const at = new Date("2026-08-20T12:00:00.000Z");
const checkedAt = new Date("2026-08-20T11:59:00.000Z");
const sourceUpdatedAt = new Date("2026-08-20T11:58:00.000Z");

function accessibility(): PublicAccessibility {
  const stations = Array.from({ length: 11 }, (_, index) => ({
    slug: `station-${index + 1}`,
    name: `Station ${index + 1}`,
    corridorOrder: index + 1,
    state: "accessible" as const,
    elevators: [
      {
        sourceKey: `equipment-${index + 1}`,
        name: `Elevator ${index + 1}`,
        state: "working" as const,
        lastChangedAt: null,
        role: "Street access",
        alternativeName: null,
      },
    ],
  }));
  return {
    trust: {
      state: "current",
      sourceValidAt: sourceUpdatedAt,
      ageSeconds: 120,
    },
    counts: { accessible: 11, limited: 0, unavailable: 0, unknown: 0 },
    stations,
  };
}

function advisories(): AccessibilityAdvisoryView {
  return {
    state: "current",
    checkedAt,
    sourceUpdatedAt: null,
    sourceUrl: ACCESSIBILITY_ADVISORY_SOURCE_URL,
    advisories: [
      {
        advisoryId: "private-advisory-id",
        title: "Elevator entrance change",
        description: "Do not publish this source description.",
        affectedRoutes: ["J"],
        affectedStops: ["Church Street"],
        startsAt: null,
        endsAt: null,
        publicUrl:
          "https://www.sfmta.com/travel-updates/accessibility-change-1",
      },
    ],
  };
}

function relocations(): StopRelocationView {
  return {
    state: "current",
    checkedAt,
    sourceUpdatedAt,
    sourceUrl: STOP_RELOCATION_SOURCE_URL,
    relocations: [
      {
        stopId: "12345",
        stopName: "Market Street & 5th",
        routeNames: ["5", "5R"],
        temporaryStop: "Market Street & 6th",
        scheduleText: "Aug 20–Aug 30",
        startsAt: new Date("2026-08-20T00:00:00.000Z"),
        endsAt: new Date("2026-08-30T23:59:59.000Z"),
        latitude: 37.783,
        longitude: -122.408,
        publicUrl: STOP_RELOCATION_SOURCE_URL,
        boardingInstruction: "Board at the temporary stop.",
      },
    ],
  };
}

function guides(): StopAccessibilityGuideView {
  return {
    state: "current",
    checkedAt,
    sourceUpdatedAt: null,
    sourceUrl: STOP_ACCESSIBILITY_GUIDE_SOURCE_URL,
    guides: [
      {
        stopId: null,
        stationName: "Church Street",
        routeNames: ["J"],
        guidance: "Use the elevator entrance.",
        accessibilityState: "unknown",
        reviewed: true,
        publicUrl: STOP_ACCESSIBILITY_GUIDE_SOURCE_URL,
      },
    ],
  };
}

function alerts(): PublicRealtimeAlertsView {
  return {
    state: "current",
    checkedAt,
    sourceUpdatedAt,
    sourceUrl: REALTIME_SOURCE_URL,
    alerts: [
      {
        entityId: "private-entity-id",
        header: "J Church service change",
        effect: "DETOUR",
        description: "Do not publish this raw description.",
        url: "https://unsafe.example.test/private",
        activePeriods: [],
        informedEntities: [
          {
            agencyId: "private-agency-id",
            routeId: "J",
            tripId: "private-trip-id",
            stopId: "12345",
          },
        ],
      },
    ],
  };
}

function reads(overrides: Partial<PublicCitywideStatusReads> = {}) {
  const defaults: PublicCitywideStatusReads = {
    readElevators: async () => ({ accessibility: accessibility(), checkedAt }),
    readAdvisories: async () => advisories(),
    readRelocations: async () => relocations(),
    readGuides: async () => guides(),
    readRealtimeAlerts: async () => alerts(),
  };
  return { ...defaults, ...overrides };
}

describe("PublicCitywideStatus", () => {
  it("projects all trusted sources through one deterministic public seam", async () => {
    const status = await createPublicCitywideStatus(reads()).read(at);

    expect(status.elevators).toMatchObject({
      state: "current",
      checkedAt,
      sourceUpdatedAt,
      sourceUrl: ELEVATOR_SOURCE_URL,
      count: 11,
      stations: expect.arrayContaining([
        expect.objectContaining({
          slug: "station-1",
          name: "Station 1",
          state: "accessible",
          elevators: [
            expect.objectContaining({
              name: "Elevator 1",
              state: "working",
              role: "Street access",
            }),
          ],
        }),
      ]),
    });
    expect(status.advisories).toMatchObject({
      state: "current",
      checkedAt,
      sourceUpdatedAt: null,
      sourceUrl: ACCESSIBILITY_ADVISORY_SOURCE_URL,
      count: 1,
      items: [
        {
          title: "Elevator entrance change",
          affectedRoutes: ["J"],
          affectedStops: ["Church Street"],
          publicUrl:
            "https://www.sfmta.com/travel-updates/accessibility-change-1",
        },
      ],
    });
    expect(status.relocations.items[0]).toEqual({
      stopName: "Market Street & 5th",
      routeNames: ["5", "5R"],
      temporaryStop: "Market Street & 6th",
      scheduleText: "Aug 20–Aug 30",
      startsAt: new Date("2026-08-20T00:00:00.000Z"),
      endsAt: new Date("2026-08-30T23:59:59.000Z"),
      latitude: 37.783,
      longitude: -122.408,
      publicUrl: STOP_RELOCATION_SOURCE_URL,
      boardingInstruction: "Board at the temporary stop.",
    });
    expect(status.guides.items[0]).toEqual({
      stationName: "Church Street",
      routeNames: ["J"],
      guidance: "Use the elevator entrance.",
      accessibilityState: "unknown",
      reviewed: true,
    });
    expect(status.alerts.items[0]).toEqual({
      header: "J Church service change",
      effect: "DETOUR",
      routeIds: ["J"],
      stopIds: ["12345"],
    });

    const serialized = JSON.stringify(status);
    expect(serialized).not.toMatch(
      /private-(?:advisory|row|entity|agency|trip)|Do not publish|unsafe\.example|collector|fingerprint|applicant|description|entityId|tripId|agencyId/i,
    );
  });

  it("keeps duplicate public station and line guide rows as separate bounded items", async () => {
    const source = guides();
    const duplicate = {
      ...source,
      guides: [...source.guides, { ...source.guides[0]! }],
    };
    const status = await createPublicCitywideStatus(
      reads({ readGuides: async () => duplicate }),
    ).read(at);

    expect(status.guides.count).toBe(2);
    expect(status.guides.items[0]).toEqual(status.guides.items[1]);
  });

  it("keeps a source current when it has no current items", async () => {
    const empty = {
      state: "current" as const,
      checkedAt,
      sourceUpdatedAt: null,
      sourceUrl: ACCESSIBILITY_ADVISORY_SOURCE_URL,
      advisories: [],
    };
    const status = await createPublicCitywideStatus(
      reads({
        readAdvisories: async () => ({
          ...empty,
          sourceUrl:
            ACCESSIBILITY_ADVISORY_SOURCE_URL as typeof ACCESSIBILITY_ADVISORY_SOURCE_URL,
        }),
      }),
    ).read(at);

    expect(status.advisories).toMatchObject({
      state: "current",
      count: 0,
      summary: "No current changes.",
      items: [],
    });
  });

  it.each([
    ["elevators", "readElevators", "elevators"],
    ["advisories", "readAdvisories", "advisories"],
    ["relocations", "readRelocations", "relocations"],
    ["guides", "readGuides", "guides"],
    ["alerts", "readRealtimeAlerts", "alerts"],
  ] as const)(
    "fails a %s source closed when checkedAt is null or invalid",
    async (_name, readName, section) => {
      const source = reads();
      const value = await source[readName](at);
      for (const invalidCheckedAt of [null, new Date("invalid")]) {
        const status = await createPublicCitywideStatus(
          reads({
            [readName]: async () => ({ ...value, checkedAt: invalidCheckedAt }),
          } as Partial<PublicCitywideStatusReads>),
        ).read(at);
        expect(status[section].state).toBe("unavailable");
        expect(status[section].checkedAt).toBeNull();
      }
    },
  );

  it.each([
    ["elevators", "readElevators", "elevators"],
    ["advisories", "readAdvisories", "advisories"],
    ["relocations", "readRelocations", "relocations"],
    ["guides", "readGuides", "guides"],
    ["alerts", "readRealtimeAlerts", "alerts"],
  ] as const)(
    "degrades only the %s source when its read fails",
    async (_name, readName, section) => {
      const status = await createPublicCitywideStatus(
        reads({
          [readName]: async () => {
            throw new Error("private failure");
          },
        }),
      ).read(at);

      expect(status[section].state).toBe("unavailable");
      expect(status[section].checkedAt).toBeNull();
      expect(status[section].sourceUpdatedAt).toBeNull();
      if (section !== "elevators") expect(status[section].items).toEqual([]);
      expect(status.elevators.state).toBe(
        section === "elevators" ? "unavailable" : "current",
      );
      expect(status.advisories.state).toBe(
        section === "advisories" ? "unavailable" : "current",
      );
    },
  );

  it("retains every elevator when the station name matches, but narrows elevator-name matches", async () => {
    const status = await createPublicCitywideStatus(reads()).read(at);
    const firstStation = status.elevators.stations[0]!;
    const expanded = {
      ...status,
      elevators: {
        ...status.elevators,
        stations: status.elevators.stations.map((station, index) =>
          index === 0
            ? {
                ...station,
                elevators: [
                  ...station.elevators,
                  { ...station.elevators[0]!, name: "Platform elevator" },
                ],
              }
            : station,
        ),
      },
    };
    const stationMatch = filterPublicCitywideStatus(expanded, {
      query: firstStation.name,
      type: "elevators",
      state: "all",
    });
    expect(stationMatch.elevators.stations[0]?.elevators).toHaveLength(2);

    const elevatorMatch = filterPublicCitywideStatus(expanded, {
      query: "Platform elevator",
      type: "elevators",
      state: "all",
    });
    expect(elevatorMatch.elevators.stations[0]?.elevators).toHaveLength(1);
    expect(elevatorMatch.elevators.stations[0]?.elevators[0]?.name).toBe(
      "Platform elevator",
    );
  });

  it("preserves the 11-station elevator compatibility view", async () => {
    const status = await createPublicCitywideStatus(reads()).read(at);
    expect(status.elevators.stations).toHaveLength(11);
    expect(status.elevators.stations[0]).toMatchObject({
      slug: "station-1",
      name: "Station 1",
      state: "accessible",
    });
    expect(status.elevators.stations[0]?.elevators[0]).toMatchObject({
      name: "Elevator 1",
      state: "working",
    });
  });
});
