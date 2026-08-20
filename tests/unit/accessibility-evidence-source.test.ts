import { describe, expect, it } from "vitest";

import {
  createTrustedAccessibilityEvidenceSource,
  type TrustedAccessibilityReadDependencies,
} from "../../src/server/journey/accessibility-evidence-source";
import { EVALUATED_AT } from "../support/accessibility-evidence";

function dependencies(): TrustedAccessibilityReadDependencies {
  return {
    async readElevators() {
      return {
        checkedAt: new Date("2026-08-20T11:59:00.000Z"),
        accessibility: {
          trust: {
            state: "current",
            sourceValidAt: new Date("2026-08-20T11:58:00.000Z"),
            ageSeconds: 120,
          },
          counts: {
            accessible: 1,
            limited: 0,
            unavailable: 0,
            unknown: 0,
          },
          stations: [
            {
              slug: "powell",
              name: "raw station name",
              corridorOrder: 3,
              state: "accessible",
              elevators: [
                {
                  sourceKey: "sfmta:98a3cedeeef224f548f6dd9257fe9ab3",
                  name: "raw elevator name",
                  state: "working",
                  lastChangedAt: null,
                },
              ],
            },
          ],
        },
      };
    },
    async readAdvisories() {
      return {
        state: "older",
        checkedAt: new Date("2026-08-20T10:00:00.000Z"),
        sourceUpdatedAt: null,
        sourceUrl:
          "https://www.sfmta.com/travel-transit-updates?field_transit_type_disrupted_value=Accessibility",
        advisories: [
          {
            advisoryId: "advisory-1",
            title: "raw source title",
            description: "raw source description",
            affectedStops: ["Powell Street (#15417)"],
            affectedRoutes: ["N Judah"],
            startsAt: null,
            endsAt: null,
            publicUrl: "https://www.sfmta.com/travel-updates/example",
          },
        ],
      };
    },
    async readRelocations() {
      return {
        state: "current",
        checkedAt: new Date("2026-08-20T11:55:00.000Z"),
        sourceUpdatedAt: new Date("2026-08-20T11:50:00.000Z"),
        sourceUrl:
          "https://www.sfmta.com/travel-updates/temporary-stop-relocations",
        relocations: [
          {
            stopId: "15417",
            stopName: "raw stop name",
            routeNames: ["Inbound: N"],
            temporaryStop: "Market Street near Fifth Street",
            scheduleText: "raw schedule",
            startsAt: new Date("2026-08-20T11:00:00.000Z"),
            endsAt: new Date("2026-08-20T13:00:00.000Z"),
            latitude: null,
            longitude: null,
            publicUrl:
              "https://www.sfmta.com/travel-updates/temporary-stop-relocations",
            boardingInstruction: "Board at Market Street near Fifth Street.",
          },
        ],
      };
    },
    async resolveRelocations() {
      return [
        {
          relocationId: "relocation:resolved-row-1",
          stopId: "15417",
          routeIds: ["ROUTE-N"],
          temporaryStop: "Market Street near Fifth Street",
          boardingInstruction: "Board at Market Street near Fifth Street.",
          startsAt: new Date("2026-08-20T11:00:00.000Z"),
          endsAt: new Date("2026-08-20T13:00:00.000Z"),
        },
      ];
    },
    async readGuides() {
      return {
        state: "current",
        checkedAt: new Date("2026-08-20T11:00:00.000Z"),
        sourceUpdatedAt: null,
        sourceUrl:
          "https://www.sfmta.com/getting-around/sfmta-accessibility/muni-access-guide/access-muni-metro/muni-metro-accessible-stops",
        guides: [],
      };
    },
    realtimeStore: {
      async getTrustedSnapshot(feedType) {
        if (feedType === "trip_updates") {
          return {
            feedType,
            checkedAt: new Date("2026-08-20T11:59:00.000Z"),
            sourceUpdatedAt: new Date("2026-08-20T11:58:30.000Z"),
            sourceUrl: "https://511.org/open-data/transit",
            expiresAt: new Date("2026-08-20T12:04:00.000Z"),
            tripUpdates: [
              {
                updateId: "update-1",
                entityId: "entity-1",
                tripId: "TRIP-N-1",
                routeId: "ROUTE-N",
                scheduleRelationship: "SCHEDULED",
                stopId: "15417",
                stopSequence: 1,
                arrivalDelaySeconds: 120,
                departureDelaySeconds: 180,
                arrivalAt: null,
                departureAt: null,
              },
            ],
            vehicles: [],
            alerts: [],
          };
        }
        if (feedType === "alerts") {
          return {
            feedType,
            checkedAt: new Date("2026-08-20T11:59:00.000Z"),
            sourceUpdatedAt: new Date("2026-08-20T11:58:30.000Z"),
            sourceUrl: "https://511.org/open-data/transit",
            expiresAt: new Date("2026-08-20T12:09:00.000Z"),
            tripUpdates: [],
            vehicles: [],
            alerts: [
              {
                entityId: "alert-1",
                cause: "CONSTRUCTION",
                effect: "DETOUR",
                header: "raw alert title",
                description: "raw alert description",
                url: "https://www.sfmta.com/travel-updates/raw",
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
            ],
          };
        }
        return null;
      },
    },
  };
}

describe("trusted accessibility evidence source", () => {
  it("adapts only safe exact evidence and never carries source text into the evaluator port", async () => {
    const snapshot =
      await createTrustedAccessibilityEvidenceSource(dependencies()).read(
        EVALUATED_AT,
      );

    expect(snapshot).toMatchObject({
      elevators: {
        state: "current",
        stations: [
          {
            stationId: "powell",
            elevators: [
              {
                equipmentId: "sfmta:98a3cedeeef224f548f6dd9257fe9ab3",
                state: "working",
              },
            ],
          },
        ],
      },
      advisories: { state: "older", advisories: [] },
      relocations: {
        state: "current",
        relocations: [
          {
            relocationId: "relocation:resolved-row-1",
            stopId: "15417",
            temporaryStop: "Market Street near Fifth Street",
            boardingInstruction: "Board at Market Street near Fifth Street.",
          },
        ],
      },
      tripUpdates: {
        state: "current",
        updates: [
          {
            updateId: "update-1",
            tripId: "TRIP-N-1",
            routeId: "ROUTE-N",
          },
        ],
      },
      alerts: {
        state: "current",
        alerts: [
          {
            alertId: "alert-1",
            effect: "DETOUR",
          },
        ],
      },
    });
    expect(JSON.stringify(snapshot)).not.toContain("raw ");
    expect(JSON.stringify(snapshot)).not.toContain("applicant");
  });

  it.each([
    ["unsafe temporary stop", { temporaryStop: "<b>unsafe</b>" }],
    [
      "unsafe boarding instruction",
      { boardingInstruction: "Board here.\nprivate detail" },
    ],
  ])("fails relocation detail closed for %s", async (_name, unsafe) => {
    const reads = dependencies();
    const resolved = await reads.resolveRelocations!(
      await reads.readRelocations(EVALUATED_AT),
    );
    reads.resolveRelocations = async () => [{ ...resolved![0]!, ...unsafe }];

    const snapshot =
      await createTrustedAccessibilityEvidenceSource(reads).read(EVALUATED_AT);

    expect(snapshot.relocations).toEqual({
      state: "unavailable",
      checkedAt: null,
      sourceUpdatedAt: null,
      sourceUrl:
        "https://www.sfmta.com/travel-updates/temporary-stop-relocations",
      relocations: [],
    });
    expect(JSON.stringify(snapshot)).not.toContain("private detail");
  });

  it("fails a current advisory source closed until an exact resolver is injected", async () => {
    const reads = dependencies();
    const advisory = await reads.readAdvisories(EVALUATED_AT);
    reads.readAdvisories = async () => ({
      ...advisory,
      state: "current",
    });

    const snapshot =
      await createTrustedAccessibilityEvidenceSource(reads).read(EVALUATED_AT);

    expect(snapshot.advisories).toMatchObject({
      state: "unavailable",
      advisories: [],
    });
  });

  it("accepts only exact IDs returned by an injected advisory resolver", async () => {
    const reads = dependencies();
    const advisory = await reads.readAdvisories(EVALUATED_AT);
    reads.readAdvisories = async () => ({
      ...advisory,
      state: "current",
    });
    reads.resolveAdvisories = async () => [
      {
        advisoryId: "advisory-1",
        stopIds: ["15417"],
        routeIds: ["ROUTE-N"],
        startsAt: null,
        endsAt: null,
      },
    ];

    const snapshot =
      await createTrustedAccessibilityEvidenceSource(reads).read(EVALUATED_AT);

    expect(snapshot.advisories).toMatchObject({
      state: "current",
      advisories: [
        {
          advisoryId: "advisory-1",
          stopIds: ["15417"],
          routeIds: ["ROUTE-N"],
        },
      ],
    });
  });

  it.each([
    "readElevators",
    "readAdvisories",
    "readRelocations",
    "readGuides",
  ] as const)(
    "isolates a %s failure without weakening other source states",
    async (method) => {
      const reads = dependencies();
      reads[method] = async () => {
        throw new Error("private adapter failure");
      };

      const snapshot =
        await createTrustedAccessibilityEvidenceSource(reads).read(
          EVALUATED_AT,
        );

      const key = {
        readElevators: "elevators",
        readAdvisories: "advisories",
        readRelocations: "relocations",
        readGuides: "guides",
      }[method] as "elevators" | "advisories" | "relocations" | "guides";
      expect(snapshot[key].state).toBe("unavailable");
      expect(snapshot.tripUpdates.state).toBe("current");
      expect(snapshot.alerts.state).toBe("current");
      expect(JSON.stringify(snapshot)).not.toContain("private adapter");
    },
  );

  it("isolates each missing realtime snapshot independently", async () => {
    const reads = dependencies();
    reads.realtimeStore = {
      async getTrustedSnapshot(feedType, at) {
        if (feedType === "alerts") {
          return dependencies().realtimeStore.getTrustedSnapshot(feedType, at);
        }
        return null;
      },
    };

    const snapshot =
      await createTrustedAccessibilityEvidenceSource(reads).read(EVALUATED_AT);

    expect(snapshot.tripUpdates.state).toBe("unavailable");
    expect(snapshot.alerts.state).toBe("current");
  });
});
