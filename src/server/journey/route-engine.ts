import { createHash } from "node:crypto";

import type {
  RideRouteCandidateLeg,
  RouteCandidate,
  RouteCandidateLeg,
  RouteEngine,
  RouteEnginePlace,
  RouteEngineRequest,
  RouteLegPlace,
  RouteLineString,
  WalkRouteCandidateLeg,
} from "@/domain/journey/route-engine";
import { RouteEngineUnavailableError } from "@/domain/journey/route-engine";

const SF = {
  south: 37.68,
  north: 37.86,
  west: -122.58,
  east: -122.31,
} as const;
const MAX_TEXT = 160;
const MAX_STOP_IDS = 32;
const MAX_LEGS = 32;
const MAX_GEOMETRY_POINTS = 8_192;
const MAX_WAIT_MS = 4 * 60 * 60 * 1_000;
const MAX_JOURNEY_MS = 24 * 60 * 60 * 1_000;
const MAX_SPATIAL_GAP_METERS = 250;
const PAST_WINDOW_MS = 24 * 60 * 60 * 1_000;
const FUTURE_WINDOW_MS = 366 * 24 * 60 * 60 * 1_000;
const NEUTRAL_ROUTE_COLOR = "#5B6472";
const OFFSET_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|([+-])(\d{2}):(\d{2}))$/u;

export type OtpPlanPortRequest = {
  origin: { latitude: number; longitude: number };
  destination: { latitude: number; longitude: number };
  departure: string;
};

export interface OtpPlanPort {
  plan(request: OtpPlanPortRequest): Promise<unknown>;
}

type RecordValue = Record<string, unknown>;

function unavailable(): never {
  throw new RouteEngineUnavailableError();
}

function record(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) unavailable();
  return value as RecordValue;
}

function array(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) unavailable();
  return value;
}

function boundedText(value: unknown, maximum = MAX_TEXT): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    unavailable();
  }
  return value;
}

function sfCoordinate(latitude: unknown, longitude: unknown) {
  if (
    typeof latitude !== "number" ||
    typeof longitude !== "number" ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < SF.south ||
    latitude > SF.north ||
    longitude < SF.west ||
    longitude > SF.east
  ) {
    unavailable();
  }
  return { latitude, longitude };
}

function validInputId(value: unknown): string {
  const id = boundedText(value, 200);
  if (id.trim() !== id || id.includes(":")) unavailable();
  return id;
}

function gtfsId(value: unknown): string {
  const id = boundedText(value, 240);
  const separator = id.indexOf(":");
  if (
    separator <= 0 ||
    separator === id.length - 1 ||
    id.trim() !== id ||
    /\s/u.test(id.slice(0, separator))
  ) {
    unavailable();
  }
  return id.slice(separator + 1);
}

function validInputPlace(value: RouteEnginePlace): RouteEnginePlace {
  const placeValue = record(value);
  const coordinate = sfCoordinate(placeValue.latitude, placeValue.longitude);
  const stopIds = array(placeValue.stopIds, MAX_STOP_IDS).map(validInputId);
  if (new Set(stopIds).size !== stopIds.length) unavailable();
  return {
    label: boundedText(placeValue.label),
    ...coordinate,
    stopIds,
  };
}

function offsetDate(value: unknown): Date {
  const valueText = boundedText(value, 64);
  const match = OFFSET_DATE_TIME.exec(valueText);
  if (!match) unavailable();
  const timestamp = Date.parse(valueText);
  if (!Number.isFinite(timestamp)) unavailable();
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHours = Number(match[9] ?? 0);
  const offsetMinutes = Number(match[10] ?? 0);
  if (
    month < 1 ||
    month > 12 ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHours > 23 ||
    offsetMinutes > 59
  ) {
    unavailable();
  }
  const offset =
    match[7] === "Z"
      ? 0
      : (match[8] === "+" ? 1 : -1) *
        (offsetHours * 60 + offsetMinutes) *
        60_000;
  const local = new Date(timestamp + offset);
  if (
    local.getUTCFullYear() !== year ||
    local.getUTCMonth() !== month - 1 ||
    local.getUTCDate() !== day ||
    local.getUTCHours() !== hour ||
    local.getUTCMinutes() !== minute ||
    local.getUTCSeconds() !== second
  ) {
    unavailable();
  }
  return new Date(timestamp);
}

function millisecondDate(value: unknown): Date {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    unavailable();
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) unavailable();
  return date;
}

function finiteNonNegative(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    unavailable();
  return value;
}

function place(value: unknown): RouteLegPlace {
  const raw = record(value);
  const coordinate = sfCoordinate(raw.lat, raw.lon);
  let stopId: string | null = null;
  if (raw.stop !== null) {
    stopId = gtfsId(record(raw.stop).gtfsId);
  }
  return {
    name: boundedText(raw.name),
    ...coordinate,
    stopId,
  };
}

