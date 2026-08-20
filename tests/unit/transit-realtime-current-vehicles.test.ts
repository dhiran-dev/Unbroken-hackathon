import { describe, expect, it } from "vitest";

import { createRealtimeTransit } from "../../src/domain/transit/realtime";
import {
  MemoryRealtimeStore,
  staticReferences,
} from "../support/transit-realtime";

const checkedAt = new Date("2026-08-20T12:04:00.000Z");

describe("trusted current vehicle read", () => {
  it("distinguishes a trusted empty vehicle snapshot from unavailable data", async () => {
    const store = new MemoryRealtimeStore(staticReferences());
    store.trusted.set("vehicles", {
      feedType: "vehicles",
      checkedAt,
      sourceUpdatedAt: new Date("2026-08-20T12:03:00.000Z"),
      sourceUrl: "https://511.org/open-data/transit",
      expiresAt: new Date("2026-08-20T12:08:00.000Z"),
      tripUpdates: [],
      vehicles: [],
      alerts: [],
    });
    store.trustedBaselines.set("vehicles", "static-a");

    const realtime = createRealtimeTransit(store);

    await expect(realtime.getCurrentVehicles(checkedAt)).resolves.toMatchObject(
      {
        state: "current",
        vehicles: [],
        checkedAt,
      },
    );
    await expect(
      realtime.getCurrentVehicles(new Date("2026-08-20T12:08:00.001Z")),
    ).resolves.toEqual({ state: "unavailable", vehicles: [] });
  });
});
