import type { GtfsCoverageCounts } from "./gtfs-validation";

export type PlaceType = "stop" | "station" | "landmark";

export type PlaceChoice = {
  id: string;
  type: PlaceType;
  name: string;
  description: string;
  latitude: number;
  longitude: number;
  stopIds: string[];
  routeNames: string[];
};

export type PlaceSearch = {
  query: string;
  latitude?: number;
  longitude?: number;
};

export type CatalogPlaceRef = { placeId: string };

export type TransitCoverage =
  | { available: false }
  | {
      available: true;
      snapshotId: string;
      feedHash: string;
      counts: GtfsCoverageCounts;
    };

export type CatalogStop = {
  stopId: string;
  stopCode: string | null;
  name: string;
  latitude: number;
  longitude: number;
  locationType: number;
  parentStationId: string | null;
  routeNames: string[];
};

export type CatalogLandmark = {
  id: string;
  name: string;
  description: string;
  latitude: number;
  longitude: number;
  aliases: string[];
  stopIds: string[];
};

export type CatalogSnapshot = {
  snapshotId: string;
  stops: CatalogStop[];
  landmarks: CatalogLandmark[];
};

export type CatalogIdentity = {
  snapshotId: string;
  landmarkRevision: string;
};

export interface TransitCatalogStore {
  getActiveCatalogIdentity(): Promise<CatalogIdentity | null>;
  loadSnapshot(snapshotId: string): Promise<CatalogSnapshot | null>;
  getCoverage(): Promise<TransitCoverage>;
}

export interface TransitCatalog {
  searchPlaces(input: PlaceSearch): Promise<PlaceChoice[]>;
  getPlace(ref: CatalogPlaceRef): Promise<PlaceChoice | null>;
  getCoverage(): Promise<TransitCoverage>;
}

type IndexedPlace = PlaceChoice & { searchable: string[] };
type CatalogIndex = CatalogIdentity & { places: IndexedPlace[] };

export const MAX_PLACE_QUERY_LENGTH = 120;
export const MAX_PLACES_PER_TYPE = 8;
export const SF_PLACE_BOUNDS = {
  minimumLatitude: 37.6,
  maximumLatitude: 37.95,
  minimumLongitude: -122.65,
  maximumLongitude: -122.25,
} as const;
const PLACE_REF =
  /^(stop|station|landmark):([^\s<>\u0000-\u001f\u007f]{1,160})$/;

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalized(value: string) {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/\s+/g, " ")
    .trim();
}

function safeText(value: string, maximumLength: number) {
  return (
    value.length > 0 &&
    value.length <= maximumLength &&
    !/[<>\u0000-\u001f\u007f]/u.test(value)
  );
}

function inSanFrancisco(latitude: number, longitude: number) {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= SF_PLACE_BOUNDS.minimumLatitude &&
    latitude <= SF_PLACE_BOUNDS.maximumLatitude &&
    longitude >= SF_PLACE_BOUNDS.minimumLongitude &&
    longitude <= SF_PLACE_BOUNDS.maximumLongitude
  );
}

function validCoordinates(input: PlaceSearch) {
  const hasLatitude = input.latitude !== undefined;
  const hasLongitude = input.longitude !== undefined;
  return (
    hasLatitude === hasLongitude &&
    (!hasLatitude || inSanFrancisco(input.latitude!, input.longitude!))
  );
}

export function isValidPlaceSearch(input: PlaceSearch) {
  const query = input.query.trim();
  return (
    safeText(query, MAX_PLACE_QUERY_LENGTH) &&
    normalized(query).length > 0 &&
    validCoordinates(input)
  );
}

function uniqueSorted(values: string[]) {
  return [...new Set(values)].sort(compareText);
}

