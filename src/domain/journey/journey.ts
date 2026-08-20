import type {
  AccessibilityReasonCode,
  AccessibilityState,
  EvidenceFreshness,
  EvidenceProvenance,
} from "@/domain/journey/accessibility-evidence";
import type {
  JourneyDraftLeg,
  JourneyPlannerCore,
  JourneyPlannerCoreResult,
  ResolvedJourneyRequest,
  SelectedJourneyDraft,
} from "@/domain/journey/journey-planner";
import type { RouteEnginePlace } from "@/domain/journey/route-engine";
import type { PlaceChoice, TransitCatalog } from "@/domain/transit/catalog";

export type PlaceInput =
  | { type: "catalog"; placeId: string }
  | {
      type: "current_location";
      latitude: number;
      longitude: number;
      accuracyMeters: number;
    };

export type JourneyRequest = {
  origin: PlaceInput;
  destination: PlaceInput;
  departureAt: string;
};

export type JourneyPlanStatus =
  "confirmed" | "check_details" | "unavailable" | "updates_unavailable";

export type PublicAccessibilityState = AccessibilityState;

export type JourneyLeg = {
  type: JourneyDraftLeg["type"];
  from: string;
  to: string;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  route?: {
    id: string;
    name: string;
    color: string;
    destination: string;
  };
  instruction: string;
  geometry: GeoJSONLineString;
  accessibility: {
    state: PublicAccessibilityState;
    reasons: string[];
  };
};

type PublicReasonCode = Exclude<AccessibilityReasonCode, "INVALID_CANDIDATE">;

export type PublicSourceName =
  | "schedule"
  | "arrivals"
  | "vehicles"
  | "service_changes"
  | "stop_changes"
  | "elevators"
  | "station_access";

export type SourceTime = {
  source: PublicSourceName;
  checkedAt: string | null;
  sourceUpdatedAt: string | null;
  freshness: EvidenceFreshness;
  sourceUrl: string;
};

export type GeoJSONPoint = {
  type: "Point";
  coordinates: [number, number];
};

export type GeoJSONLineString = {
  type: "LineString";
  coordinates: [number, number][];
};

export type MapBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export type AffectedStopProperties = {
  id: string;
  name: string;
  accessibility: PublicAccessibilityState;
};

export type AffectedStopFeature = {
  type: "Feature";
  geometry: GeoJSONPoint;
  properties: AffectedStopProperties;
};

export type AffectedStops = {
  type: "FeatureCollection";
  features: AffectedStopFeature[];
};

export type JourneyPlanMap = {
  bounds: MapBounds;
  origin: GeoJSONPoint;
  destination: GeoJSONPoint;
  affectedStops: AffectedStops;
};

export type JourneyPlan = {
  status: JourneyPlanStatus;
  title: string;
  summary: string;
  departureAt: string;
  arrivalAt: string;
  durationMinutes: number;
  legs: JourneyLeg[];
  warnings: string[];
  changes: string[];
  sources: SourceTime[];
  map: JourneyPlanMap;
};

export interface JourneyPlanner {
  plan(request: JourneyRequest): Promise<JourneyPlan>;
}

export class JourneyRequestInvalidError extends Error {
  readonly code = "JOURNEY_REQUEST_INVALID" as const;

  constructor() {
    super("Choose valid From and To places.");
    this.name = "JourneyRequestInvalidError";
  }
}

type JourneyPlannerDependencies = {
  catalog: TransitCatalog;
  core: JourneyPlannerCore;
  clock: () => Date;
};

const SF_ROUTE_BOUNDS = {
  south: 37.68,
  north: 37.86,
  west: -122.58,
  east: -122.31,
} as const;

const PAST_WINDOW_MS = 24 * 60 * 60 * 1_000;
const FUTURE_WINDOW_MS = 366 * 24 * 60 * 60 * 1_000;
const MAX_SAME_ENDPOINT_METERS = 1;
const MAX_TEXT_LENGTH = 500;
const MAX_PLACE_ID_LENGTH = 160;
const MAX_STOP_IDS = 32;

const OFFSET_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|([+-])(\d{2}):(\d{2}))$/u;

