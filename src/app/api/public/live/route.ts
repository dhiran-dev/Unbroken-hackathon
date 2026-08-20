import {
  isValidLiveRouteId,
  isValidLiveVehicleRequest,
  MAX_LIVE_ROUTE_IDS,
  MAX_LIVE_VEHICLE_FEATURES,
  SF_LIVE_BOUNDS,
  type LiveVehicleRequest,
  type PublicLiveVehiclesResult,
} from "@/domain/transit/live-vehicles";

export const dynamic = "force-dynamic";

const noStoreHeaders = { "Cache-Control": "no-store, max-age=0" };
const invalidResponse = {
  available: false,
  code: "LIVE_VEHICLES_REQUEST_INVALID",
  message: "This live vehicle request is invalid.",
} as const;
const unavailableResponse = {
  available: false,
  code: "LIVE_VEHICLES_UNAVAILABLE",
  message: "Current vehicle locations are unavailable right now.",
} as const;
const numericPart = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u;
const MAX_BBOX_QUERY_LENGTH = 160;
const allowedParameters = new Set(["bbox", "routeIds"]);
const isoTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export type LiveVehiclesRouteDependencies = {
  getLiveVehicles: (
    request: LiveVehicleRequest,
    at: Date,
  ) => Promise<PublicLiveVehiclesResult>;
  readPlannerFlag: () => string | undefined;
  clock?: () => Date;
};

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: noStoreHeaders });
}

function parseNumber(value: string) {
  if (!numericPart.test(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseBounds(value: string): LiveVehicleRequest["bounds"] | null {
  if (value.length === 0 || value.length > MAX_BBOX_QUERY_LENGTH) return null;
  const parts = value.split(",");
  if (parts.length !== 4 || parts.some((part) => part === "")) return null;
  const parsed = parts.map(parseNumber);
  const west = parsed[0]!;
  const south = parsed[1]!;
  const east = parsed[2]!;
  const north = parsed[3]!;
  if (
    west === null ||
    south === null ||
    east === null ||
    north === null ||
    west < SF_LIVE_BOUNDS.west ||
    east > SF_LIVE_BOUNDS.east ||
    south < SF_LIVE_BOUNDS.south ||
    north > SF_LIVE_BOUNDS.north ||
    west >= east ||
    south >= north
  ) {
    return null;
  }
  return { west, south, east, north };
}

function parseRouteIds(value: string) {
  const routeIds = value.split(",");
  if (
    routeIds.length === 0 ||
    routeIds.length > MAX_LIVE_ROUTE_IDS ||
    routeIds.some((routeId) => !isValidLiveRouteId(routeId)) ||
    new Set(routeIds).size !== routeIds.length
  ) {
    return null;
  }
  return routeIds;
}

export function parseLiveVehicleRequest(
  request: Request,
): LiveVehicleRequest | null {
  const parameters = new URL(request.url).searchParams;
  for (const key of parameters.keys()) {
    if (!allowedParameters.has(key)) return null;
  }
  const bboxes = parameters.getAll("bbox");
  const routeFilters = parameters.getAll("routeIds");
  if (bboxes.length !== 1 || routeFilters.length !== 1) return null;
  const bounds = parseBounds(bboxes[0]!);
  const routeIds = parseRouteIds(routeFilters[0]!);
  if (!bounds || !routeIds) return null;
  const parsed = { bounds, routeIds } satisfies LiveVehicleRequest;
  return isValidLiveVehicleRequest(parsed) ? parsed : null;
}

function safeResult(
  result: PublicLiveVehiclesResult,
  request: LiveVehicleRequest,
) {
  if (!result || typeof result !== "object") return false;
  if (result.state === "unavailable") return true;
  if (
    result.state !== "current" ||
    !Array.isArray(result.features) ||
    result.features.length > MAX_LIVE_VEHICLE_FEATURES
  ) {
    return false;
  }
  const routeIds = new Set(request.routeIds);
  const seen = new Set<string>();
  return result.features.every((feature) => {
    if (!feature || typeof feature !== "object") return false;
    const properties = feature.properties;
    const geometry = feature.geometry;
    if (
      Object.keys(feature).sort().join(",") !== "geometry,properties,type" ||
      feature.type !== "Feature" ||
      !properties ||
      typeof properties !== "object" ||
      Object.keys(properties).sort().join(",") !==
        "bearing,observedAt,routeId" ||
      !isValidLiveRouteId(properties.routeId) ||
      !routeIds.has(properties.routeId) ||
      (properties.bearing !== null &&
        (typeof properties.bearing !== "number" ||
          !Number.isFinite(properties.bearing) ||
          properties.bearing < 0 ||
          properties.bearing >= 360)) ||
      typeof properties.observedAt !== "string" ||
      !isoTimestamp.test(properties.observedAt) ||
      !Number.isFinite(Date.parse(properties.observedAt)) ||
      !geometry ||
      typeof geometry !== "object" ||
      Object.keys(geometry).sort().join(",") !== "coordinates,type" ||
      geometry.type !== "Point" ||
      !Array.isArray(geometry.coordinates) ||
      geometry.coordinates.length !== 2 ||
      geometry.coordinates.some(
        (coordinate) =>
          typeof coordinate !== "number" || !Number.isFinite(coordinate),
      )
    ) {
      return false;
    }
    const [longitude, latitude] = geometry.coordinates;
    if (
      longitude! < request.bounds.west ||
      longitude! > request.bounds.east ||
      latitude! < request.bounds.south ||
      latitude! > request.bounds.north ||
      longitude! < SF_LIVE_BOUNDS.west ||
      longitude! > SF_LIVE_BOUNDS.east ||
      latitude! < SF_LIVE_BOUNDS.south ||
      latitude! > SF_LIVE_BOUNDS.north
    ) {
      return false;
    }
    const key = JSON.stringify([
      properties.routeId,
      properties.bearing,
      properties.observedAt,
      geometry.coordinates,
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function createLiveVehiclesGet(
  dependencies: LiveVehiclesRouteDependencies,
) {
  return async function GET(request: Request) {
    if (dependencies.readPlannerFlag() !== "true") {
      return json(unavailableResponse, 503);
    }

    const parsed = parseLiveVehicleRequest(request);
    if (!parsed) return json(invalidResponse, 400);

    let result: PublicLiveVehiclesResult;
    try {
      result = await dependencies.getLiveVehicles(
        parsed,
        dependencies.clock?.() ?? new Date(),
      );
    } catch {
      return json(unavailableResponse, 503);
    }
    if (!safeResult(result, parsed)) return json(unavailableResponse, 503);
    if (result.state === "unavailable") {
      return json(unavailableResponse, 503);
    }
    return new Response(
      JSON.stringify({ type: "FeatureCollection", features: result.features }),
      {
        status: 200,
        headers: {
          "Cache-Control": noStoreHeaders["Cache-Control"],
          "Content-Type": "application/geo+json",
        },
      },
    );
  };
}

export const GET = createLiveVehiclesGet({
  getLiveVehicles: async (request, at) =>
    (await import("@/server/transit/live-vehicles"))
      .getPublicLiveVehicles()
      .read(request, at),
  readPlannerFlag: () => process.env.CITYWIDE_PLANNER_ENABLED,
});
