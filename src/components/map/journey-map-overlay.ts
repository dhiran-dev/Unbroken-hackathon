import { CITYWIDE_LIVE_VEHICLE_SOURCE_ID } from "./journey-map-config";
import {
  normalizeJourneyPlan,
  SF_ROUTE_BOUNDS,
  type SafeJourneyLeg,
  type SafeJourneyPlan,
} from "@/domain/journey/citywide-journey-form";

export type MapCoordinate = [longitude: number, latitude: number];

export type JourneyRouteFeature = {
  type: "Feature";
  properties: {
    kind: "journey-leg";
    legIndex: number;
    legType: SafeJourneyLeg["type"];
    routeId: string | null;
    routeName: string | null;
    from: string;
    to: string;
    accessibility: SafeJourneyLeg["accessibility"]["state"];
  };
  geometry: {
    type: "LineString";
    coordinates: MapCoordinate[];
  };
};

export type JourneyMarkerKind =
  "origin" | "destination" | "transfer" | "leg-endpoint" | "affected-stop";

export type JourneyMarkerShape =
  | "origin"
  | "destination"
  | "transfer"
  | "endpoint"
  | "accessible-stop"
  | "warning";

export type JourneyMarkerFeature = {
  type: "Feature";
  properties: {
    kind: JourneyMarkerKind;
    shape: JourneyMarkerShape;
    label: string;
    accessibility: SafeJourneyLeg["accessibility"]["state"] | null;
    stopId: string | null;
  };
  geometry: { type: "Point"; coordinates: MapCoordinate };
};

export type JourneyMapOverlay = {
  routes: { type: "FeatureCollection"; features: JourneyRouteFeature[] };
  markers: { type: "FeatureCollection"; features: JourneyMarkerFeature[] };
  warnings: string[];
  changes: string[];
  routeIds: string[];
  bounds: JourneyMapBounds;
};

export type LiveVehicleFeature = {
  type: "Feature";
  id: string;
  properties: {
    routeId: string;
    bearing: number | null;
    observedAt: string;
  };
  geometry: { type: "Point"; coordinates: MapCoordinate };
};

export type LiveVehicleFeatureCollection = {
  type: "FeatureCollection";
  features: LiveVehicleFeature[];
};

export type JourneyMapBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

type CameraMap = {
  fitBounds(
    bounds: [number, number, number, number],
    options: { duration: number; padding: number },
  ): unknown;
  flyTo(options: { center: MapCoordinate; duration: number }): unknown;
  jumpTo(options: { center: MapCoordinate }): unknown;
};

const MAX_LIVE_VEHICLES = 256;
const MAX_ROUTE_IDS = 32;
const MAX_ROUTE_ID_LENGTH = 80;
const SF_LIVE_BOUNDS = SF_ROUTE_BOUNDS;
const ISO_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/u;

const JOURNEY_MARKER_PRIORITY: Record<JourneyMarkerKind, number> = {
  "leg-endpoint": 1,
  transfer: 2,
  "affected-stop": 3,
  origin: 4,
  destination: 5,
};

export const JOURNEY_MAP_LEGEND = [
  {
    shape: "origin" as const,
    label: "Start",
    description: "Where your journey begins.",
  },
  {
    shape: "destination" as const,
    label: "Destination",
    description: "Where your journey ends.",
  },
  {
    shape: "transfer" as const,
    label: "Transfer",
    description: "Where you change to the next step.",
  },
  {
    shape: "endpoint" as const,
    label: "Step endpoint",
    description: "The end of one mapped step.",
  },
  {
    shape: "accessible-stop" as const,
    label: "Confirmed stop details",
    description: "A stop with step-free details confirmed.",
  },
  {
    shape: "warning" as const,
    label: "Check this stop",
    description: "A stop has a detail that needs checking.",
  },
  {
    shape: "vehicle" as const,
    label: "Current vehicle",
    description: "A current vehicle on a selected route.",
  },
] as const;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    value.trim() === value &&
    !/[<>\u0000-\u001f\u007f]/u.test(value)
  );
}

function safeCoordinate(value: unknown): value is MapCoordinate {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "number" &&
    typeof value[1] === "number" &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1]) &&
    value[0] >= SF_LIVE_BOUNDS.west &&
    value[0] <= SF_LIVE_BOUNDS.east &&
    value[1] >= SF_LIVE_BOUNDS.south &&
    value[1] <= SF_LIVE_BOUNDS.north
  );
}

function closeCoordinates(left: MapCoordinate, right: MapCoordinate) {
  return (
    Math.abs(left[0] - right[0]) < 0.000001 &&
    Math.abs(left[1] - right[1]) < 0.000001
  );
}