const PUBLIC_REASON_CODES: ReadonlySet<string> = new Set([
  "ACCESSIBILITY_ADVISORY_ACTIVE",
  "CURRENT_TIMING_UNCERTAIN",
  "ELEVATOR_OUT_OF_SERVICE",
  "ELEVATOR_STATUS_UNKNOWN",
  "MAPPED_PATH_UNCONFIRMED",
  "SERVICE_ALERT_ACTIVE",
  "SOURCE_OLDER",
  "SOURCE_UNAVAILABLE",
  "STATION_ACCESS_UNAVAILABLE",
  "STOP_ACCESS_UNKNOWN",
  "STOP_RELOCATION_ACTIVE",
  "STOP_SKIPPED",
  "TRIP_CANCELLED",
]);

const PUBLIC_REASON_MESSAGES: Readonly<Record<PublicReasonCode, string>> = {
  ACCESSIBILITY_ADVISORY_ACTIVE:
    "An accessibility update may affect this journey.",
  CURRENT_TIMING_UNCERTAIN: "Current timing details need checking.",
  ELEVATOR_OUT_OF_SERVICE: "A needed elevator is out of service.",
  ELEVATOR_STATUS_UNKNOWN: "Current elevator details need checking.",
  MAPPED_PATH_UNCONFIRMED: "Some step-free path details need checking.",
  SERVICE_ALERT_ACTIVE: "A current service update may affect this journey.",
  SOURCE_OLDER: "Some information is older than expected.",
  SOURCE_UNAVAILABLE: "Some current information is unavailable.",
  STATION_ACCESS_UNAVAILABLE: "Step-free station access is unavailable.",
  STOP_ACCESS_UNKNOWN: "Step-free stop access details need checking.",
  STOP_RELOCATION_ACTIVE: "A stop for this journey has moved.",
  STOP_SKIPPED: "A planned stop is not being served.",
  TRIP_CANCELLED: "A planned trip is not running.",
};

const STATUS_TITLES: Record<JourneyPlanStatus, string> = {
  confirmed: "Step-free details confirmed",
  check_details: "Some details need checking",
  unavailable: "No step-free route confirmed",
  updates_unavailable: "Current updates are unavailable",
};

const SOURCE_MAP: Partial<
  Record<
    EvidenceProvenance["source"],
    { source: PublicSourceName; sourceUrl: string }
  >
> = {
  trip_updates: {
    source: "arrivals",
    sourceUrl: "https://511.org/open-data/transit",
  },
  alerts: {
    source: "service_changes",
    sourceUrl: "https://511.org/open-data/transit",
  },
  service_changes: {
    source: "service_changes",
    sourceUrl:
      "https://www.sfmta.com/travel-transit-updates?field_transit_type_disrupted_value=Accessibility",
  },
  stop_changes: {
    source: "stop_changes",
    sourceUrl:
      "https://www.sfmta.com/travel-updates/temporary-stop-relocations",
  },
  station_access: {
    source: "station_access",
    sourceUrl:
      "https://www.sfmta.com/getting-around/sfmta-accessibility/muni-access-guide/access-muni-metro/muni-metro-accessible-stops",
  },
  elevators: {
    source: "elevators",
    sourceUrl:
      "https://www.sfmta.com/elevator-status/elevatorstatus.php?src=prod",
  },
};

const SOURCE_STATE_RANK: Record<EvidenceFreshness, number> = {
  unavailable: 0,
  older: 1,
  current: 2,
};

function invalidRequest(): never {
  throw new JourneyRequestInvalidError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const expected = [...keys].sort();
  const actual = Object.keys(value).sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function safeText(value: unknown, maximum = MAX_TEXT_LENGTH): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    value === value.trim() &&
    !/[<>\u0000-\u001f\u007f]/u.test(value)
  );
}

function inRouteBoundary(latitude: number, longitude: number) {
  return (
    latitude >= SF_ROUTE_BOUNDS.south &&
    latitude <= SF_ROUTE_BOUNDS.north &&
    longitude >= SF_ROUTE_BOUNDS.west &&
    longitude <= SF_ROUTE_BOUNDS.east
  );
}

function offsetDate(value: unknown): Date | null {
  if (!safeText(value, 64)) return null;
  const match = OFFSET_DATE_TIME.exec(value);
  if (!match) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
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
    return null;
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
    return null;
  }
  return new Date(timestamp);
}

function validClockDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function parseRequestShape(value: unknown) {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["origin", "destination", "departureAt"])
  ) {
    invalidRequest();
  }
  const origin = parsePlaceInput(value.origin);
  const destination = parsePlaceInput(value.destination);
  if (typeof value.departureAt !== "string") invalidRequest();
  return { origin, destination, departureAt: value.departureAt };
}

function parsePlaceInput(value: unknown): PlaceInput {
  if (!isRecord(value) || typeof value.type !== "string") invalidRequest();
  if (value.type === "catalog") {
    if (
      !hasExactKeys(value, ["type", "placeId"]) ||
      !safeText(value.placeId, MAX_PLACE_ID_LENGTH) ||
      !/^(stop|station|landmark):[^\s<>\u0000-\u001f\u007f]{1,160}$/u.test(
        value.placeId,
      )
    ) {
      invalidRequest();
    }
    return { type: "catalog", placeId: value.placeId };
  }
  if (value.type !== "current_location") invalidRequest();
  if (
    !hasExactKeys(value, ["type", "latitude", "longitude", "accuracyMeters"]) ||
    !finiteNumber(value.latitude) ||
    !finiteNumber(value.longitude) ||
    !finiteNumber(value.accuracyMeters) ||
    !inRouteBoundary(value.latitude, value.longitude) ||
    value.accuracyMeters < 0 ||
    value.accuracyMeters > 1_000
  ) {
    invalidRequest();
  }
  return {
    type: "current_location",
    latitude: value.latitude,
    longitude: value.longitude,
    accuracyMeters: value.accuracyMeters,
  };
}

function sameCoordinates(left: RouteEnginePlace, right: RouteEnginePlace) {
  const latitudeMeters = (left.latitude - right.latitude) * 111_000;
  const longitudeMeters =
    (left.longitude - right.longitude) *
    111_000 *
    Math.cos((((left.latitude + right.latitude) / 2) * Math.PI) / 180);
  return (
    Math.hypot(latitudeMeters, longitudeMeters) <= MAX_SAME_ENDPOINT_METERS
  );
}

function safeStopId(value: unknown): value is string {
  return safeText(value, 200) && !value.includes(":") && !value.includes(" ");
}

function mapCatalogPlace(
  value: PlaceChoice | null,
  requestedId: string,
): RouteEnginePlace {
  if (
    !value ||
    !isRecord(value) ||
    value.id !== requestedId ||
    (value.type !== "stop" &&
      value.type !== "station" &&
      value.type !== "landmark") ||
    !safeText(value.name) ||
    !finiteNumber(value.latitude) ||
    !finiteNumber(value.longitude) ||
    !inRouteBoundary(value.latitude, value.longitude) ||
    !Array.isArray(value.stopIds) ||
    value.stopIds.length > MAX_STOP_IDS ||
    !value.stopIds.every(safeStopId) ||
    new Set(value.stopIds).size !== value.stopIds.length
  ) {
    invalidRequest();
  }
  return {
    label: value.name,
    latitude: value.latitude,
    longitude: value.longitude,
    stopIds: [...value.stopIds],
  };
}

async function resolvePlace(
  catalog: TransitCatalog,
  input: PlaceInput,
): Promise<RouteEnginePlace> {
  if (input.type === "current_location") {
    return {
      label: "Current location",
      latitude: input.latitude,
      longitude: input.longitude,
      stopIds: [],
    };
  }
  return mapCatalogPlace(
    await catalog.getPlace({ placeId: input.placeId }),
    input.placeId,
  );
}

function finiteDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function isoDate(value: unknown, fallback: Date): string {
  return (finiteDate(value) ? value : fallback).toISOString();
}

function publicState(value: unknown): PublicAccessibilityState {
  return value === "confirmed" || value === "unknown" || value === "blocked"
    ? value
    : "unknown";
}

function publicReasons(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value)]
    .filter(
      (reason): reason is PublicReasonCode =>
        typeof reason === "string" && PUBLIC_REASON_CODES.has(reason),
    )
    .map((reason) => PUBLIC_REASON_MESSAGES[reason])
    .sort();
}

