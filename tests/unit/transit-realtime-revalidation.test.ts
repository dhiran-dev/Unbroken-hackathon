import { describe, expect, it } from "vitest";

import { createRealtimeTransit } from "../../src/domain/transit/realtime";
import { pollRealtimeFeed } from "../../src/server/transit/realtime";
import {
  MemoryRealtimeStore,
  realtimeDependencies,
  staticReferences,
  tripFeed,
} from "../support/transit-realtime";

describe("trusted realtime revalidation", () => {
  it("revalidates unchanged semantic content with distinct checked and source times", async () => {
    const firstAt = new Date("2026-08-20T12:04:00.000Z");
    const store = new MemoryRealtimeStore(staticReferences());
    await pollRealtimeFeed(
      { feedType: "trip_updates", at: firstAt },
      realtimeDependencies(
        store,
        tripFeed(new Date("2026-08-20T12:03:00.000Z")),
      ),
    );

    const secondAt = new Date("2026-08-20T12:06:30.000Z");
    const secondSourceAt = new Date("2026-08-20T12:05:30.000Z");
    const second = realtimeDependencies(store, tripFeed(secondSourceAt));
    second.source.load = async () => ({
      body: new Uint8Array([1]),
      bodyBytes: 1,
      contentType: "application/x-protobuf",
      checkedAt: new Date("2026-08-20T12:06:32.000Z"),
    });
    await expect(
      pollRealtimeFeed({ feedType: "trip_updates", at: secondAt }, second),
    ).resolves.toMatchObject({ status: "accepted", entityCount: 2 });

    const view = await createRealtimeTransit(store).getTripUpdates(
      new Date("2026-08-20T12:06:32.000Z"),
    );
    expect(view).toMatchObject({
      state: "current",
      checkedAt: new Date("2026-08-20T12:06:32.000Z"),
      sourceUpdatedAt: secondSourceAt,
    });
    expect(view.updates).toHaveLength(2);
  });
});