function featureForLeg(
  leg: SafeJourneyLeg,
  legIndex: number,
): JourneyRouteFeature {
  return {
    type: "Feature",
    properties: {
      kind: "journey-leg",
      legIndex,
      legType: leg.type,
      routeId: leg.route?.id ?? null,
      routeName: leg.route?.name ?? null,
      from: leg.from,
      to: leg.to,
      accessibility: leg.accessibility.state,
    },
    geometry: {
      type: "LineString",
      coordinates: leg.geometry.coordinates.map((coordinate) => [
        coordinate[0],
        coordinate[1],
      ]),
    },
  };
}

function markerFor(
  kind: JourneyMarkerKind,
  shape: JourneyMarkerShape,
  coordinate: MapCoordinate,
  label: string,
  accessibility: JourneyMarkerFeature["properties"]["accessibility"] = null,
  stopId: string | null = null,
): JourneyMarkerFeature {
  return {
    type: "Feature",
    properties: { kind, shape, label, accessibility, stopId },
    geometry: { type: "Point", coordinates: [coordinate[0], coordinate[1]] },
  };
}

function upsertMarker(
  markers: JourneyMarkerFeature[],
  candidate: JourneyMarkerFeature,
) {
  const index = markers.findIndex((marker) =>
    closeCoordinates(
      marker.geometry.coordinates,
      candidate.geometry.coordinates,
    ),
  );
  if (index === -1) {
    markers.push(candidate);
    return;
  }
  const current = markers[index];
  if (!current) return;
  if (
    JOURNEY_MARKER_PRIORITY[candidate.properties.kind] >
    JOURNEY_MARKER_PRIORITY[current.properties.kind]
  ) {
    markers[index] = candidate;
  }
}

function routeIdsForPlan(plan: SafeJourneyPlan) {
  const routeIds: string[] = [];
  for (const leg of plan.legs) {
    if (leg.type !== "ride") continue;
    const routeId = leg.route?.id;
    if (
      !routeId ||
      routeId.includes(",") ||
      !safeText(routeId, MAX_ROUTE_ID_LENGTH) ||
      routeIds.includes(routeId)
    ) {
      continue;
    }
    routeIds.push(routeId);
    if (routeIds.length === MAX_ROUTE_IDS) break;
  }
  return routeIds;
}

function boundedJourneyBounds(bounds: JourneyMapBounds) {
  if (
    ![bounds.west, bounds.south, bounds.east, bounds.north].every(
      Number.isFinite,
    ) ||
    bounds.west >= bounds.east ||
    bounds.south >= bounds.north
  ) {
    return null;
  }
  const bounded = {
    west: Math.max(bounds.west, SF_ROUTE_BOUNDS.west),
    south: Math.max(bounds.south, SF_ROUTE_BOUNDS.south),
    east: Math.min(bounds.east, SF_ROUTE_BOUNDS.east),
    north: Math.min(bounds.north, SF_ROUTE_BOUNDS.north),
  };
  return bounded.west < bounded.east && bounded.south < bounded.north
    ? bounded
    : null;
}

function coordinateWithinBounds(
  coordinate: MapCoordinate,
  bounds: JourneyMapBounds,
) {
  return (
    coordinate[0] >= bounds.west &&
    coordinate[0] <= bounds.east &&
    coordinate[1] >= bounds.south &&
    coordinate[1] <= bounds.north
  );
}

function planCoordinatesStayInCity(
  plan: SafeJourneyPlan,
  bounds: JourneyMapBounds,
) {
  const inMap = (coordinate: MapCoordinate) =>
    safeCoordinate(coordinate) && coordinateWithinBounds(coordinate, bounds);
  const firstLeg = plan.legs[0];
  const lastLeg = plan.legs[plan.legs.length - 1];
  if (!firstLeg || !lastLeg) return false;
  const firstStart = firstLeg.geometry.coordinates[0];
  const lastEnd =
    lastLeg.geometry.coordinates[lastLeg.geometry.coordinates.length - 1];
  if (
    !firstStart ||
    !lastEnd ||
    !closeCoordinates(firstStart, plan.map.origin.coordinates) ||
    !closeCoordinates(lastEnd, plan.map.destination.coordinates)
  ) {
    return false;
  }
  for (let index = 1; index < plan.legs.length; index += 1) {
    const previous = plan.legs[index - 1];
    const current = plan.legs[index];
    if (!previous || !current) return false;
    const previousEnd =
      previous.geometry.coordinates[previous.geometry.coordinates.length - 1];
    const currentStart = current.geometry.coordinates[0];
    if (
      !previousEnd ||
      !currentStart ||
      !closeCoordinates(previousEnd, currentStart)
    ) {
      return false;
    }
  }
  return (
    inMap(plan.map.origin.coordinates) &&
    inMap(plan.map.destination.coordinates) &&
    plan.map.affectedStops.features.every((stop) =>
      inMap(stop.geometry.coordinates),
    ) &&
    plan.legs.every((leg) =>
      leg.geometry.coordinates.every((coordinate) => inMap(coordinate)),
    )
  );
}