function publicGeometry(value: JourneyDraftLeg["geometry"]): GeoJSONLineString {
  const coordinates = Array.isArray(value?.coordinates)
    ? value.coordinates.filter(
        (coordinate): coordinate is [number, number] =>
          Array.isArray(coordinate) &&
          coordinate.length === 2 &&
          finiteNumber(coordinate[0]) &&
          finiteNumber(coordinate[1]),
      )
    : [];
  return {
    type: "LineString",
    coordinates: coordinates.map(([longitude, latitude]) => [
      longitude,
      latitude,
    ]),
  };
}

function publicLeg(
  leg: JourneyDraftLeg,
  fallbackStart: Date,
  fallbackEnd: Date,
): JourneyLeg {
  const type =
    leg.type === "walk" ||
    leg.type === "wait" ||
    leg.type === "ride" ||
    leg.type === "transfer"
      ? leg.type
      : "walk";
  const durationMinutes =
    finiteNumber(leg.durationMinutes) && leg.durationMinutes >= 0
      ? leg.durationMinutes
      : 0;
  const result: JourneyLeg = {
    type,
    from: safeText(leg.from?.name) ? leg.from.name : "Selected place",
    to: safeText(leg.to?.name) ? leg.to.name : "Selected place",
    startAt: isoDate(leg.startAt, fallbackStart),
    endAt: isoDate(leg.endAt, fallbackEnd),
    durationMinutes,
    instruction: safeText(leg.instruction)
      ? leg.instruction
      : "Continue to the selected place.",
    geometry: publicGeometry(leg.geometry),
    accessibility: {
      state: publicState(leg.accessibility?.state),
      reasons: publicReasons(leg.accessibility?.reasons),
    },
  };
  if (leg.route) {
    result.route = {
      id: safeText(leg.route.id) ? leg.route.id : "",
      name: safeText(leg.route.name) ? leg.route.name : "",
      color: safeText(leg.route.color) ? leg.route.color : "",
      destination: safeText(leg.route.destination) ? leg.route.destination : "",
    };
  }
  return result;
}

function safeSummaryText(value: string) {
  return safeText(value, 240) ? value : "selected place";
}

function summary(
  status: JourneyPlanStatus,
  origin: RouteEnginePlace,
  destination: RouteEnginePlace,
  durationMinutes: number,
) {
  if (status === "unavailable") {
    return "A step-free route could not be confirmed for this journey.";
  }
  const from = safeSummaryText(origin.label);
  const to = safeSummaryText(destination.label);
  const duration = `${durationMinutes} minute${durationMinutes === 1 ? "" : "s"}`;
  if (status === "confirmed") {
    return `A step-free route is confirmed from ${from} to ${to} in ${duration}.`;
  }
  if (status === "updates_unavailable") {
    return `A route is available from ${from} to ${to}, but current updates are unavailable.`;
  }
  return `A route is available from ${from} to ${to}, but some details need checking.`;
}

function uniquePublicText(values: readonly string[]) {
  return [
    ...new Set(values.filter((value): value is string => safeText(value))),
  ];
}

function sourceDate(value: Date | null): string | null {
  return finiteDate(value) ? value.toISOString() : null;
}

type MappedSource = SourceTime & {
  identity: string;
  checkedTimestamp: number | null;
  sourceUpdatedTimestamp: number | null;
};

function mappedSource(value: EvidenceProvenance): MappedSource | null {
  const mapped = SOURCE_MAP[value.source];
  if (!mapped) return null;
  const checkedTimestamp = finiteDate(value.checkedAt)
    ? value.checkedAt.getTime()
    : null;
  const sourceUpdatedTimestamp = finiteDate(value.sourceUpdatedAt)
    ? value.sourceUpdatedAt.getTime()
    : null;
  return {
    identity: mapped.source + "\u0000" + mapped.sourceUrl,
    source: mapped.source,
    checkedAt: sourceDate(value.checkedAt),
    sourceUpdatedAt: sourceDate(value.sourceUpdatedAt),
    freshness: value.state,
    sourceUrl: mapped.sourceUrl,
    checkedTimestamp,
    sourceUpdatedTimestamp,
  };
}

