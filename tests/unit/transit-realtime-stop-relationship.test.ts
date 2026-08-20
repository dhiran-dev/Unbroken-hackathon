import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { describe, expect, it } from "vitest";

import { createRealtimeTransit } from "../../src/domain/transit/realtime";
import {
  pollRealtimeFeed,
  type RawRealtimeFeed,
} from "../../src/server/transit/realtime";
import { realtimeFeedDecoder } from "../../src/server/transit/realtime-source";
import {
  MemoryRealtimeStore,
  realtimeDependencies,
  staticReferences,
  tripFeed,
} from "../support/transit-realtime";

const at = new Date("2026-08-20T12:04:00.000Z");
const sourceUpdatedAt = new Date("2026-08-20T12:03:00.000Z");

async function persisted(feed: RawRealtimeFeed) {
  const store = new MemoryRealtimeStore(staticReferences());
  const result = await pollRealtimeFeed(
    { feedType: "trip_updates", at },
    realtimeDependencies(store, feed),
  );
  const view = await createRealtimeTransit(store).getTripUpdates(
    new Date("2026-08-20T12:04:02.000Z"),
  );
  return { result, view };
}

describe("GTFS stop schedule relationships", () => {
  it("decodes and persists an exact protobuf SKIPPED stop", async () => {
    const { transit_realtime: realtime } = GtfsRealtimeBindings;
    const body = realtime.FeedMessage.encode({
      header: {
        gtfsRealtimeVersion: "2.0",
        incrementality: realtime.FeedHeader.Incrementality.FULL_DATASET,
        timestamp: sourceUpdatedAt.getTime() / 1000,
      },
      entity: [
        {
          id: "skipped",
          tripUpdate: {
            trip: {
              tripId: "TRIP-1",
              routeId: "ROUTE-1",
              scheduleRelationship:
                realtime.TripDescriptor.ScheduleRelationship.SCHEDULED,
            },
            stopTimeUpdate: [
              {
                stopId: "STOP-1",
                stopSequence: 1,
                scheduleRelationship:
                  realtime.TripUpdate.StopTimeUpdate.ScheduleRelationship
                    .SKIPPED,
              },
            ],
          },
        },
      ],
    }).finish();
    const store = new MemoryRealtimeStore(staticReferences());
    const dependencies = realtimeDependencies(store, tripFeed(sourceUpdatedAt));
    dependencies.decoder = realtimeFeedDecoder;
    dependencies.source.load = async () => ({
      body,
      bodyBytes: body.byteLength,
      contentType: "application/x-google-protobuf",
      checkedAt: new Date("2026-08-20T12:04:02.000Z"),
    });

    await expect(
      pollRealtimeFeed({ feedType: "trip_updates", at }, dependencies),
    ).resolves.toMatchObject({ status: "accepted" });
    await expect(
      createRealtimeTransit(store).getTripUpdates(
        new Date("2026-08-20T12:04:02.000Z"),
      ),
    ).resolves.toMatchObject({
      updates: [{ stopId: "STOP-1", scheduleRelationship: "SKIPPED" }],
    });
  });

  it("rejects a stop relationship outside the fixed allowlist", async () => {
    const feed = tripFeed(sourceUpdatedAt);
    const entity = (feed.entities as Array<Record<string, unknown>>)[1]!;
    const stops = entity.stopTimeUpdates as Array<Record<string, unknown>>;
    stops[0]!.scheduleRelationship = "FUTURE_VALUE";
    await expect(persisted(feed)).resolves.toMatchObject({
      result: {
        status: "rejected",
        reasons: expect.arrayContaining(["INVALID_ENTITY"]),
      },
    });
  });

  it.each(["CANCELED", "DELETED"])(
    "retains trip-level %s over a skipped stop",
    async (relationship) => {
      const feed: RawRealtimeFeed = {
        headerTimestamp: sourceUpdatedAt.getTime() / 1000,
        incrementality: 0,
        entities: [
          {
            kind: "trip_update",
            entityId: `trip-${relationship}`,
            tripId: "TRIP-1",
            routeId: "ROUTE-1",
            scheduleRelationship: relationship,
            stopTimeUpdates: [
              {
                stopId: "STOP-1",
                stopSequence: 1,
                scheduleRelationship: "SKIPPED",
              },
            ],
          },
        ],
      };
      await expect(persisted(feed)).resolves.toMatchObject({
        result: { status: "accepted" },
        view: { updates: [{ scheduleRelationship: relationship }] },
      });
    },
  );
});