function distanceMeters(
  left: { latitude: number; longitude: number },
  right: { latitude: number; longitude: number },
) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(right.latitude - left.latitude);
  const longitudeDelta = radians(right.longitude - left.longitude);
  const latitudeA = radians(left.latitude);
  const latitudeB = radians(right.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitudeA) *
      Math.cos(latitudeB) *
      Math.sin(longitudeDelta / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(haversine));
}

function requireConnected(left: RouteLegPlace, right: RouteLegPlace) {
  if (
    (left.stopId !== null &&
      right.stopId !== null &&
      left.stopId !== right.stopId) ||
    distanceMeters(left, right) > MAX_SPATIAL_GAP_METERS
  ) {
    unavailable();
  }
}

function decodePolyline(value: unknown): RouteLineString {
  const encoded = boundedText(value, 100_000);
  const coordinates: [number, number][] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  const nextDelta = () => {
    let result = 0;
    let shift = 0;
    while (true) {
      if (index >= encoded.length || shift > 30) unavailable();
      const byte = encoded.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63) unavailable();
      result |= (byte & 0x1f) << shift;
      shift += 5;
      if (byte < 0x20) break;
    }
    return result & 1 ? ~(result >> 1) : result >> 1;
  };

  while (index < encoded.length) {
    latitude += nextDelta();
    longitude += nextDelta();
    const point = sfCoordinate(latitude / 1e5, longitude / 1e5);
    coordinates.push([point.longitude, point.latitude]);
    if (coordinates.length > MAX_GEOMETRY_POINTS) unavailable();
  }
  if (coordinates.length < 2) unavailable();
  return { type: "LineString", coordinates };
}

function legBase(raw: RecordValue) {
  const startAt = millisecondDate(raw.startTime);
  const endAt = millisecondDate(raw.endTime);
  const durationMs = endAt.getTime() - startAt.getTime();
  if (durationMs <= 0 || durationMs > MAX_JOURNEY_MS) unavailable();
  const from = place(raw.from);
  const to = place(raw.to);
  const geometry = decodePolyline(record(raw.legGeometry).points);
  const [first] = geometry.coordinates;
  const last = geometry.coordinates.at(-1);
  if (
    !first ||
    !last ||
    distanceMeters(from, { longitude: first[0], latitude: first[1] }) >
      MAX_SPATIAL_GAP_METERS ||
    distanceMeters(to, { longitude: last[0], latitude: last[1] }) >
      MAX_SPATIAL_GAP_METERS
  ) {
    unavailable();
  }
  return {
    from,
    to,
    startAt,
    endAt,
    durationSeconds: durationMs / 1_000,
    geometry,
  };
}

function walkLeg(
  raw: RecordValue,
  type: "walk" | "transfer",
): WalkRouteCandidateLeg {
  return {
    type,
    ...legBase(raw),
    distanceMeters: finiteNonNegative(raw.distance),
  };
}

