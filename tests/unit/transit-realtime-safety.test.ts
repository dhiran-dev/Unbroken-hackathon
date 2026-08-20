import { describe, expect, it } from "vitest";

import { createRealtimeTransit } from "../../src/domain/transit/realtime";
import {
  pollRealtimeFeed,
  type PollReasonCode,
  type RawRealtimeFeed,
} from "../../src/server/transit/realtime";
import {
  MemoryRealtimeStore,
  realtimeDependencies,
  staticReferences,
  tripFeed,
} from "../support/transit-realtime";

const at = new Date("2026-08-20T12:04:00.000Z");
const sourceUpdatedAt = new Date("2026-08-20T12:03:00.000Z");

async function rejected(feed: RawRealtimeFeed) {
  const store = new MemoryRealtimeStore(staticReferences());
  return pollRealtimeFeed(
    { feedType: "trip_updates", at },
    realtimeDependencies(store, feed),
  );
}

describe("realtime source safety", () => {
  it.each([
    ["stale header", new Date("2026-08-20T11:58:59.000Z"), "STALE_HEADER"],
    ["future header", new Date("2026-08-20T12:05:03.000Z"), "FUTURE_HEADER"],
  ] as const)("rejects a %s", async (_name, timestamp, reason) => {
    await expect(rejected(tripFeed(timestamp))).resolves.toMatchObject({
      status: "rejected",
      reasons: expect.arrayContaining([reason]),
    });
  });

  it("aggregates duplicate, reference, route, delay, and event-time failures", async () => {
    const feed: RawRealtimeFeed = {
      headerTimestamp: sourceUpdatedAt.getTime() / 1000,
      incrementality: 1,
      entities: [
        {
          kind: "trip_update",
          entityId: "bad",
          tripId: "TRIP-1",
          routeId: "ROUTE-2",
          stopTimeUpdates: [
            {
              stopId: "MISSING",
              stopSequence: -1,
              arrivalDelaySeconds: 21_601,
              departureTime: Date.parse("2026-08-22T12:00:00.000Z") / 1000,
            },
          ],
        },
        {
          kind: "trip_update",
          entityId: "bad",
          tripId: "MISSING",
          routeId: "MISSING",
          scheduleRelationship: "SCHEDULED",
          stopTimeUpdates: [],
        },
      ],
    };
    const result = await rejected(feed);
    expect(result).toMatchObject({ status: "rejected" });
    expect((result as { reasons: PollReasonCode[] }).reasons).toEqual(
      expect.arrayContaining([
        "DIFFERENTIAL_FEED",
        "DUPLICATE_ENTITY",
        "INVALID_DELAY",
        "INVALID_ENTITY",
        "INVALID_EVENT_TIME",
        "ROUTE_MISMATCH",
        "UNKNOWN_ROUTE",
        "UNKNOWN_STOP",
        "UNKNOWN_TRIP",
      ]),
    );
  });

  it("rejects malformed present trip fields and impossible event dates", async () => {
    const feed: RawRealtimeFeed = {
      headerTimestamp: sourceUpdatedAt.getTime() / 1000,
      incrementality: 0,
      entities: [
        {
          kind: "trip_update",
          entityId: "bad-fields",
          tripId: "TRIP-1",
          routeId: " ROUTE-1",
          scheduleRelationship: 7,
          stopTimeUpdates: [
            {
              stopId: "STOP-1",
              stopSequence: 1,
              arrivalTime: Number.MAX_SAFE_INTEGER,
            },
          ],
        },
      ],
    };

    await expect(rejected(feed)).resolves.toMatchObject({
      status: "rejected",
      reasons: expect.arrayContaining(["INVALID_ENTITY", "INVALID_EVENT_TIME"]),
    });
  });

  it("treats decoder failure and oversized bodies as safe rejection evidence", async () => {
    const malformedStore = new MemoryRealtimeStore(staticReferences());
    const malformed = realtimeDependencies(
      malformedStore,
      tripFeed(sourceUpdatedAt),
    );
    malformed.decoder.decode = () => {
      throw new Error("protobuf internals");
    };
    await expect(
      pollRealtimeFeed({ feedType: "trip_updates", at }, malformed),
    ).resolves.toEqual({
      status: "rejected",
      feedType: "trip_updates",
      reasons: ["DECODE_FAILED"],
    });

    const oversizedStore = new MemoryRealtimeStore(staticReferences());
    const oversized = realtimeDependencies(
      oversizedStore,
      tripFeed(sourceUpdatedAt),
    );
    oversized.source.load = async () => ({
      body: new Uint8Array(0),
      bodyBytes: 8 * 1024 * 1024 + 1,
      contentType: "application/x-protobuf",
      checkedAt: new Date("2026-08-20T12:04:02.000Z"),
    });
    await expect(
      pollRealtimeFeed({ feedType: "trip_updates", at }, oversized),
    ).resolves.toMatchObject({
      status: "rejected",
      reasons: ["OVERSIZE_BODY"],
    });
  });

  it("does not expose a trusted snapshot before its collection completes", async () => {
    const store = new MemoryRealtimeStore(staticReferences());
    await pollRealtimeFeed(
      { feedType: "trip_updates", at },
      realtimeDependencies(store, tripFeed(sourceUpdatedAt)),
    );

    await expect(
      createRealtimeTransit(store).getTripUpdates(at),
    ).resolves.toEqual({ state: "unavailable", updates: [] });
    await expect(
      createRealtimeTransit(store).getTripUpdates(
        new Date("2026-08-20T12:04:02.000Z"),
      ),
    ).resolves.toMatchObject({ state: "current" });
  });

  it("retains prior trusted data after rejection, then becomes unavailable at source expiry", async () => {
    const store = new MemoryRealtimeStore(staticReferences());
    await pollRealtimeFeed(
      { feedType: "trip_updates", at },
      realtimeDependencies(store, tripFeed(sourceUpdatedAt)),
    );
    const invalidAt = new Date("2026-08-20T12:06:31.000Z");
    const invalid = tripFeed(new Date("2026-08-20T11:50:00.000Z"));
    const invalidDependencies = realtimeDependencies(store, invalid);
    invalidDependencies.source.load = async () => ({
      body: new Uint8Array([1]),
      bodyBytes: 1,
      contentType: "application/x-protobuf",
      checkedAt: invalidAt,
    });
    expect(
      await pollRealtimeFeed(
        { feedType: "trip_updates", at: invalidAt },
        invalidDependencies,
      ),
    ).toMatchObject({ status: "rejected" });

    const realtime = createRealtimeTransit(store);
    await expect(
      realtime.getTripUpdates(new Date("2026-08-20T12:07:59.000Z")),
    ).resolves.toMatchObject({ state: "current" });
    await expect(
      realtime.getTripUpdates(new Date("2026-08-20T12:08:00.001Z")),
    ).resolves.toEqual({ state: "unavailable", updates: [] });
  });

  it("accepts an empty full feed and rejects a stale static baseline race", async () => {
    const emptyStore = new MemoryRealtimeStore(staticReferences());
    const empty: RawRealtimeFeed = {
      headerTimestamp: sourceUpdatedAt.getTime() / 1000,
      incrementality: 0,
      entities: [],
    };
    expect(
      await pollRealtimeFeed(
        { feedType: "trip_updates", at },
        realtimeDependencies(emptyStore, empty),
      ),
    ).toMatchObject({ status: "accepted", entityCount: 0 });
    await expect(
      createRealtimeTransit(emptyStore).getTripUpdates(
        new Date("2026-08-20T12:04:02.000Z"),
      ),
    ).resolves.toMatchObject({ state: "current", updates: [] });

    const raceStore = new MemoryRealtimeStore(staticReferences("static-a"));
    const raceDependencies = realtimeDependencies(
      raceStore,
      tripFeed(sourceUpdatedAt),
    );
    const oldReferences = raceStore.references;
    raceDependencies.references.load = async () => {
      raceStore.references = staticReferences("static-b");
      return oldReferences;
    };
    await expect(
      pollRealtimeFeed({ feedType: "trip_updates", at }, raceDependencies),
    ).resolves.toEqual({
      status: "rejected",
      feedType: "trip_updates",
      reasons: ["STALE_STATIC_BASELINE"],
    });
  });
});

describe("realtime static snapshot binding", () => {
  it("stops publishing trusted realtime when the active static snapshot changes", async () => {
    const store = new MemoryRealtimeStore(staticReferences("static-a"));
    await pollRealtimeFeed(
      { feedType: "trip_updates", at },
      realtimeDependencies(store, tripFeed(sourceUpdatedAt)),
    );
    store.references = staticReferences("static-b");

    await expect(
      createRealtimeTransit(store).getTripUpdates(at),
    ).resolves.toEqual({
      state: "unavailable",
      updates: [],
    });
  });
});