function distanceSquared(
  place: Pick<PlaceChoice, "latitude" | "longitude">,
  input: PlaceSearch,
) {
  if (input.latitude === undefined || input.longitude === undefined) return 0;
  const latitude = (place.latitude - input.latitude) * 111_000;
  const longitude =
    (place.longitude - input.longitude) *
    111_000 *
    Math.cos((input.latitude * Math.PI) / 180);
  return latitude * latitude + longitude * longitude;
}

function matchRank(place: IndexedPlace, query: string) {
  let rank = Number.POSITIVE_INFINITY;
  for (const field of place.searchable) {
    if (field === query) rank = Math.min(rank, 0);
    else if (field.startsWith(query)) rank = Math.min(rank, 1);
    else if (field.includes(query)) rank = Math.min(rank, 2);
  }
  return rank;
}

function toPlaceChoice(place: IndexedPlace): PlaceChoice {
  return {
    id: place.id,
    type: place.type,
    name: place.name,
    description: place.description,
    latitude: place.latitude,
    longitude: place.longitude,
    stopIds: [...place.stopIds],
    routeNames: [...place.routeNames],
  };
}

function buildIndex(
  snapshot: CatalogSnapshot,
  identity: CatalogIdentity,
): CatalogIndex {
  const safeStops = snapshot.stops.filter(
    (stop) =>
      safeText(stop.stopId, 160) &&
      safeText(stop.name, 240) &&
      inSanFrancisco(stop.latitude, stop.longitude) &&
      (stop.stopCode === null || safeText(stop.stopCode, 80)) &&
      stop.routeNames.every((route) => safeText(route, 160)),
  );
  const byId = new Map(safeStops.map((stop) => [stop.stopId, stop]));
  const childrenByParent = new Map<string, CatalogStop[]>();
  for (const stop of safeStops) {
    if (!stop.parentStationId) continue;
    const children = childrenByParent.get(stop.parentStationId) ?? [];
    children.push(stop);
    childrenByParent.set(stop.parentStationId, children);
  }

  const places: IndexedPlace[] = [];
  for (const stop of safeStops) {
    if (stop.locationType === 0) {
      const parent = stop.parentStationId
        ? byId.get(stop.parentStationId)
        : undefined;
      const routeNames = uniqueSorted(stop.routeNames);
      const details = [
        stop.stopCode ? `Stop code ${stop.stopCode}` : null,
        parent?.name ?? null,
        routeNames.length > 0 ? routeNames.join(", ") : null,
      ].filter((value): value is string => value !== null);
      places.push({
        id: `stop:${stop.stopId}`,
        type: "stop",
        name: stop.name,
        description: details.join(" • ") || "Muni stop",
        latitude: stop.latitude,
        longitude: stop.longitude,
        stopIds: [stop.stopId],
        routeNames,
        searchable: [
          stop.name,
          stop.stopCode ?? "",
          parent?.name ?? "",
          parent?.stopCode ?? "",
          ...routeNames,
        ]
          .filter(Boolean)
          .map(normalized),
      });
    } else if (stop.locationType === 1) {
      const children = (childrenByParent.get(stop.stopId) ?? []).filter(
        (child) => child.locationType === 0,
      );
      if (children.length === 0) continue;
      const routeNames = uniqueSorted(
        children.flatMap((child) => child.routeNames),
      );
      places.push({
        id: `station:${stop.stopId}`,
        type: "station",
        name: stop.name,
        description:
          routeNames.length > 0
            ? `Station • ${routeNames.join(", ")}`
            : "Muni station",
        latitude: stop.latitude,
        longitude: stop.longitude,
        stopIds: children.map((child) => child.stopId).sort(compareText),
        routeNames,
        searchable: [
          stop.name,
          stop.stopCode ?? "",
          ...routeNames,
          ...children.flatMap((child) => [child.name, child.stopCode ?? ""]),
        ]
          .filter(Boolean)
          .map(normalized),
      });
    }
  }

  for (const landmark of snapshot.landmarks) {
    if (
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(landmark.id) ||
      !safeText(landmark.name, 160) ||
      !safeText(landmark.description, 280) ||
      !inSanFrancisco(landmark.latitude, landmark.longitude) ||
      !landmark.aliases.every((alias) => safeText(alias, 120)) ||
      !landmark.stopIds.every((stopId) => safeText(stopId, 160))
    ) {
      continue;
    }
    const activeStops = landmark.stopIds
      .map((stopId) => byId.get(stopId))
      .filter(
        (stop): stop is CatalogStop =>
          stop !== undefined && stop.locationType === 0,
      );
    const stopIds = uniqueSorted(activeStops.map((stop) => stop.stopId));
    const routeNames = uniqueSorted(
      activeStops.flatMap((stop) => stop.routeNames),
    );
    places.push({
      id: `landmark:${landmark.id}`,
      type: "landmark",
      name: landmark.name,
      description: landmark.description,
      latitude: landmark.latitude,
      longitude: landmark.longitude,
      stopIds,
      routeNames,
      searchable: [landmark.name, ...landmark.aliases, ...routeNames].map(
        normalized,
      ),
    });
  }
  return { ...identity, places };
}