function worseFreshness(left: EvidenceFreshness, right: EvidenceFreshness) {
  return SOURCE_STATE_RANK[left] < SOURCE_STATE_RANK[right] ? left : right;
}

function publicSources(values: readonly EvidenceProvenance[]): SourceTime[] {
  const byIdentity = new Map<string, MappedSource>();
  for (const value of values) {
    const mapped = mappedSource(value);
    if (!mapped) continue;
    const existing = byIdentity.get(mapped.identity);
    if (!existing) {
      byIdentity.set(mapped.identity, mapped);
      continue;
    }
    const checkedTimestamp =
      mapped.checkedTimestamp === null
        ? existing.checkedTimestamp
        : existing.checkedTimestamp === null
          ? mapped.checkedTimestamp
          : Math.max(mapped.checkedTimestamp, existing.checkedTimestamp);
    const sourceUpdatedTimestamp =
      mapped.sourceUpdatedTimestamp === null
        ? existing.sourceUpdatedTimestamp
        : existing.sourceUpdatedTimestamp === null
          ? mapped.sourceUpdatedTimestamp
          : Math.max(
              mapped.sourceUpdatedTimestamp,
              existing.sourceUpdatedTimestamp,
            );
    byIdentity.set(mapped.identity, {
      ...existing,
      freshness: worseFreshness(mapped.freshness, existing.freshness),
      checkedAt:
        checkedTimestamp === null
          ? null
          : new Date(checkedTimestamp).toISOString(),
      sourceUpdatedAt:
        sourceUpdatedTimestamp === null
          ? null
          : new Date(sourceUpdatedTimestamp).toISOString(),
      checkedTimestamp,
      sourceUpdatedTimestamp,
    });
  }
  return [...byIdentity.values()]
    .sort(
      (left, right) =>
        left.source.localeCompare(right.source) ||
        left.sourceUrl.localeCompare(right.sourceUrl),
    )
    .map((value) => ({
      source: value.source,
      checkedAt: value.checkedAt,
      sourceUpdatedAt: value.sourceUpdatedAt,
      freshness: value.freshness,
      sourceUrl: value.sourceUrl,
    }));
}

function makeMap(
  origin: RouteEnginePlace,
  destination: RouteEnginePlace,
  legs: readonly JourneyDraftLeg[],
): JourneyPlanMap {
  const originPoint: GeoJSONPoint = {
    type: "Point",
    coordinates: [origin.longitude, origin.latitude],
  };
  const destinationPoint: GeoJSONPoint = {
    type: "Point",
    coordinates: [destination.longitude, destination.latitude],
  };
  const allCoordinates: [number, number][] = [
    originPoint.coordinates,
    destinationPoint.coordinates,
  ];
  const stops = new Map<
    string,
    {
      id: string;
      name: string;
      latitude: number;
      longitude: number;
      accessibility: PublicAccessibilityState;
    }
  >();
  const stateRank: Record<PublicAccessibilityState, number> = {
    confirmed: 0,
    unknown: 1,
    blocked: 2,
  };
  for (const leg of legs) {
    const geometry = publicGeometry(leg.geometry);
    allCoordinates.push(...geometry.coordinates);
    const state = publicState(leg.accessibility?.state);
    for (const endpoint of [leg.from, leg.to]) {
      const stopId = endpoint.stopId;
      if (
        !safeStopId(stopId) ||
        !finiteNumber(endpoint.latitude) ||
        !finiteNumber(endpoint.longitude)
      ) {
        continue;
      }
      const existing = stops.get(stopId);
      if (!existing) {
        stops.set(stopId, {
          id: stopId,
          name: safeText(endpoint.name) ? endpoint.name : "Selected stop",
          latitude: endpoint.latitude,
          longitude: endpoint.longitude,
          accessibility: state,
        });
      } else if (stateRank[state] > stateRank[existing.accessibility]) {
        existing.accessibility = state;
      }
    }
  }
  const longitudes = allCoordinates.map(([longitude]) => longitude);
  const latitudes = allCoordinates.map(([, latitude]) => latitude);
  const features: AffectedStopFeature[] = [...stops.values()]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((stop) => ({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [stop.longitude, stop.latitude],
      },
      properties: {
        id: stop.id,
        name: stop.name,
        accessibility: stop.accessibility,
      },
    }));
  return {
    bounds: {
      west: Math.min(...longitudes),
      south: Math.min(...latitudes),
      east: Math.max(...longitudes),
      north: Math.max(...latitudes),
    },
    origin: originPoint,
    destination: destinationPoint,
    affectedStops: { type: "FeatureCollection", features },
  };
}

