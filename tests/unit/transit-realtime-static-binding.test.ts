import { describe, expect, it } from "vitest";

import { createRealtimeTransit } from "../../src/domain/transit/realtime";
import { pollRealtimeFeed } from "../../src/server/transit/realtime";
import {
  MemoryRealtimeStore,
  realtimeDependencies,
  staticReferences,
  tripFeed,
} from "../support/transit-realtime";

describe("realtime static baseline binding", () => {
  it("stops exposing a trusted realtime snapshot after its static feed is replaced", async () => {
    const at = new Date("2026-08-20T12:04:00.000Z");
    const store = new MemoryRealtimeStore(staticReferences("static-a"));
    await pollRealtimeFeed(
      { feedType: "trip_updates", at },
      realtimeDependencies(
        store,
        tripFeed(new Date("2026-08-20T12:03:00.000Z")),
      ),
    );
    const checkedAt = new Date("2026-08-20T12:04:02.000Z");
    await expect(
      createRealtimeTransit(store).getTripUpdates(checkedAt),
    ).resolves.toMatchObject({
      state: "current",
    });

    store.references = staticReferences("static-b");
    await expect(
      createRealtimeTransit(store).getTripUpdates(checkedAt),
    ).resolves.toEqual({
      state: "unavailable",
      updates: [],
    });
  });
});
