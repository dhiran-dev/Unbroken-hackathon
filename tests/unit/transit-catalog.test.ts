import { describe, expect, it } from "vitest";

import {
  createTransitCatalog,
  type CatalogSnapshot,
} from "../../src/domain/transit/catalog";
import { MemoryTransitCatalogStore } from "../support/transit-catalog";

const coverage = {
  available: true as const,
  snapshotId: "active-a",
  feedHash: "a".repeat(64),
  counts: {
    stops: 3,
    routes: 2,
    trips: 10,
    stopTimes: 20,
    services: 2,
    shapePoints: 30,
  },
};

function snapshot(id = "active-a"): CatalogSnapshot {
  return {
    snapshotId: id,
    stops: [
      {
        stopId: "STATION-24",
        stopCode: null,
        name: "24th Street Mission",
        latitude: 37.7522,
        longitude: -122.4184,
        locationType: 1,
        parentStationId: null,
        routeNames: [],
      },
      {
        stopId: "STOP-24",
        stopCode: "13245",
        name: "Mission Street & 24th Street",
        latitude: 37.7523,
        longitude: -122.4185,
        locationType: 0,
        parentStationId: "STATION-24",
        routeNames: ["14 Mission", "49 Van Ness-Mission"],
      },
      {
        stopId: "STOP-GEARY",
        stopCode: "14567",
        name: "Geary Boulevard & 20th Avenue",
        latitude: 37.7804,
        longitude: -122.4791,
        locationType: 0,
        parentStationId: null,
        routeNames: ["38 Geary"],
      },
    ],
    landmarks: [
      {
        id: "fishermans-wharf",
        name: "Fisherman’s Wharf",
        description: "Fisherman’s Wharf destination point",
        latitude: 37.808,
        longitude: -122.4177,
        aliases: ["Wharf"],
        stopIds: ["STOP-24", "MISSING", "STATION-24"],
      },
    ],
  };
}