function unavailablePlan(
  requestDeparture: Date,
  origin: RouteEnginePlace,
  destination: RouteEnginePlace,
): JourneyPlan {
  return {
    status: "unavailable",
    title: STATUS_TITLES.unavailable,
    summary: summary("unavailable", origin, destination, 0),
    departureAt: requestDeparture.toISOString(),
    arrivalAt: requestDeparture.toISOString(),
    durationMinutes: 0,
    legs: [],
    warnings: [],
    changes: [],
    sources: [],
    map: makeMap(origin, destination, []),
  };
}

function projectSelected(
  journey: SelectedJourneyDraft,
  requestDeparture: Date,
  origin: RouteEnginePlace,
  destination: RouteEnginePlace,
): JourneyPlan {
  const status: JourneyPlanStatus =
    journey.status === "confirmed" ||
    journey.status === "check_details" ||
    journey.status === "updates_unavailable"
      ? journey.status
      : "check_details";
  const departureAt = finiteDate(journey.departureAt)
    ? journey.departureAt
    : requestDeparture;
  const arrivalAt = finiteDate(journey.arrivalAt)
    ? journey.arrivalAt
    : departureAt;
  const durationMinutes =
    finiteNumber(journey.durationMinutes) && journey.durationMinutes >= 0
      ? journey.durationMinutes
      : Math.max(
          0,
          Math.ceil((arrivalAt.getTime() - departureAt.getTime()) / 60_000),
        );
  const legs = journey.legs.map((leg) =>
    publicLeg(leg, departureAt, arrivalAt),
  );
  return {
    status,
    title: STATUS_TITLES[status],
    summary: summary(status, origin, destination, durationMinutes),
    departureAt: departureAt.toISOString(),
    arrivalAt: arrivalAt.toISOString(),
    durationMinutes,
    legs,
    warnings: uniquePublicText(journey.warnings),
    changes: uniquePublicText(journey.changes),
    sources: publicSources(journey.sources),
    map: makeMap(origin, destination, journey.legs),
  };
}

function project(
  result: JourneyPlannerCoreResult,
  requestDeparture: Date,
  origin: RouteEnginePlace,
  destination: RouteEnginePlace,
): JourneyPlan {
  return result.kind === "selected"
    ? projectSelected(result.journey, requestDeparture, origin, destination)
    : unavailablePlan(requestDeparture, origin, destination);
}

export function createJourneyPlanner(
  dependencies: JourneyPlannerDependencies,
): JourneyPlanner {
  return {
    async plan(request) {
      const parsed = parseRequestShape(request);
      const requestDeparture = offsetDate(parsed.departureAt);
      if (!requestDeparture) invalidRequest();
      const evaluatedAt = dependencies.clock();
      if (!validClockDate(evaluatedAt)) invalidRequest();
      const evaluatedDate = new Date(evaluatedAt);
      const departureTime = requestDeparture.getTime();
      const evaluatedTime = evaluatedDate.getTime();
      if (
        departureTime < evaluatedTime - PAST_WINDOW_MS ||
        departureTime > evaluatedTime + FUTURE_WINDOW_MS
      ) {
        invalidRequest();
      }
      if (
        parsed.origin.type === "catalog" &&
        parsed.destination.type === "catalog" &&
        parsed.origin.placeId === parsed.destination.placeId
      ) {
        invalidRequest();
      }
      const [origin, destination] = await Promise.all([
        resolvePlace(dependencies.catalog, parsed.origin),
        resolvePlace(dependencies.catalog, parsed.destination),
      ]);
      if (sameCoordinates(origin, destination)) invalidRequest();
      const resolvedRequest: ResolvedJourneyRequest = {
        origin,
        destination,
        departureAt: new Date(requestDeparture),
        evaluatedAt: evaluatedDate,
      };
      const result = await dependencies.core.plan(resolvedRequest);
      return project(result, requestDeparture, origin, destination);
    },
  };
}
