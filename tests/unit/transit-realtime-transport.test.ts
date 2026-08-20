import { describe, expect, it } from "vitest";

import { pollRealtimeFeed } from "../../src/server/transit/realtime";
import {
  MemoryRealtimeStore,
  realtimeDependencies,
  staticReferences,
  tripFeed,
} from "../support/transit-realtime";

const at = new Date("2026-08-20T12:04:00.000Z");
const sourceUpdatedAt = new Date("2026-08-20T12:03:00.000Z");

describe("realtime transport evidence", () => {
  it("accepts the official google protobuf content type", async () => {
    const store = new MemoryRealtimeStore(staticReferences());
    const dependencies = realtimeDependencies(store, tripFeed(sourceUpdatedAt));
    dependencies.source.load = async () => ({
      body: new Uint8Array([1]),
      bodyBytes: 1,
      contentType: "application/x-google-protobuf",
      checkedAt: new Date("2026-08-20T12:04:02.000Z"),
    });

    await expect(
      pollRealtimeFeed({ feedType: "trip_updates", at }, dependencies),
    ).resolves.toMatchObject({ status: "accepted" });
  });

  it.each([
    new Date(Number.NaN),
    new Date("2026-08-20T12:03:59.999Z"),
    new Date("2026-08-20T12:04:10.001Z"),
  ])(
    "rejects an implausible response completion time: %s",
    async (checkedAt) => {
      const store = new MemoryRealtimeStore(staticReferences());
      const dependencies = realtimeDependencies(
        store,
        tripFeed(sourceUpdatedAt),
      );
      dependencies.source.load = async () => ({
        body: new Uint8Array([1]),
        bodyBytes: 1,
        contentType: "application/x-protobuf",
        checkedAt,
      });

      await expect(
        pollRealtimeFeed({ feedType: "trip_updates", at }, dependencies),
      ).resolves.toMatchObject({
        status: "rejected",
        reasons: ["INVALID_CHECKED_TIME"],
      });
    },
  );
});
