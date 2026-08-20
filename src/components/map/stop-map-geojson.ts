import {
  MAX_ACTIVE_STOP_COUNT,
  SF_STOP_MAP_BOUNDS,
  type StopMapFeature,
} from "@/domain/transit/stop-map";

export type PublicStopFeatureCollection = {
  type: "FeatureCollection";
  features: StopMapFeature[];
};

const featureCollectionKeys = "features,type";
const featureKeys = "geometry,id,properties,type";
const geometryKeys = "coordinates,type";
const propertiesKeys = "code,id,locationType,name,parentStationId";

function exactKeys(value: object, expected: string) {
  return Object.keys(value).sort().join(",") === expected;
}

function safeText(value: unknown, maximumLength: number) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength &&
    !/[<>\u0000-\u001f\u007f]/u.test(value)
  );
}

function validCoordinatePair(value: unknown): value is [number, number] {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !value.every(
      (coordinate) =>
        typeof coordinate === "number" && Number.isFinite(coordinate),
    )
  ) {
    return false;
  }
  const [longitude, latitude] = value;
  return (
    longitude >= SF_STOP_MAP_BOUNDS.minimumLongitude &&
    longitude <= SF_STOP_MAP_BOUNDS.maximumLongitude &&
    latitude >= SF_STOP_MAP_BOUNDS.minimumLatitude &&
    latitude <= SF_STOP_MAP_BOUNDS.maximumLatitude
  );
}

export function normalizeStopMapGeoJson(
  value: unknown,
): PublicStopFeatureCollection | null {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !exactKeys(value, featureCollectionKeys)
  ) {
    return null;
  }

  const candidate = value as { features?: unknown; type?: unknown };
  if (
    candidate.type !== "FeatureCollection" ||
    !Array.isArray(candidate.features) ||
    candidate.features.length === 0 ||
    candidate.features.length > MAX_ACTIVE_STOP_COUNT
  ) {
    return null;
  }

  const ids = new Set<string>();
  const features: StopMapFeature[] = [];
  for (const value of candidate.features) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const feature = value as {
      type?: unknown;
      id?: unknown;
      properties?: unknown;
      geometry?: unknown;
    };
    if (
      !exactKeys(value, featureKeys) ||
      feature.type !== "Feature" ||
      typeof feature.id !== "string" ||
      !safeText(feature.id, 160) ||
      ids.has(feature.id)
    ) {
      return null;
    }

    if (
      !feature.properties ||
      typeof feature.properties !== "object" ||
      Array.isArray(feature.properties) ||
      !exactKeys(feature.properties, propertiesKeys)
    ) {
      return null;
    }
    const properties = feature.properties as {
      id?: unknown;
      name?: unknown;
      code?: unknown;
      locationType?: unknown;
      parentStationId?: unknown;
    };
    const locationType = properties.locationType;
    if (
      properties.id !== feature.id ||
      !safeText(properties.name, 240) ||
      (properties.code !== null && !safeText(properties.code, 80)) ||
      typeof locationType !== "number" ||
      !Number.isSafeInteger(locationType) ||
      locationType < 0 ||
      locationType > 4 ||
      (properties.parentStationId !== null &&
        !safeText(properties.parentStationId, 160))
    ) {
      return null;
    }

    if (
      !feature.geometry ||
      typeof feature.geometry !== "object" ||
      Array.isArray(feature.geometry) ||
      !exactKeys(feature.geometry, geometryKeys)
    ) {
      return null;
    }
    const geometry = feature.geometry as {
      type?: unknown;
      coordinates?: unknown;
    };
    if (
      geometry.type !== "Point" ||
      !validCoordinatePair(geometry.coordinates)
    ) {
      return null;
    }

    ids.add(feature.id);
    features.push({
      type: "Feature",
      id: feature.id,
      properties: {
        id: feature.id,
        name: properties.name as string,
        code: properties.code as string | null,
        locationType: locationType as number,
        parentStationId: properties.parentStationId as string | null,
      },
      geometry: {
        type: "Point",
        coordinates: [geometry.coordinates[0], geometry.coordinates[1]],
      },
    });
  }

  return { type: "FeatureCollection", features };
}
