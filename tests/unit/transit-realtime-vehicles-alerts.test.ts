import { describe, expect, it } from "vitest";

import { createRealtimeTransit } from "../../src/domain/transit/realtime";
import {
  pollRealtimeFeed,
  type RawRealtimeFeed,
} from "../../src/server/transit/realtime";
import {
  MemoryRealtimeStore,
  realtimeDependencies,
  staticReferences,
} from "../support/transit-realtime";

const at = new Date("2026-08-20T12:04:00.000Z");
const sourceUpdatedAt = new Date("2026-08-20T12:03:00.000Z");

describe("RealtimeTransit vehicles and alerts", () => {
  it("publishes valid referenced vehicles and filters them by a safe SF bounds box", async () => {
    const store = new MemoryRealtimeStore(staticReferences());
    const feed: RawRealtimeFeed = {
      headerTimestamp: sourceUpdatedAt.getTime() / 1000,
      incrementality: 0,
      entities: [
        {
          kind: "vehicle",
          entityId: "vehicle-2",
          vehicleId: "V2",
          label: "Coach 2",
          tripId: "TRIP-2",
          routeId: "ROUTE-2",
          stopId: "STOP-2",
          currentStopSequence: 2,
          currentStatus: "IN_TRANSIT_TO",
          latitude: 37.78,
          longitude: -122.41,
          bearing: 90,
          speedMetersPerSecond: 8.5,
          observedTimestamp: sourceUpdatedAt.getTime() / 1000,
        },
        {
          kind: "vehicle",
          entityId: "vehicle-1",
          tripId: "TRIP-1",
          routeId: "ROUTE-1",
          latitude: 37.75,
          longitude: -122.42,
          observedTimestamp: sourceUpdatedAt.getTime() / 1000,
        },
      ],
    };
    const result = await pollRealtimeFeed(
      { feedType: "vehicles", at },
      realtimeDependencies(store, feed),
    );

    expect(result).toMatchObject({ status: "accepted", entityCount: 2 });
    const checkedAt = new Date("2026-08-20T12:04:02.000Z");
    const realtime = createRealtimeTransit(store, () => checkedAt);
    await expect(
      realtime.getVehicles({
        west: -122.43,
        south: 37.74,
        east: -122.415,
        north: 37.76,
      }),
    ).resolves.toMatchObject([
      { entityId: "vehicle-1", bearing: null, speedMetersPerSecond: null },
    ]);
    await expect(
      realtime.getVehicles({
        west: -123,
        south: 37.7,
        east: -122.4,
        north: 37.8,
      }),
    ).resolves.toEqual([]);
  });

  it("publishes sanitized active SF alerts with explicit provenance", async () => {
    const store = new MemoryRealtimeStore(staticReferences());
    const feed: RawRealtimeFeed = {
      headerTimestamp: sourceUpdatedAt.getTime() / 1000,
      entities: [
        {
          kind: "alert",
          entityId: "alert-1",
          cause: "CONSTRUCTION",
          effect: "DETOUR",
          header: " Route 1 detour ",
          description: "Use the signed stop.",
          url: "https://www.sfmta.com/travel-updates/route-1-detour",
          activePeriods: [
            {
              start: Date.parse("2026-08-20T12:00:00.000Z") / 1000,
              end: Date.parse("2026-08-20T13:00:00.000Z") / 1000,
            },
          ],
          informedEntities: [{ agencyId: "SF", routeId: "ROUTE-1" }],
        },
      ],
    };
    const dependencies = realtimeDependencies(store, feed);
    dependencies.source.load = async () => ({
      body: new Uint8Array([123, 125]),
      bodyBytes: 2,
      contentType: "application/json",
      checkedAt: new Date("2026-08-20T12:04:02.000Z"),
    });

    expect(
      await pollRealtimeFeed({ feedType: "alerts", at }, dependencies),
    ).toMatchObject({ status: "accepted", entityCount: 1 });
    await expect(
      createRealtimeTransit(store).getAlerts(
        new Date("2026-08-20T12:04:02.000Z"),
      ),
    ).resolves.toMatchObject([
      {
        entityId: "alert-1",
        header: "Route 1 detour",
        description: "Use the signed stop.",
        informedEntities: [
          { agencyId: "SF", routeId: "ROUTE-1", tripId: null, stopId: null },
        ],
      },
    ]);
  });
});
