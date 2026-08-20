import { describe, expect, it } from "vitest";

import { createRealtimeTransit } from "../../src/domain/transit/realtime";
import { pollRealtimeFeed } from "../../src/server/transit/realtime";
import {
  MemoryRealtimeStore,
  realtimeDependencies,
  staticReferences,
  tripFeed,
} from "../support/transit-realtime";

describe("RealtimeTransit trip updates", () => {
  it("publishes a valid cancellation and delay with source-based freshness", async () => {
    const at = new Date("2026-08-20T12:04:00.000Z");
    const sourceUpdatedAt = new Date("2026-08-20T12:03:00.000Z");
    const store = new MemoryRealtimeStore(staticReferences());
    const result = await pollRealtimeFeed(
      { feedType: "trip_updates", at },
      realtimeDependencies(store, tripFeed(sourceUpdatedAt)),
    );

    expect(result).toEqual({
      status: "accepted",
      feedType: "trip_updates",
      entityCount: 2,
      checkedAt: new Date("2026-08-20T12:04:02.000Z"),
      sourceUpdatedAt,
      expiresAt: new Date("2026-08-20T12:08:00.000Z"),
    });
    const view = await createRealtimeTransit(store).getTripUpdates(
      new Date("2026-08-20T12:04:02.000Z"),
    );
    expect(view).toEqual({
      state: "current",
      checkedAt: new Date("2026-08-20T12:04:02.000Z"),
      sourceUpdatedAt,
      sourceUrl: "https://511.org/open-data/transit",
      updates: [
        {
          updateId:
            "tu:0009764b18199319ae0252a7ac7b358395346eb3410fb23a15400b9d8241ac0b",
          entityId: "cancelled",
          tripId: "TRIP-1",
          routeId: "ROUTE-1",
          scheduleRelationship: "CANCELED",
          stopId: null,
          stopSequence: null,
          arrivalDelaySeconds: null,
          departureDelaySeconds: null,
          arrivalAt: null,
          departureAt: null,
        },
        {
          updateId:
            "tu:15921ac3e9e59b8c5719dd1a6b79c07b497b3fee9c454ce13ab9c4d8a9d55e2d",
          entityId: "delayed",
          tripId: "TRIP-2",
          routeId: "ROUTE-2",
          scheduleRelationship: "SCHEDULED",
          stopId: "STOP-2",
          stopSequence: 2,
          arrivalDelaySeconds: 120,
          departureDelaySeconds: 180,
          arrivalAt: new Date("2026-08-20T12:06:00.000Z"),
          departureAt: new Date("2026-08-20T12:07:00.000Z"),
        },
      ],
    });
  });
});
