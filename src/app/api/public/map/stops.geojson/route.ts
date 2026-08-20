import {
  MAX_ACTIVE_STOP_COUNT,
  MAX_STOP_MAP_BYTES,
  SF_STOP_MAP_BOUNDS,
  STOP_MAP_UNAVAILABLE_MESSAGE,
  type ActiveStopMap,
  type ActiveStopMapResult,
  isStopMapFeedHash,
  toStopMapFeatureCollection,
} from "@/domain/transit/stop-map";

export const dynamic = "force-dynamic";

const versionPattern = /^[0-9a-f]{64}$/u;
const immutableCache = "public, max-age=31536000, immutable";
const noStoreCache = "no-store, max-age=0";
const invalidVersionResponse = {
  available: false,
  code: "STOP_MAP_VERSION_INVALID",
  message: "Map version is invalid.",
} as const;
const versionUnavailableResponse = {
  available: false,
  code: "STOP_MAP_VERSION_UNAVAILABLE",
  message: "This map version is no longer available.",
} as const;
const unavailableResponse = {
  available: false,
  code: "STOP_MAP_UNAVAILABLE",
  message: STOP_MAP_UNAVAILABLE_MESSAGE,
} as const;

export type StopsGeoJsonRouteDependencies = {
  getMap: () => ActiveStopMap | Promise<ActiveStopMap>;
  readPlannerFlag?: () => string | undefined;
};

function json(
  body: unknown,
  status: number,
  extraHeaders: Record<string, string> = {},
) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": noStoreCache, ...extraHeaders },
  });
}

function parseVersion(request: Request) {
  const values = new URL(request.url).searchParams.getAll("v");
  const version = values.length === 1 ? values[0] : undefined;
  return version && versionPattern.test(version) ? version : null;
}

function safePublicText(value: unknown, maximumLength: number) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength &&
    !/[<>\u0000-\u001f\u007f]/u.test(value)
  );
}

function validPublicResult(result: ActiveStopMapResult) {
  if (
    !result ||
    typeof result !== "object" ||
    typeof result.snapshotId !== "string" ||
    !safePublicText(result.snapshotId, 160) ||
    typeof result.feedHash !== "string" ||
    !isStopMapFeedHash(result.feedHash) ||
    !Array.isArray(result.features)
  ) {
    return false;
  }
  if (
    result.features.length === 0 ||
    result.features.length > MAX_ACTIVE_STOP_COUNT
  ) {
    return false;
  }
  const ids = new Set<string>();
  return result.features.every((feature) => {
    if (!feature || typeof feature !== "object") return false;
    const properties = feature.properties;
    if (!properties || typeof properties !== "object") return false;
    const geometry = feature.geometry;
    const coordinates = geometry?.coordinates;
    if (
      feature.type !== "Feature" ||
      typeof feature.id !== "string" ||
      ids.has(feature.id) ||
      feature.id !== properties?.id ||
      !safePublicText(feature.id, 160) ||
      !safePublicText(properties?.name, 240) ||
      (properties.code !== null && !safePublicText(properties.code, 80)) ||
      !Number.isSafeInteger(properties.locationType) ||
      properties.locationType < 0 ||
      properties.locationType > 4 ||
      (properties.parentStationId !== null &&
        !safePublicText(properties.parentStationId, 160)) ||
      geometry?.type !== "Point" ||
      !Array.isArray(coordinates) ||
      coordinates.length !== 2 ||
      !coordinates.every(
        (coordinate) =>
          typeof coordinate === "number" && Number.isFinite(coordinate),
      ) ||
      coordinates[1] < SF_STOP_MAP_BOUNDS.minimumLatitude ||
      coordinates[1] > SF_STOP_MAP_BOUNDS.maximumLatitude ||
      coordinates[0] < SF_STOP_MAP_BOUNDS.minimumLongitude ||
      coordinates[0] > SF_STOP_MAP_BOUNDS.maximumLongitude ||
      Object.keys(properties).sort().join(",") !==
        "code,id,locationType,name,parentStationId"
    ) {
      return false;
    }
    ids.add(feature.id);
    return true;
  });
}

function immutableHeaders(feedHash: string) {
  return {
    "Cache-Control": immutableCache,
    "Content-Type": "application/geo+json",
    ETag: `"${feedHash}"`,
    Vary: "Accept-Encoding",
  };
}

export function createStopsGeoJsonGet(
  dependencies: StopsGeoJsonRouteDependencies,
) {
  return async function GET(request: Request) {
    if (dependencies.readPlannerFlag?.() !== "true") {
      return json(unavailableResponse, 503);
    }

    const version = parseVersion(request);
    if (!version) return json(invalidVersionResponse, 400);

    let map: ActiveStopMap;
    try {
      map = await dependencies.getMap();
    } catch {
      return json(unavailableResponse, 503);
    }

    let result: ActiveStopMapResult | null;
    try {
      result = await map.get();
    } catch {
      result = null;
    }
    if (!result || !validPublicResult(result))
      return json(unavailableResponse, 503);
    if (!isStopMapFeedHash(result.feedHash) || result.feedHash !== version) {
      return json(versionUnavailableResponse, 404);
    }

    const document = toStopMapFeatureCollection(result);
    const body = JSON.stringify(document);
    if (new TextEncoder().encode(body).byteLength > MAX_STOP_MAP_BYTES) {
      return json(unavailableResponse, 503);
    }

    const headers = immutableHeaders(result.feedHash);
    if (request.headers.get("If-None-Match") === headers.ETag) {
      return new Response(null, { status: 304, headers });
    }
    return new Response(body, { status: 200, headers });
  };
}

export const createStopMapGet = createStopsGeoJsonGet;
export const createStopsGet = createStopsGeoJsonGet;
export const createStopsGeoJsonRoute = createStopsGeoJsonGet;

export const GET = createStopsGeoJsonGet({
  getMap: async () => {
    const { getActiveStopMap } = await import("@/server/transit/stop-map");
    return getActiveStopMap();
  },
  readPlannerFlag: () => process.env.CITYWIDE_PLANNER_ENABLED,
});