export function journeyOverlayForPlan(
  value: unknown,
): JourneyMapOverlay | null {
  const plan = normalizeJourneyPlan(value);
  if (!plan) return null;
  const bounds = boundedJourneyBounds(plan.map.bounds);
  if (!bounds || !planCoordinatesStayInCity(plan, plan.map.bounds)) return null;

  const routes = plan.legs.map(featureForLeg);
  const markers: JourneyMarkerFeature[] = [];
  upsertMarker(
    markers,
    markerFor("origin", "origin", plan.map.origin.coordinates, "Start"),
  );

  for (let index = 0; index < plan.legs.length; index += 1) {
    const leg = plan.legs[index];
    if (!leg) continue;
    const start = leg.geometry.coordinates[0];
    const end = leg.geometry.coordinates[leg.geometry.coordinates.length - 1];
    if (start && !closeCoordinates(start, plan.map.origin.coordinates)) {
      upsertMarker(
        markers,
        markerFor(
          index > 0 ? "transfer" : "leg-endpoint",
          index > 0 ? "transfer" : "endpoint",
          start,
          index > 0 ? "Transfer: " + leg.from : "Step endpoint: " + leg.from,
        ),
      );
    }
    if (end && !closeCoordinates(end, plan.map.destination.coordinates)) {
      upsertMarker(
        markers,
        markerFor(
          index < plan.legs.length - 1 ? "transfer" : "leg-endpoint",
          index < plan.legs.length - 1 ? "transfer" : "endpoint",
          end,
          index < plan.legs.length - 1
            ? "Transfer: " + leg.to
            : "Step endpoint: " + leg.to,
        ),
      );
    }
  }

  upsertMarker(
    markers,
    markerFor(
      "destination",
      "destination",
      plan.map.destination.coordinates,
      "Destination",
    ),
  );
  for (const stop of plan.map.affectedStops.features) {
    const warning = stop.properties.accessibility !== "confirmed";
    upsertMarker(
      markers,
      markerFor(
        "affected-stop",
        warning ? "warning" : "accessible-stop",
        stop.geometry.coordinates,
        warning
          ? `${stop.properties.name}: check this stop`
          : stop.properties.name,
        stop.properties.accessibility,
        stop.properties.id,
      ),
    );
  }

  return {
    routes: { type: "FeatureCollection", features: routes },
    markers: { type: "FeatureCollection", features: markers },
    warnings: [...plan.warnings],
    changes: [...plan.changes],
    routeIds: routeIdsForPlan(plan),
    bounds: { ...bounds },
  };
}

function exactKeys(value: object, expected: string) {
  return Object.keys(value).sort().join(",") === expected;
}

function safeIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = ISO_TIMESTAMP_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = Number(match[10] ?? 0);
  const offsetMinute = Number(match[11] ?? 0);
  const daysInMonth =
    month === 2
      ? 28 + (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 1 : 0)
      : [4, 6, 9, 11].includes(month)
        ? 30
        : 31;
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth &&
    hour >= 0 &&
    hour <= 23 &&
    minute >= 0 &&
    minute <= 59 &&
    second >= 0 &&
    second <= 59 &&
    offsetHour >= 0 &&
    offsetHour <= 23 &&
    offsetMinute >= 0 &&
    offsetMinute <= 59 &&
    Number.isFinite(Date.parse(value))
  );
}

function validBearing(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 0 &&
      value < 360)
  );
}

const liveFeatureCollectionKeys = "features,type";
const liveFeatureKeys = "geometry,properties,type";
const liveGeometryKeys = "coordinates,type";
const livePropertiesKeys = "bearing,observedAt,routeId";

