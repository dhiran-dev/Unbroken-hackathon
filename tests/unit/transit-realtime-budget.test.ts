import { describe, expect, it } from "vitest";

import {
  pollDueRealtimeFeeds,
  pollRealtimeFeed,
} from "../../src/server/transit/realtime";
import {
  MemoryRealtimeStore,
  realtimeDependencies,
  staticReferences,
  tripFeed,
} from "../support/transit-realtime";

const at = new Date("2026-08-20T12:04:00.000Z");

describe("shared realtime request budget", () => {
  it("atomically admits 52 of 53 concurrent eligible rolling-hour claims", async () => {
    const store = new MemoryRealtimeStore(staticReferences());
    const claims = await Promise.all(
      Array.from({ length: 53 }, () =>
        store.claimPoll({ feedType: "trip_updates", at, cadenceMs: 0 }),
      ),
    );

    expect(claims.filter((claim) => claim.status === "claimed")).toHaveLength(
      52,
    );
    expect(claims.filter((claim) => claim.status === "deferred")).toHaveLength(
      1,
    );
  });

  it("counts failed requests, enforces cadence, and admits work after the rolling window", async () => {
    const store = new MemoryRealtimeStore(staticReferences());
    const firstDependencies = realtimeDependencies(
      store,
      tripFeed(new Date("2026-08-20T12:03:00.000Z")),
    );
    firstDependencies.decoder.decode = () => {
      throw new Error("synthetic decode failure");
    };
    expect(
      await pollRealtimeFeed(
        { feedType: "trip_updates", at },
        firstDependencies,
      ),
    ).toMatchObject({ status: "rejected" });

    expect(
      await pollRealtimeFeed(
        {
          feedType: "trip_updates",
          at: new Date(at.getTime() + 149_999),
        },
        realtimeDependencies(
          store,
          tripFeed(new Date("2026-08-20T12:05:00.000Z")),
        ),
      ),
    ).toEqual({ status: "not_due", feedType: "trip_updates" });

    const rollingStore = new MemoryRealtimeStore(staticReferences());
    await Promise.all(
      Array.from({ length: 52 }, () =>
        rollingStore.claimPoll({ feedType: "alerts", at, cadenceMs: 0 }),
      ),
    );
    await expect(
      rollingStore.claimPoll({
        feedType: "vehicles",
        at: new Date(at.getTime() + 3_599_999),
        cadenceMs: 0,
      }),
    ).resolves.toEqual({ status: "deferred" });
    await expect(
      rollingStore.claimPoll({
        feedType: "vehicles",
        at: new Date(at.getTime() + 3_600_000),
        cadenceMs: 0,
      }),
    ).resolves.toMatchObject({ status: "claimed" });
  });

  it("polls all three due feeds only when the existing data flag is exact true", async () => {
    const disabledStore = new MemoryRealtimeStore(staticReferences());
    const disabled = await pollDueRealtimeFeeds(
      { at },
      {
        ...realtimeDependencies(
          disabledStore,
          tripFeed(new Date("2026-08-20T12:03:00.000Z")),
        ),
        readDataFlag: () => "TRUE",
      },
    );
    expect(disabled).toEqual({ status: "disabled", results: [] });
    expect(disabledStore.claims).toEqual([]);

    const enabledStore = new MemoryRealtimeStore(staticReferences());
    const dependencies = realtimeDependencies(
      enabledStore,
      tripFeed(new Date("2026-08-20T12:03:00.000Z")),
    );
    const enabled = await pollDueRealtimeFeeds(
      { at },
      { ...dependencies, readDataFlag: () => "true" },
    );
    expect(enabled.status).toBe("completed");
    expect(enabled.results.map((result) => result.feedType)).toEqual([
      "trip_updates",
      "vehicles",
      "alerts",
    ]);
  });
});