function rideLeg(raw: RecordValue): RideRouteCandidateLeg {
  const route = record(raw.route);
  const trip = record(raw.trip);
  const routeId = gtfsId(route.gtfsId);
  const rawColor = route.color;
  let routeColor = NEUTRAL_ROUTE_COLOR;
  if (rawColor !== null && rawColor !== undefined && rawColor !== "") {
    if (typeof rawColor !== "string" || !/^#?[A-Fa-f0-9]{6}$/u.test(rawColor))
      unavailable();
    routeColor = "#" + rawColor.replace(/^#/u, "").toUpperCase();
  }
  const modeMap = {
    BUS: "bus",
    TRAM: "tram",
    SUBWAY: "subway",
    CABLE_CAR: "cable_car",
  } as const;
  const rawMode = boundedText(raw.mode, 32);
  const mode = modeMap[rawMode as keyof typeof modeMap];
  if (!mode) unavailable();
  const shortName = route.shortName;
  const longName = route.longName;
  const routeName =
    typeof shortName === "string" && shortName.length > 0
      ? boundedText(shortName, 120)
      : boundedText(longName, 160);
  return {
    type: "ride",
    ...legBase(raw),
    routeId,
    tripId: gtfsId(trip.gtfsId),
    mode,
    routeName,
    routeColor,
    headsign: raw.headsign === null ? null : boundedText(raw.headsign, 160),
    intermediateStopIds: array(raw.intermediateStops, MAX_STOP_IDS).map(
      (stop) => gtfsId(record(stop).gtfsId),
    ),
  };
}

function waitLeg(
  from: Date,
  to: Date,
  boarding: RouteLegPlace,
): RouteCandidateLeg {
  const durationMs = to.getTime() - from.getTime();
  if (durationMs <= 0 || durationMs > MAX_WAIT_MS) unavailable();
  const point: [number, number] = [boarding.longitude, boarding.latitude];
  return {
    type: "wait",
    from: { ...boarding },
    to: { ...boarding },
    startAt: new Date(from),
    endAt: new Date(to),
    durationSeconds: durationMs / 1_000,
    geometry: { type: "LineString", coordinates: [point, [...point]] },
  };
}

function semanticCandidate(candidate: Omit<RouteCandidate, "id">) {
  return JSON.stringify(candidate, (_key, value: unknown) =>
    value instanceof Date ? value.toISOString() : value,
  );
}

function normalizeItinerary(value: unknown): RouteCandidate {
  const itinerary = record(value);
  const departureAt = offsetDate(itinerary.start);
  const arrivalAt = offsetDate(itinerary.end);
  const durationMs = arrivalAt.getTime() - departureAt.getTime();
  if (durationMs <= 0 || durationMs > MAX_JOURNEY_MS) unavailable();
  const rawLegs = array(itinerary.legs, MAX_LEGS);
  if (rawLegs.length === 0) unavailable();
  const modes = rawLegs.map((raw) => boundedText(record(raw).mode, 32));
  const rideCount = modes.filter((mode) => mode !== "WALK").length;
  if (rideCount === 0) unavailable();

  const legs: RouteCandidateLeg[] = [];
  let previousEnd = departureAt;
  let walkingDistanceMeters = 0;
  rawLegs.forEach((rawValue, index) => {
    const raw = record(rawValue);
    const mode = modes[index];
    const normalized =
      mode === "WALK"
        ? walkLeg(
            raw,
            modes.slice(0, index).some((candidate) => candidate !== "WALK") &&
              modes.slice(index + 1).some(
                (candidate) => candidate !== "WALK",
              )
              ? "transfer"
              : "walk",
          )
        : rideLeg(raw);
    const previousLeg = legs.at(-1);
    if (previousLeg) requireConnected(previousLeg.to, normalized.from);
    if (normalized.startAt < previousEnd) unavailable();
    if (normalized.startAt > previousEnd) {
      if (normalized.type !== "ride") unavailable();
      legs.push(waitLeg(previousEnd, normalized.startAt, normalized.from));
    }
    if (normalized.type === "walk" || normalized.type === "transfer") {
      walkingDistanceMeters += normalized.distanceMeters;
    }
    legs.push(normalized);
    previousEnd = normalized.endAt;
  });
  if (
    legs[0]?.startAt.getTime() !== departureAt.getTime() ||
    previousEnd.getTime() !== arrivalAt.getTime()
  ) {
    unavailable();
  }
  const withoutId = {
    departureAt,
    arrivalAt,
    durationSeconds: durationMs / 1_000,
    walkingDistanceMeters,
    transferCount: Math.max(0, rideCount - 1),
    legs,
  };
  return {
    id: createHash("sha256").update(semanticCandidate(withoutId)).digest("hex"),
    ...withoutId,
  };
}

function normalizeResponse(value: unknown): RouteCandidate[] {
  const root = record(value);
  if (Object.prototype.hasOwnProperty.call(root, "errors")) unavailable();
  const connection = record(record(root.data).planConnection);
  if (array(connection.routingErrors, 32).length > 0) unavailable();
  const edges = array(connection.edges, 5);
  const candidates = edges.map((edge) =>
    normalizeItinerary(record(record(edge).node)),
  );
  const deduplicated = new Map(
    candidates.map((candidate) => [candidate.id, candidate]),
  );
  return [...deduplicated.values()].sort(
    (left, right) =>
      left.arrivalAt.getTime() - right.arrivalAt.getTime() ||
      left.transferCount - right.transferCount ||
      left.walkingDistanceMeters - right.walkingDistanceMeters ||
      left.id.localeCompare(right.id),
  );
}

function validateRequest(
  request: RouteEngineRequest,
  now: Date,
): OtpPlanPortRequest {
  const root = record(request);
  const origin = validInputPlace(root.origin as RouteEnginePlace);
  const destination = validInputPlace(root.destination as RouteEnginePlace);
  if (!(root.departureAt instanceof Date)) unavailable();
  const departure = root.departureAt.getTime();
  const nowMs = now.getTime();
  if (
    !Number.isFinite(departure) ||
    !Number.isFinite(nowMs) ||
    departure < nowMs - PAST_WINDOW_MS ||
    departure > nowMs + FUTURE_WINDOW_MS ||
    (origin.latitude === destination.latitude &&
      origin.longitude === destination.longitude)
  ) {
    unavailable();
  }
  return {
    origin: { latitude: origin.latitude, longitude: origin.longitude },
    destination: {
      latitude: destination.latitude,
      longitude: destination.longitude,
    },
    departure: new Date(departure).toISOString(),
  };
}

export function createRouteEngine(
  otp: OtpPlanPort,
  options: { clock?: () => Date } = {},
): RouteEngine {
  const clock = options.clock ?? (() => new Date());
  return {
    async planCandidates(request) {
      try {
        const portRequest = validateRequest(request, clock());
        return normalizeResponse(await otp.plan(portRequest));
      } catch {
        unavailable();
      }
    },
  };
}