export function normalizeLiveVehicleGeoJson(
  value: unknown,
  allowedRouteIds?: readonly string[],
): LiveVehicleFeatureCollection | null {
  if (
    !record(value) ||
    !exactKeys(value, liveFeatureCollectionKeys) ||
    value.type !== "FeatureCollection" ||
    !Array.isArray(value.features) ||
    value.features.length > MAX_LIVE_VEHICLES
  ) {
    return null;
  }

  const features: LiveVehicleFeature[] = [];
  for (const [index, candidate] of value.features.entries()) {
    if (
      !record(candidate) ||
      !exactKeys(candidate, liveFeatureKeys) ||
      candidate.type !== "Feature" ||
      !record(candidate.geometry) ||
      !exactKeys(candidate.geometry, liveGeometryKeys) ||
      candidate.geometry.type !== "Point" ||
      !safeCoordinate(candidate.geometry.coordinates) ||
      !record(candidate.properties) ||
      !exactKeys(candidate.properties, livePropertiesKeys) ||
      !safeText(candidate.properties.routeId, MAX_ROUTE_ID_LENGTH) ||
      candidate.properties.routeId.includes(",") ||
      (allowedRouteIds &&
        !allowedRouteIds.includes(candidate.properties.routeId)) ||
      !validBearing(candidate.properties.bearing) ||
      !safeIsoTimestamp(candidate.properties.observedAt)
    ) {
      return null;
    }
    features.push({
      type: "Feature",
      id: `vehicle-${index}`,
      properties: {
        routeId: candidate.properties.routeId,
        bearing: candidate.properties.bearing,
        observedAt: candidate.properties.observedAt,
      },
      geometry: {
        type: "Point",
        coordinates: [
          candidate.geometry.coordinates[0],
          candidate.geometry.coordinates[1],
        ],
      },
    });
  }
  return { type: "FeatureCollection", features };
}

function boundedLiveBbox(bounds: JourneyMapBounds) {
  if (
    ![bounds.west, bounds.south, bounds.east, bounds.north].every(
      Number.isFinite,
    ) ||
    bounds.west > bounds.east ||
    bounds.south > bounds.north
  ) {
    return null;
  }
  const bounded = {
    west: Math.max(bounds.west, SF_LIVE_BOUNDS.west),
    south: Math.max(bounds.south, SF_LIVE_BOUNDS.south),
    east: Math.min(bounds.east, SF_LIVE_BOUNDS.east),
    north: Math.min(bounds.north, SF_LIVE_BOUNDS.north),
  };
  return bounded.west < bounded.east && bounded.south < bounded.north
    ? bounded
    : null;
}

export function liveVehicleRequestUrl(
  bounds: JourneyMapBounds,
  routeIds: readonly string[],
) {
  const bounded = boundedLiveBbox(bounds);
  if (!bounded) return null;
  const safeRouteIds = routeIds
    .filter(
      (routeId) =>
        safeText(routeId, MAX_ROUTE_ID_LENGTH) && !routeId.includes(","),
    )
    .filter((routeId, index, values) => values.indexOf(routeId) === index)
    .slice(0, MAX_ROUTE_IDS);
  if (safeRouteIds.length === 0) return null;
  const query = new URLSearchParams({
    bbox: [bounded.west, bounded.south, bounded.east, bounded.north]
      .map((coordinate) => coordinate.toFixed(6))
      .join(","),
    routeIds: safeRouteIds.join(","),
  });
  return `/api/public/live?${query.toString()}`;
}

export function fitMapToJourney(
  map: Pick<CameraMap, "fitBounds">,
  bounds: JourneyMapBounds,
  reducedMotion: boolean,
) {
  const bounded = boundedJourneyBounds(bounds);
  if (!bounded) return false;
  map.fitBounds([bounded.west, bounded.south, bounded.east, bounded.north], {
    duration: reducedMotion ? 0 : 600,
    padding: 48,
  });
  return true;
}

export function updateLiveVehicleSource(
  map: { getSource(id: string): unknown },
  vehicles: LiveVehicleFeatureCollection,
) {
  const source = map.getSource(CITYWIDE_LIVE_VEHICLE_SOURCE_ID);
  if (!record(source) || typeof source.setData !== "function") return false;
  const setData = source.setData as (
    data: LiveVehicleFeatureCollection,
  ) => unknown;
  setData.call(source, vehicles);
  return true;
}

export function moveMapToSelectedCoordinate(
  map: Pick<CameraMap, "flyTo" | "jumpTo">,
  coordinate: MapCoordinate,
  reducedMotion: boolean,
) {
  if (!safeCoordinate(coordinate)) return false;
  if (reducedMotion) {
    map.jumpTo({ center: [coordinate[0], coordinate[1]] });
  } else {
    map.flyTo({ center: [coordinate[0], coordinate[1]], duration: 600 });
  }
  return true;
}
