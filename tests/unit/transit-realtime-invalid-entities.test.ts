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
} from "../support/transit-realtime";

const at = new Date("2026-08-20T12:04:00.000Z");
const sourceUpdatedAt = new Date("2026-08-20T12:03:00.000Z");

describe("realtime entity validation", () => {
  it("rejects the whole vehicle feed for reference, position, motion, time, or optional-text failures", async () => {
    const store = new MemoryRealtimeStore(staticReferences());
    const feed: RawRealtimeFeed = {
      headerTimestamp: sourceUpdatedAt.getTime() / 1000,
      entities: [
        {
          kind: "vehicle",
          entityId: "bad-vehicle",
          vehicleId: "<private>",
          label: "<unsafe>",
          tripId: "TRIP-1",
          routeId: "ROUTE-2",
          stopId: "MISSING",
          currentStopSequence: -1,
          latitude: 0,
          longitude: 0,
          bearing: 360,
          speedMetersPerSecond: 51,
          observedTimestamp: Date.parse("2026-08-20T11:00:00.000Z") / 1000,
        },
      ],
    };
    const result = await pollRealtimeFeed(
      { feedType: "vehicles", at },
      realtimeDependencies(store, feed),
    );

    expect(result).toMatchObject({ status: "rejected" });
    expect((result as { reasons: PollReasonCode[] }).reasons).toEqual(
      expect.arrayContaining([
        "INVALID_BEARING",
        "INVALID_ENTITY",
        "INVALID_EVENT_TIME",
        "INVALID_POSITION",
        "INVALID_SPEED",
        "ROUTE_MISMATCH",
        "UNKNOWN_STOP",
      ]),
    );
    await expect(
      createRealtimeTransit(store, () => at).getVehicles(),
    ).resolves.toEqual([]);
  });

  it("rejects the whole alert feed for period, text, URL, and informed-entity failures", async () => {
    const store = new MemoryRealtimeStore(staticReferences());
    const feed: RawRealtimeFeed = {
      headerTimestamp: sourceUpdatedAt.getTime() / 1000,
      entities: [
        {
          kind: "alert",
          entityId: "bad-alert",
          header: "<b>Unsafe</b>",
          description: "x".repeat(4_001),
          url: "https://example.com/official-looking",
          activePeriods: [{ start: 20, end: 10 }],
          informedEntities: [
            {
              agencyId: "OTHER",
              routeId: "MISSING",
              tripId: "MISSING",
              stopId: "MISSING",
            },
          ],
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
    const result = await pollRealtimeFeed(
      { feedType: "alerts", at },
      dependencies,
    );

    expect(result).toMatchObject({ status: "rejected" });
    expect((result as { reasons: PollReasonCode[] }).reasons).toEqual(
      expect.arrayContaining([
        "INVALID_ACTIVE_PERIOD",
        "INVALID_INFORMED_ENTITY",
        "INVALID_TEXT",
        "INVALID_URL",
        "UNKNOWN_ROUTE",
        "UNKNOWN_STOP",
        "UNKNOWN_TRIP",
      ]),
    );
    await expect(createRealtimeTransit(store).getAlerts(at)).resolves.toEqual(
      [],
    );
  });
});
