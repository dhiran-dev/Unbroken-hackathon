import type { GtfsCoverageCounts } from "./gtfs-validation";

export const MAX_ACTIVE_STOP_COUNT = 10_000;
export const MAX_STOP_MAP_BYTES = 2_000_000;

export const SF_STOP_MAP_BOUNDS = {
  minimumLatitude: 37.6,
  maximumLatitude: 37.95,
  minimumLongitude: -122.65,
  maximumLongitude: -122.25,
} as const;

export const STOP_MAP_UNAVAILABLE_MESSAGE =
  "Map is unavailable. Use the trip steps instead.";

export type ActiveStopMapStop = {
  id: string;
  name: string;
  code: string | null;
  locationType: number;
  parentStationId: string | null;
  latitude: number;
  longitude: number;
};

export type ActiveStopMapSnapshot = {
  snapshotId: string;
  feedHash: string;
  counts: GtfsCoverageCounts;
  stops: readonly ActiveStopMapStop[];
};

export type StopMapProperties = {
  id: string;
  name: string;
  code: string | null;
  locationType: number;
  parentStationId: string | null;
};

export type StopMapFeature = {
  type: "Feature";
  id: string;
  properties: StopMapProperties;
  geometry: {
    type: "Point";
    coordinates: [longitude: number, latitude: number];
  };
};

export type ActiveStopMapResult = {
  snapshotId: string;
  feedHash: string;
  features: StopMapFeature[];
};

export interface ActiveStopMapStore {
  getActiveStopSnapshot(): Promise<ActiveStopMapSnapshot | null>;
}

export interface ActiveStopMap {
  get(): Promise<ActiveStopMapResult | null>;
}

const FEED_HASH_PATTERN = /^[0-9a-f]{64}$/u;
const SNAPSHOT_ID_PATTERN = /^[^\s<>\u0000-\u001f\u007f]{1,160}$/u;

function safeText(value: unknown, maximumLength: number) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength &&
    !/[<>\u0000-\u001f\u007f]/u.test(value)
  );
}

function nullableSafeText(value: unknown, maximumLength: number) {
  return value === null || safeText(value, maximumLength);
}

function validCoordinate(latitude: unknown, longitude: unknown) {
  return (
    typeof latitude === "number" &&
    typeof longitude === "number" &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= SF_STOP_MAP_BOUNDS.minimumLatitude &&
    latitude <= SF_STOP_MAP_BOUNDS.maximumLatitude &&
    longitude >= SF_STOP_MAP_BOUNDS.minimumLongitude &&
    longitude <= SF_STOP_MAP_BOUNDS.maximumLongitude
  );
}

function validCounts(value: unknown): value is GtfsCoverageCounts {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<GtfsCoverageCounts>;
  return (
    [
      "stops",
      "routes",
      "trips",
      "stopTimes",
      "services",
      "shapePoints",
    ] as const
  ).every((key) => {
    const count = candidate[key];
    return Number.isSafeInteger(count) && Number(count) >= 0;
  });
}

function validStop(value: unknown): value is ActiveStopMapStop {
  if (!value || typeof value !== "object") return false;
  const stop = value as Partial<ActiveStopMapStop>;
  return (
    safeText(stop.id, 160) &&
    safeText(stop.name, 240) &&
    nullableSafeText(stop.code, 80) &&
    Number.isSafeInteger(stop.locationType) &&
    Number(stop.locationType) >= 0 &&
    Number(stop.locationType) <= 4 &&
    nullableSafeText(stop.parentStationId, 160) &&
    validCoordinate(stop.latitude, stop.longitude)
  );
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function isValidActiveStopMapSnapshot(
  value: unknown,
): value is ActiveStopMapSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<ActiveStopMapSnapshot>;
  if (typeof snapshot.snapshotId !== "string") return false;
  if (
    !safeText(snapshot.snapshotId, 160) ||
    !SNAPSHOT_ID_PATTERN.test(snapshot.snapshotId) ||
    typeof snapshot.feedHash !== "string" ||
    !FEED_HASH_PATTERN.test(snapshot.feedHash) ||
    !validCounts(snapshot.counts) ||
    !Array.isArray(snapshot.stops) ||
    snapshot.stops.length === 0 ||
    snapshot.stops.length > MAX_ACTIVE_STOP_COUNT ||
    snapshot.counts.stops !== snapshot.stops.length
  ) {
    return false;
  }

  const ids = new Set<string>();
  for (const stop of snapshot.stops) {
    if (!validStop(stop) || ids.has(stop.id)) return false;
    ids.add(stop.id);
  }
  return true;
}

function featureFor(stop: ActiveStopMapStop): StopMapFeature {
  return {
    type: "Feature",
    id: stop.id,
    properties: {
      id: stop.id,
      name: stop.name,
      code: stop.code,
      locationType: stop.locationType,
      parentStationId: stop.parentStationId,
    },
    geometry: {
      type: "Point",
      coordinates: [stop.longitude, stop.latitude],
    },
  };
}

function validResult(value: ActiveStopMapResult) {
  return (
    FEED_HASH_PATTERN.test(value.feedHash) &&
    safeText(value.snapshotId, 160) &&
    value.features.length > 0 &&
    value.features.length <= MAX_ACTIVE_STOP_COUNT
  );
}

export function createActiveStopMap(store: ActiveStopMapStore): ActiveStopMap {
  return {
    async get() {
      let snapshot: ActiveStopMapSnapshot | null;
      try {
        snapshot = await store.getActiveStopSnapshot();
      } catch {
        return null;
      }
      if (!isValidActiveStopMapSnapshot(snapshot)) return null;

      const features = [...snapshot.stops]
        .sort((left, right) => compareText(left.id, right.id))
        .map(featureFor);
      const result = {
        snapshotId: snapshot.snapshotId,
        feedHash: snapshot.feedHash,
        features,
      } satisfies ActiveStopMapResult;
      return validResult(result) ? result : null;
    },
  };
}

export function isStopMapFeedHash(value: string) {
  return FEED_HASH_PATTERN.test(value);
}

export function toStopMapFeatureCollection(result: ActiveStopMapResult) {
  return {
    type: "FeatureCollection" as const,
    features: [...result.features]
      .sort((left, right) =>
        left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
      )
      .map((feature) => ({
        type: "Feature" as const,
        id: feature.id,
        properties: {
          id: feature.properties.id,
          name: feature.properties.name,
          code: feature.properties.code,
          locationType: feature.properties.locationType,
          parentStationId: feature.properties.parentStationId,
        },
        geometry: {
          type: "Point" as const,
          coordinates: [
            feature.geometry.coordinates[0],
            feature.geometry.coordinates[1],
          ] as [number, number],
        },
      })),
  };
}