export function createTransitCatalog(
  store: TransitCatalogStore,
): TransitCatalog {
  let cache: CatalogIndex | null = null;
  let loading: {
    identity: CatalogIdentity;
    promise: Promise<CatalogIndex | null>;
  } | null = null;

  async function currentIndex() {
    const identity = await store.getActiveCatalogIdentity();
    if (!identity) return null;
    if (
      cache?.snapshotId === identity.snapshotId &&
      cache.landmarkRevision === identity.landmarkRevision
    ) {
      return cache;
    }
    if (
      !loading ||
      loading.identity.snapshotId !== identity.snapshotId ||
      loading.identity.landmarkRevision !== identity.landmarkRevision
    ) {
      const promise = (async () => {
        const snapshot = await store.loadSnapshot(identity.snapshotId);
        if (!snapshot || snapshot.snapshotId !== identity.snapshotId) {
          return null;
        }
        const finalIdentity = await store.getActiveCatalogIdentity();
        if (
          finalIdentity?.snapshotId !== identity.snapshotId ||
          finalIdentity.landmarkRevision !== identity.landmarkRevision
        ) {
          return null;
        }
        return buildIndex(snapshot, identity);
      })();
      loading = { identity, promise };
      const clear = () => {
        if (loading?.promise === promise) loading = null;
      };
      void promise.then(clear, clear);
    }
    const loaded = await loading.promise;
    if (loaded) cache = loaded;
    return loaded;
  }

  return {
    async searchPlaces(input) {
      if (!isValidPlaceSearch(input)) return [];
      const query = normalized(input.query);
      const index = await currentIndex();
      if (!index) return [];
      const counts: Record<PlaceType, number> = {
        stop: 0,
        station: 0,
        landmark: 0,
      };
      return index.places
        .map((place) => ({
          place,
          rank: matchRank(place, query),
          distance: distanceSquared(place, input),
        }))
        .filter((candidate) => Number.isFinite(candidate.rank))
        .sort(
          (left, right) =>
            left.rank - right.rank ||
            left.distance - right.distance ||
            compareText(left.place.name, right.place.name) ||
            compareText(left.place.id, right.place.id),
        )
        .filter(({ place }) => {
          counts[place.type] += 1;
          return counts[place.type] <= MAX_PLACES_PER_TYPE;
        })
        .map(({ place }) => toPlaceChoice(place));
    },

    async getPlace(ref) {
      if (!PLACE_REF.test(ref.placeId)) return null;
      const index = await currentIndex();
      if (!index) return null;
      const found = index.places.find((place) => place.id === ref.placeId);
      if (!found) return null;
      return toPlaceChoice(found);
    },

    getCoverage() {
      return store.getCoverage();
    },
  };
}
