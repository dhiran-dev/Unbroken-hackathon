import { describe, expect, it } from "vitest";

import type {
  CurrentVehicleSnapshotView,
  VehicleView,
} from "../../src/domain/transit/realtime";
import {
  createPublicLiveVehicles,
  MAX_LIVE_VEHICLE_FEATURES,
  type LiveVehicleRequest,
} from "../../src/domain/transit/live-vehicles";

const at = new Date("2026-08-20T12:04:00.000Z");

function vehicle(overrides: Partial<VehicleView> = {}): VehicleView {
  return {
    entityId: "entity-1",
    vehicleId: "vehicle-1",
    label: "Bus 1",
    tripId: "trip-1",
    routeId: "ROUTE-1",
    stopId: "stop-1",
    currentStopSequence: 1,
    currentStatus: "IN_TRANSIT_TO",
    latitude: 37.78,
    longitude: -122.42,
    bearing: 90,
    speedMetersPerSecond: 4,
    observedAt: at,
    ...overrides,
  };
}

function current(vehicles: VehicleView[]): CurrentVehicleSnapshotView {
  return {
    state: "current",
    checkedAt: at,
    sourceUpdatedAt: new Date("2026-08-20T12:03:00.000Z"),
    sourceUrl: "https://511.org/open-data/transit",
    vehicles,
  };
}

const request: LiveVehicleRequest = {
  bounds: { west: -122.5, south: 37.7, east: -122.35, north: 37.82 },
  routeIds: ["ROUTE-1"],
};

describe("public live vehicle projection", () => {
  it.each([
    {
      name: "zero-width bounds",
      bounds: { west: -122.42, south: 37.7, east: -122.42, north: 37.82 },
    },
    {
      name: "zero-height bounds",
      bounds: { west: -122.5, south: 37.78, east: -122.35, north: 37.78 },
    },
  ])("fails closed for $name", async ({ bounds }) => {
    let reads = 0;
    const source = {
      getCurrentVehicles: async () => {
        reads += 1;
        return current([]);
      },
    };

    await expect(
      createPublicLiveVehicles(source).read(
        { bounds, routeIds: ["ROUTE-1"] },
        at,
      ),
    ).resolves.toEqual({ state: "unavailable" });
    expect(reads).toBe(0);
  });

  it("fails closed before reading for an invalid request", async () => {
    let reads = 0;
    const source = {
      getCurrentVehicles: async () => {
        reads += 1;
        return current([]);
      },
    };

    await expect(
      createPublicLiveVehicles(source).read(
        { bounds: request.bounds, routeIds: [] },
        at,
      ),
    ).resolves.toEqual({ state: "unavailable" });
    expect(reads).toBe(0);
  });

  it("does not accept a comma inside one domain route ID", async () => {
    let reads = 0;
    const source = {
      getCurrentVehicles: async () => {
        reads += 1;
        return current([]);
      },
    };

    await expect(
      createPublicLiveVehicles(source).read(
        { bounds: request.bounds, routeIds: ["ROUTE-1,ROUTE-2"] },
        at,
      ),
    ).resolves.toEqual({ state: "unavailable" });
    expect(reads).toBe(0);
  });

  it("projects only selected in-bounds vehicles with safe GeoJSON properties", async () => {
    const source = {
      getCurrentVehicles: async () =>
        current([
          vehicle(),
          vehicle({
            entityId: "entity-2",
            routeId: "ROUTE-2",
            latitude: 37.79,
          }),
          vehicle({
            entityId: "entity-3",
            latitude: 37.9,
          }),
        ]),
    };

    await expect(
      createPublicLiveVehicles(source).read(request, at),
    ).resolves.toEqual({
      state: "current",
      features: [
        {
          type: "Feature",
          properties: {
            routeId: "ROUTE-1",
            bearing: 90,
            observedAt: "2026-08-20T12:04:00.000Z",
          },
          geometry: {
            type: "Point",
            coordinates: [-122.42, 37.78],
          },
        },
      ],
    });
  });

  it("keeps unavailable separate from a trusted empty result", async () => {
    const unavailable = {
      getCurrentVehicles: async (): Promise<CurrentVehicleSnapshotView> => ({
        state: "unavailable",
        vehicles: [],
      }),
    };
    const empty = {
      getCurrentVehicles: async () => current([]),
    };

    await expect(
      createPublicLiveVehicles(unavailable).read(request, at),
    ).resolves.toEqual({ state: "unavailable" });
    await expect(
      createPublicLiveVehicles(empty).read(request, at),
    ).resolves.toEqual({ state: "current", features: [] });
  });

  it("drops malformed source fields and deduplicates projected points", async () => {
    const source = {
      getCurrentVehicles: async () =>
        current([
          vehicle(),
          vehicle({ entityId: "entity-2" }),
          vehicle({
            entityId: "entity-3",
            bearing: Number.NaN,
          }),
          vehicle({
            entityId: "entity-4",
            observedAt: new Date("invalid"),
          }),
        ]),
    };

    await expect(
      createPublicLiveVehicles(source).read(request, at),
    ).resolves.toEqual({
      state: "current",
      features: [
        {
          type: "Feature",
          properties: {
            routeId: "ROUTE-1",
            bearing: 90,
            observedAt: "2026-08-20T12:04:00.000Z",
          },
          geometry: {
            type: "Point",
            coordinates: [-122.42, 37.78],
          },
        },
      ],
    });
  });

  it("caps a valid public result deterministically", async () => {
    const source = {
      getCurrentVehicles: async () =>
        current(
          Array.from({ length: MAX_LIVE_VEHICLE_FEATURES + 3 }, (_, index) =>
            vehicle({
              entityId: `entity-${index}`,
              latitude: 37.7 + index / 100_000,
              longitude: -122.5 + index / 100_000,
            }),
          ),
        ),
    };

    const result = await createPublicLiveVehicles(source).read(request, at);
    expect(result.state).toBe("current");
    if (result.state === "current") {
      expect(result.features).toHaveLength(MAX_LIVE_VEHICLE_FEATURES);
    }
  });
});