describe("TransitCatalog", () => {
  it("searches active stops, stations, and landmarks by rider-recognizable fields", async () => {
    const store = new MemoryTransitCatalogStore(
      "active-a",
      new Map([["active-a", snapshot()]]),
      coverage,
    );
    const catalog = createTransitCatalog(store);

    await expect(catalog.searchPlaces({ query: "13245" })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "stop:STOP-24",
          type: "stop",
          name: "Mission Street & 24th Street",
        }),
      ]),
    );
    await expect(
      catalog.searchPlaces({ query: "38 Geary" }),
    ).resolves.toMatchObject([
      { id: "stop:STOP-GEARY", routeNames: ["38 Geary"] },
    ]);
    await expect(
      catalog.searchPlaces({ query: "24th Street Mission" }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "station:STATION-24",
          stopIds: ["STOP-24"],
        }),
        expect.objectContaining({ id: "stop:STOP-24" }),
      ]),
    );
    await expect(
      catalog.searchPlaces({ query: "Wharf" }),
    ).resolves.toMatchObject([
      {
        id: "landmark:fishermans-wharf",
        type: "landmark",
        stopIds: ["STOP-24"],
        routeNames: ["14 Mission", "49 Van Ness-Mission"],
      },
    ]);
    await expect(
      catalog.searchPlaces({ query: "49 Van Ness" }),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "landmark:fishermans-wharf" }),
      ]),
    );
  });

  it("never treats malformed text or an inactive place reference as selectable", async () => {
    const store = new MemoryTransitCatalogStore(
      "active-a",
      new Map([
        ["active-a", snapshot()],
        ["active-b", { ...snapshot("active-b"), stops: [], landmarks: [] }],
      ]),
      coverage,
    );
    const catalog = createTransitCatalog(store);

    await expect(catalog.searchPlaces({ query: "" })).resolves.toEqual([]);
    await expect(
      catalog.searchPlaces({ query: "x".repeat(121) }),
    ).resolves.toEqual([]);
    await expect(catalog.searchPlaces({ query: "<script>" })).resolves.toEqual(
      [],
    );
    await expect(
      catalog.getPlace({ placeId: "Mission Street & 24th Street" }),
    ).resolves.toBeNull();
    const selected = await catalog.getPlace({ placeId: "stop:STOP-24" });
    expect(selected).toMatchObject({ id: "stop:STOP-24" });
    selected!.stopIds.push("changed");
    selected!.routeNames.splice(0);
    await expect(
      catalog.getPlace({ placeId: "stop:STOP-24" }),
    ).resolves.toMatchObject({
      stopIds: ["STOP-24"],
      routeNames: ["14 Mission", "49 Van Ness-Mission"],
    });
    store.activeSnapshotId = "active-b";
    await expect(
      catalog.getPlace({ placeId: "stop:STOP-24" }),
    ).resolves.toBeNull();
  });

  it("requires a paired finite SF coordinate and uses it only to rank matching places", async () => {
    const store = new MemoryTransitCatalogStore(
      "active-a",
      new Map([["active-a", snapshot()]]),
      coverage,
    );
    const catalog = createTransitCatalog(store);

    await expect(
      catalog.searchPlaces({ query: "Street", latitude: 37.75 }),
    ).resolves.toEqual([]);
    await expect(
      catalog.searchPlaces({
        query: "Street",
        latitude: 91,
        longitude: -122.4,
      }),
    ).resolves.toEqual([]);
    const ranked = await catalog.searchPlaces({
      query: "Street",
      latitude: 37.75225,
      longitude: -122.41845,
    });
    expect(ranked.map((place) => place.id).slice(0, 2)).toEqual([
      "stop:STOP-24",
      "station:STATION-24",
    ]);
  });

  it("caches the route association scan once per active snapshot and always bounds each type to eight", async () => {
    const large = snapshot();
    large.stops = Array.from({ length: 12_000 }, (_, index) => ({
      stopId: `S-${index}`,
      stopCode: String(index),
      name: `Market Stop ${String(index).padStart(5, "0")}`,
      latitude: 37.7 + (index % 100) / 10_000,
      longitude: -122.4,
      locationType: 0,
      parentStationId: null,
      routeNames: ["5 Fulton"],
    }));
    const store = new MemoryTransitCatalogStore(
      "active-a",
      new Map([["active-a", large]]),
      coverage,
    );
    const catalog = createTransitCatalog(store);

    const first = await catalog.searchPlaces({ query: "Market" });
    store.snapshots.clear();
    const second = await catalog.searchPlaces({ query: "Fulton" });
    const warmSamples: number[] = [];
    for (let index = 0; index < 20; index += 1) {
      const started = performance.now();
      await catalog.searchPlaces({ query: "Fulton" });
      warmSamples.push(performance.now() - started);
    }
    warmSamples.sort((left, right) => left - right);
    const p95 = warmSamples[Math.ceil(warmSamples.length * 0.95) - 1]!;

    expect(first).toHaveLength(8);
    expect(p95).toBeLessThan(150);
    expect(second).toHaveLength(8);
    expect(await catalog.getCoverage()).toBe(coverage);
  });

  it("reloads landmarks when their revision changes without a GTFS change", async () => {
    const active = snapshot();
    const store = new MemoryTransitCatalogStore(
      "active-a",
      new Map([["active-a", active]]),
      coverage,
    );
    const catalog = createTransitCatalog(store);

    await expect(
      catalog.searchPlaces({ query: "Wharf" }),
    ).resolves.toHaveLength(1);
    active.landmarks = [
      {
        id: "new-place",
        name: "New Place",
        description: "New destination point",
        latitude: 37.79,
        longitude: -122.4,
        aliases: [],
        stopIds: [],
      },
    ];
    store.landmarkRevision = "landmarks-b";

    await expect(catalog.searchPlaces({ query: "Wharf" })).resolves.toEqual([]);
    await expect(
      catalog.searchPlaces({ query: "New Place" }),
    ).resolves.toMatchObject([{ id: "landmark:new-place" }]);
  });
});
