import { describe, expect, it } from "vitest";

import {
  createActiveStopMap,
  type ActiveStopMapSnapshot,
  type ActiveStopMapStore,
} from "../../src/domain/transit/stop-map";

const feedHash = "a".repeat(64);

function counts(stops: number) {
  return {
    stops,
    routes: 68,
    trips: 50_690,
    stopTimes: 1_901_119,
    services: 6,
    shapePoints: 45_308,
  };
}

function stop(id: string, index = 0) {
  return {
    id,
    name: `Muni stop ${index}`,
    code: String(index).padStart(5, "0"),
    locationType: 0,
    parentStationId: null,
    latitude: 37.7 + (index % 200) / 10_000,
    longitude: -122.5 + (index % 200) / 10_000,
  };
}

function snapshot(
  overrides: Partial<ActiveStopMapSnapshot> = {},
): ActiveStopMapSnapshot {
  const stops = overrides.stops ?? [stop("STOP-2", 2), stop("STOP-1", 1)];
  return {
    snapshotId: "snapshot-a",
    feedHash,
    counts: counts(stops.length),
    stops,
    ...overrides,
  };
}

function store(value: ActiveStopMapSnapshot | null): ActiveStopMapStore {
  return {
    async getActiveStopSnapshot() {
      return value;
    },
  };
}

describe("ActiveStopMap", () => {
  it("returns every active stop as deterministic individual point features", async () => {
    const stops = Array.from({ length: 3_238 }, (_, index) =>
      stop(`STOP-${String(index).padStart(4, "0")}`, index),
    );
    const map = createActiveStopMap(
      store(snapshot({ stops, counts: counts(3_238) })),
    );

    const result = await map.get();

    expect(result?.feedHash).toBe(feedHash);
    expect(result?.features).toHaveLength(3_238);
    expect(result?.features.map((feature) => feature.id)).toEqual(
      [...result!.features.map((feature) => feature.id)].sort(),
    );
    expect(result?.features[0]).toEqual({
      type: "Feature",
      id: "STOP-0000",
      properties: {
        id: "STOP-0000",
        name: "Muni stop 0",
        code: "00000",
        locationType: 0,
        parentStationId: null,
      },
      geometry: { type: "Point", coordinates: [-122.5, 37.7] },
    });
    expect(new Set(result!.features.map((feature) => feature.id)).size).toBe(
      3_238,
    );
  });

  it.each([
    ["a count contraction", snapshot({ counts: counts(3) })],
    ["duplicate stop IDs", snapshot({ stops: [stop("DUP"), stop("DUP", 1)] })],
    [
      "a non-San Francisco coordinate",
      snapshot({ stops: [{ ...stop("OUT"), latitude: 40 }] }),
    ],
    [
      "a non-finite coordinate",
      snapshot({ stops: [{ ...stop("NAN"), longitude: Number.NaN }] }),
    ],
    [
      "unsafe rider text",
      snapshot({
        stops: [{ ...stop("BAD"), name: "<script>alert(1)</script>" }],
      }),
    ],
    ["an invalid feed hash", snapshot({ feedHash: "A".repeat(64) })],
  ] as const)("fails closed for %s", async (_reason, invalidSnapshot) => {
    await expect(
      createActiveStopMap(store(invalidSnapshot)).get(),
    ).resolves.toBe(null);
  });

  it("fails closed when the active stop store cannot be read", async () => {
    const failingStore: ActiveStopMapStore = {
      async getActiveStopSnapshot() {
        throw new Error("database detail");
      },
    };

    await expect(createActiveStopMap(failingStore).get()).resolves.toBeNull();
  });

  it("does not expose row fields outside the public stop allowlist", async () => {
    const result = await createActiveStopMap(
      store(
        snapshot({
          stops: [
            {
              ...stop("ALLOW", 1),
              description: "private description",
              wheelchairBoarding: 1,
              platformCode: "A",
            } as ActiveStopMapSnapshot["stops"][number],
          ],
          counts: counts(1),
        }),
      ),
    ).get();

    expect(Object.keys(result!.features[0]!.properties!)).toEqual([
      "id",
      "name",
      "code",
      "locationType",
      "parentStationId",
    ]);
  });
});
