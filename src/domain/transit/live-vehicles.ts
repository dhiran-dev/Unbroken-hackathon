import type {
  CurrentVehicleSnapshotView,
  MapBounds,
  RealtimeTransit,
  VehicleView,
} from "./realtime";

export const MAX_LIVE_ROUTE_IDS = 32;
export const MAX_LIVE_ROUTE_ID_LENGTH = 80;
export const MAX_LIVE_VEHICLE_FEATURES = 256;

export const SF_LIVE_BOUNDS = {
  south: 37.68,
  north: 37.86,
  west: -122.58,
  east: -122.31,
} as const;

const SAFE_ID = /^[^\s,<>\u0000-\u001f\u007f]{1,80}$/u;

export type LiveVehicleRequest = {
  bounds: MapBounds;
  routeIds: readonly string[];
};

export type PublicLiveVehicleFeature = {
  type: "Feature";
  properties: {
    routeId: string;
    bearing: number | null;
    observedAt: string;
  };
  geometry: {
    type: "Point";
    coordinates: [longitude: number, latitude: number];
  };
};

export type PublicLiveVehiclesResult =
  | { state: "current"; features: PublicLiveVehicleFeature[] }
  | { state: "unavailable" };

export interface CurrentVehicleReader {
  getCurrentVehicles(at: Date): Promise<CurrentVehicleSnapshotView>;
}

export interface PublicLiveVehicles {
  read(
    request: LiveVehicleRequest,
    at: Date,
  ): Promise<PublicLiveVehiclesResult>;
}

function inBounds(bounds: MapBounds) {
  return (
    Boolean(bounds) &&
    Number.isFinite(bounds.west) &&
    Number.isFinite(bounds.south) &&
    Number.isFinite(bounds.east) &&
    Number.isFinite(bounds.north) &&
    bounds.west >= SF_LIVE_BOUNDS.west &&
    bounds.east <= SF_LIVE_BOUNDS.east &&
    bounds.south >= SF_LIVE_BOUNDS.south &&
    bounds.north <= SF_LIVE_BOUNDS.north &&
    bounds.west < bounds.east &&
    bounds.south < bounds.north
  );
}

export function isValidLiveRouteId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_LIVE_ROUTE_ID_LENGTH &&
    SAFE_ID.test(value)
  );
}

function safeRouteIds(routeIds: readonly string[]) {
  return (
    routeIds.length > 0 &&
    routeIds.length <= MAX_LIVE_ROUTE_IDS &&
    new Set(routeIds).size === routeIds.length &&
    routeIds.every(isValidLiveRouteId)
  );
}

function safeCoordinate(latitude: unknown, longitude: unknown) {
  return (
    typeof latitude === "number" &&
    typeof longitude === "number" &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= SF_LIVE_BOUNDS.south &&
    latitude <= SF_LIVE_BOUNDS.north &&
    longitude >= SF_LIVE_BOUNDS.west &&
    longitude <= SF_LIVE_BOUNDS.east
  );
}

function safeBearing(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 0 &&
      value < 360)
  );
}

function safeObservedAt(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function safeVehicle(value: unknown): value is VehicleView {
  if (!value || typeof value !== "object") return false;
  const vehicle = value as Partial<VehicleView>;
  return (
    isValidLiveRouteId(vehicle.routeId) &&
    safeCoordinate(vehicle.latitude, vehicle.longitude) &&
    safeBearing(vehicle.bearing) &&
    safeObservedAt(vehicle.observedAt)
  );
}

function compareFeatures(
  left: PublicLiveVehicleFeature,
  right: PublicLiveVehicleFeature,
) {
  const routeOrder = left.properties.routeId.localeCompare(
    right.properties.routeId,
  );
  if (routeOrder !== 0) return routeOrder;
  const timeOrder = left.properties.observedAt.localeCompare(
    right.properties.observedAt,
  );
  if (timeOrder !== 0) return timeOrder;
  const latitudeOrder =
    left.geometry.coordinates[1] - right.geometry.coordinates[1];
  if (latitudeOrder !== 0) return latitudeOrder;
  const longitudeOrder =
    left.geometry.coordinates[0] - right.geometry.coordinates[0];
  if (longitudeOrder !== 0) return longitudeOrder;
  return (left.properties.bearing ?? -1) - (right.properties.bearing ?? -1);
}

function featureKey(feature: PublicLiveVehicleFeature) {
  return JSON.stringify([
    feature.properties.routeId,
    feature.properties.bearing,
    feature.properties.observedAt,
    feature.geometry.coordinates,
  ]);
}

function toFeature(vehicle: VehicleView): PublicLiveVehicleFeature {
  return {
    type: "Feature",
    properties: {
      routeId: vehicle.routeId,
      bearing: vehicle.bearing,
      observedAt: vehicle.observedAt.toISOString(),
    },
    geometry: {
      type: "Point",
      coordinates: [vehicle.longitude, vehicle.latitude],
    },
  };
}

export function isValidLiveVehicleRequest(
  request: LiveVehicleRequest,
): boolean {
  return (
    Boolean(request) &&
    typeof request === "object" &&
    Boolean(request.bounds) &&
    Array.isArray(request.routeIds) &&
    inBounds(request.bounds) &&
    safeRouteIds(request.routeIds)
  );
}

export function createPublicLiveVehicles(
  source: CurrentVehicleReader | RealtimeTransit,
): PublicLiveVehicles {
  return {
    async read(request, at) {
      if (!isValidLiveVehicleRequest(request)) {
        return { state: "unavailable" };
      }

      let snapshot: CurrentVehicleSnapshotView;
      try {
        snapshot = await source.getCurrentVehicles(at);
      } catch {
        return { state: "unavailable" };
      }
      if (
        !snapshot ||
        snapshot.state !== "current" ||
        !Array.isArray(snapshot.vehicles)
      ) {
        return { state: "unavailable" };
      }

      const routeIds = new Set(request.routeIds);
      const features = snapshot.vehicles
        .filter(
          (vehicle) =>
            safeVehicle(vehicle) &&
            routeIds.has(vehicle.routeId) &&
            vehicle.longitude >= request.bounds.west &&
            vehicle.longitude <= request.bounds.east &&
            vehicle.latitude >= request.bounds.south &&
            vehicle.latitude <= request.bounds.north,
        )
        .map(toFeature)
        .sort(compareFeatures);
      const unique: PublicLiveVehicleFeature[] = [];
      const seen = new Set<string>();
      for (const feature of features) {
        const key = featureKey(feature);
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(feature);
        if (unique.length === MAX_LIVE_VEHICLE_FEATURES) break;
      }
      return { state: "current", features: unique };
    },
  };
}
