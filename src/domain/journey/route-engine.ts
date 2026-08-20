export type RouteEnginePlace = {
  label: string;
  latitude: number;
  longitude: number;
  stopIds: string[];
};

export type RouteEngineRequest = {
  origin: RouteEnginePlace;
  destination: RouteEnginePlace;
  departureAt: Date;
};

export type RouteLegPlace = {
  name: string;
  latitude: number;
  longitude: number;
  stopId: string | null;
};

export type RouteLineString = {
  type: "LineString";
  coordinates: [number, number][];
};

type RouteCandidateLegBase = {
  from: RouteLegPlace;
  to: RouteLegPlace;
  startAt: Date;
  endAt: Date;
  durationSeconds: number;
  geometry: RouteLineString;
};

export type WalkRouteCandidateLeg = RouteCandidateLegBase & {
  type: "walk" | "transfer";
  distanceMeters: number;
};

export type WaitRouteCandidateLeg = RouteCandidateLegBase & {
  type: "wait";
};

export type RideRouteCandidateLeg = RouteCandidateLegBase & {
  type: "ride";
  routeId: string;
  tripId: string;
  mode: "bus" | "tram" | "subway" | "cable_car";
  routeName: string;
  routeColor: string;
  headsign: string | null;
  intermediateStopIds: string[];
};

export type RouteCandidateLeg =
  | WalkRouteCandidateLeg
  | WaitRouteCandidateLeg
  | RideRouteCandidateLeg;

export type RouteCandidate = {
  id: string;
  departureAt: Date;
  arrivalAt: Date;
  durationSeconds: number;
  walkingDistanceMeters: number;
  transferCount: number;
  legs: RouteCandidateLeg[];
};

export interface RouteEngine {
  planCandidates(request: RouteEngineRequest): Promise<RouteCandidate[]>;
}

export class RouteEngineUnavailableError extends Error {
  readonly code = "ROUTE_ENGINE_UNAVAILABLE";

  constructor() {
    super("Journey candidates are unavailable.");
    this.name = "RouteEngineUnavailableError";
  }
}
