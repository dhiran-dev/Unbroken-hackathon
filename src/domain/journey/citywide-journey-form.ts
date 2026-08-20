import type { JourneyRequest, PlaceInput } from "@/domain/journey/journey";

export const CITYWIDE_FORM_ERROR_MESSAGES = {
  invalidPlaces: "Choose valid From and To places.",
  unselectedPlace: "Choose a place from the list.",
  futureDeparture: "Choose a future departure time.",
  locationUnavailable:
    "Location access is unavailable. Choose a place instead.",
  locationInaccurate:
    "Your location is not accurate enough. Choose a place instead.",
  locationOutside:
    "Your location is outside the Muni service area. Choose a place instead.",
  unavailable: "Journey planning is unavailable right now.",
} as const;

export const CITYWIDE_PLACE_GROUPS = [
  { id: "nearby_stops", label: "Nearby stops" },
  { id: "stations", label: "Stations" },
  { id: "places", label: "Places" },
] as const;

export const SF_ROUTE_BOUNDS = {
  south: 37.68,
  north: 37.86,
  west: -122.58,
  east: -122.31,
} as const;

const PLACE_ID_PATTERN =
  /^(?:stop|station|landmark):[^\s<>\u0000-\u001f\u007f]{1,160}$/u;
const ISO_LOCAL_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/u;
const MAX_PLACE_TEXT = 240;
const MAX_PLACE_DESCRIPTION = 500;
const MAX_ROUTE_TEXT = 160;
const MAX_REASON_TEXT = 300;
const MAX_PLAN_TEXT = 1_000;
const MAX_ERROR_TEXT = 240;
const MAX_PLAN_LEGS = 32;
const MAX_PLAN_LIST_ITEMS = 64;
const MAX_PLAN_SOURCES = 7;
const MAX_GEOMETRY_POINTS = 8_192;
const MAX_MAP_FEATURES = 64;
const MAX_ACCESSIBILITY_REASONS = 16;

const ISO_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/u;

export type CitywidePlaceType = "stop" | "station" | "landmark";

export type CitywidePlace = {
  id: string;
  type: CitywidePlaceType;
  name: string;
  description: string;
  latitude: number;
  longitude: number;
  stopIds: string[];
  routeNames: string[];
};

export type CurrentLocationInput = {
  type: "current_location";
  latitude: number;
  longitude: number;
  accuracyMeters: number;
};

export type CitywidePlaceSelection =
  | { kind: "catalog"; place: CitywidePlace }
  | { kind: "current_location"; input: CurrentLocationInput };

export type JourneyFieldState = {
  text: string;
  selection: CitywidePlaceSelection | null;
};

export type CitywideJourneyFormState = {
  origin: JourneyFieldState;
  destination: JourneyFieldState;
  departureMode: "now" | "future";
  futureDeparture: string;
};

export type JourneyFormField = "origin" | "destination";

export type CitywidePlaceGroup = {
  id: (typeof CITYWIDE_PLACE_GROUPS)[number]["id"];
  label: (typeof CITYWIDE_PLACE_GROUPS)[number]["label"];
  places: CitywidePlace[];
};

export type LocationFailureReason = "unavailable" | "inaccurate" | "outside";

export type LocationValidation =
  | { ok: true; input: CurrentLocationInput }
  | { ok: false; reason: LocationFailureReason; message: string };

export type JourneyRequestValidation =
  | { request: JourneyRequest; error: null }
  | { request: null; error: string };

export type SafeJourneyPlanStatus =
  | "confirmed"
  | "check_details"
  | "unavailable"
  | "updates_unavailable";

export type SafeJourneyPlan = {
  status: SafeJourneyPlanStatus;
  title: string;
  summary: string;
  departureAt: string;
  arrivalAt: string;
  durationMinutes: number;
  legs: SafeJourneyLeg[];
  warnings: string[];
  changes: string[];
  sources: SafeJourneySource[];
  map: SafeJourneyMap;
};

export type SafeJourneyLeg = {
  type: "walk" | "wait" | "ride" | "transfer";
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
  geometry: {
    type: "LineString";
    coordinates: [number, number][];
  };
  accessibility: {
    state: "confirmed" | "unknown" | "blocked";
    reasons: string[];
  };
};

export type SafeJourneySource = {
  source:
    | "schedule"
    | "arrivals"
    | "vehicles"
    | "service_changes"
    | "stop_changes"
    | "elevators"
    | "station_access";
  checkedAt: string | null;
  sourceUpdatedAt: string | null;
  freshness: "current" | "older" | "unavailable";
  sourceUrl: string;
};

export type SafeJourneyMap = {
  bounds: { west: number; south: number; east: number; north: number };
  origin: { type: "Point"; coordinates: [number, number] };
  destination: { type: "Point"; coordinates: [number, number] };
  affectedStops: {
    type: "FeatureCollection";
    features: {
      type: "Feature";
      geometry: { type: "Point"; coordinates: [number, number] };
      properties: {
        id: string;
        name: string;
        accessibility: "confirmed" | "unknown" | "blocked";
      };
    }[];
  };
};

function blankField(): JourneyFieldState {
  return { text: "", selection: null };
}

export function createCitywideJourneyFormState(): CitywideJourneyFormState {
  return {
    origin: blankField(),
    destination: blankField(),
    departureMode: "now",
    futureDeparture: "",
  };
}

function withField(
  state: CitywideJourneyFormState,
  field: JourneyFormField,
  value: JourneyFieldState,
): CitywideJourneyFormState {
  return { ...state, [field]: value };
}

export function setJourneyFieldText(
  state: CitywideJourneyFormState,
  field: JourneyFormField,
  text: string,
): CitywideJourneyFormState {
  return withField(state, field, { text, selection: null });
}

export function unselectedPlaceError(
  state: CitywideJourneyFormState,
): string | null {
  return (['origin', 'destination'] as const).some(
    (field) => state[field].selection === null && state[field].text.trim() !== '',
  )
    ? CITYWIDE_FORM_ERROR_MESSAGES.unselectedPlace
    : null;
}

export function selectCatalogPlace(
  state: CitywideJourneyFormState,
  field: JourneyFormField,
  place: CitywidePlace,
): CitywideJourneyFormState {
  return withField(state, field, {
    text: place.name,
    selection: { kind: "catalog", place },
  });
}

export function selectCurrentLocation(
  state: CitywideJourneyFormState,
  field: JourneyFormField,
  input: CurrentLocationInput,
): CitywideJourneyFormState {
  return withField(state, field, {
    text: "Current location",
    selection: { kind: "current_location", input },
  });
}

export function swapJourneyFields(
  state: CitywideJourneyFormState,
): CitywideJourneyFormState {
  return {
    ...state,
    origin: state.destination,
    destination: state.origin,
  };
}

export function setDepartureMode(
  state: CitywideJourneyFormState,
  mode: "now" | "future",
): CitywideJourneyFormState {
  return { ...state, departureMode: mode };
}

export function setFutureDeparture(
  state: CitywideJourneyFormState,
  futureDeparture: string,
): CitywideJourneyFormState {
  return { ...state, futureDeparture };
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function insideRouteBounds(latitude: number, longitude: number) {
  return (
    latitude >= SF_ROUTE_BOUNDS.south &&
    latitude <= SF_ROUTE_BOUNDS.north &&
    longitude >= SF_ROUTE_BOUNDS.west &&
    longitude <= SF_ROUTE_BOUNDS.east
  );
}

export function validateCurrentLocation(
  latitude: unknown,
  longitude: unknown,
  accuracyMeters: unknown,
): LocationValidation {
  if (!finiteNumber(latitude) || !finiteNumber(longitude)) {
    return {
      ok: false,
      reason: "unavailable",
      message: CITYWIDE_FORM_ERROR_MESSAGES.locationUnavailable,
    };
  }
  if (!insideRouteBounds(latitude, longitude)) {
    return {
      ok: false,
      reason: "outside",
      message: CITYWIDE_FORM_ERROR_MESSAGES.locationOutside,
    };
  }
  if (
    !finiteNumber(accuracyMeters) ||
    accuracyMeters < 0 ||
    accuracyMeters > 1_000
  ) {
    return {
      ok: false,
      reason: "inaccurate",
      message: CITYWIDE_FORM_ERROR_MESSAGES.locationInaccurate,
    };
  }
  return {
    ok: true,
    input: { type: "current_location", latitude, longitude, accuracyMeters },
  };
}

export function validateGeolocationPosition(
  position: unknown,
): LocationValidation {
  if (
    !record(position) ||
    !record(position.coords) ||
    !("latitude" in position.coords) ||
    !("longitude" in position.coords) ||
    !("accuracy" in position.coords)
  ) {
    return {
      ok: false,
      reason: "unavailable",
      message: CITYWIDE_FORM_ERROR_MESSAGES.locationUnavailable,
    };
  }
  return validateCurrentLocation(
    position.coords.latitude,
    position.coords.longitude,
    position.coords.accuracy,
  );
}

export function locationFailureFromCode(code: number | null | undefined) {
  return code === 1 || code === 2 || code === 3
    ? CITYWIDE_FORM_ERROR_MESSAGES.locationUnavailable
    : CITYWIDE_FORM_ERROR_MESSAGES.locationUnavailable;
}

function sameSelection(
  left: CitywidePlaceSelection,
  right: CitywidePlaceSelection,
) {
  if (left.kind !== right.kind) return false;
  if (left.kind === "catalog" && right.kind === "catalog") {
    return left.place.id === right.place.id;
  }
  if (left.kind === "current_location" && right.kind === "current_location") {
    return (
      left.input.latitude === right.input.latitude &&
      left.input.longitude === right.input.longitude &&
      left.input.accuracyMeters === right.input.accuracyMeters
    );
  }
  return false;
}

function placeInput(selection: CitywidePlaceSelection): PlaceInput {
  return selection.kind === "catalog"
    ? { type: "catalog", placeId: selection.place.id }
    : { ...selection.input };
}

function parseLocalDateTime(value: string): Date | null {
  const match = ISO_LOCAL_DATE_TIME_PATTERN.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? "0");
  const date = new Date(year, month - 1, day, hour, minute, second, 0);
  if (!Number.isFinite(date.getTime())) return null;
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute ||
    date.getSeconds() !== second
  ) {
    return null;
  }
  return date;
}

export function serializeFutureDeparture(value: string, now: Date): string | null {
  const date = parseLocalDateTime(value);
  if (!date || !Number.isFinite(now.getTime()) || date.getTime() <= now.getTime()) {
    return null;
  }
  return date.toISOString();
}

export function buildCitywideJourneyRequest(
  state: CitywideJourneyFormState,
  now: Date,
): JourneyRequestValidation {
  const originSelection = state.origin.selection;
  const destinationSelection = state.destination.selection;
  if (!originSelection || !destinationSelection) {
    return {
      request: null,
      error: CITYWIDE_FORM_ERROR_MESSAGES.invalidPlaces,
    };
  }
  if (sameSelection(originSelection, destinationSelection)) {
    return {
      request: null,
      error: CITYWIDE_FORM_ERROR_MESSAGES.invalidPlaces,
    };
  }

  const departureAt =
    state.departureMode === "now"
      ? Number.isFinite(now.getTime())
        ? now.toISOString()
        : null
      : serializeFutureDeparture(state.futureDeparture, now);
  if (!departureAt) {
    return {
      request: null,
      error:
        state.departureMode === "future"
          ? CITYWIDE_FORM_ERROR_MESSAGES.futureDeparture
          : CITYWIDE_FORM_ERROR_MESSAGES.unavailable,
    };
  }
  return {
    request: {
      origin: placeInput(originSelection),
      destination: placeInput(destinationSelection),
      departureAt,
    },
    error: null,
  };
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

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeCoordinatePair(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    finiteNumber(value[0]) &&
    finiteNumber(value[1]) &&
    value[0] >= -180 &&
    value[0] <= 180 &&
    value[1] >= -90 &&
    value[1] <= 90
  );
}

function normalizePlace(value: unknown): CitywidePlace | null {
  if (!record(value)) return null;
  if (
    !PLACE_ID_PATTERN.test(typeof value.id === "string" ? value.id : "") ||
    (value.type !== "stop" &&
      value.type !== "station" &&
      value.type !== "landmark") ||
    !safeText(value.name, MAX_PLACE_TEXT) ||
    !safeText(value.description, MAX_PLACE_DESCRIPTION) ||
    !finiteNumber(value.latitude) ||
    !finiteNumber(value.longitude) ||
    !Array.isArray(value.stopIds) ||
    !value.stopIds.every((item) => safeText(item, MAX_ROUTE_TEXT)) ||
    !Array.isArray(value.routeNames) ||
    !value.routeNames.every((item) => safeText(item, MAX_ROUTE_TEXT))
  ) {
    return null;
  }
  return {
    id: value.id as string,
    type: value.type as CitywidePlaceType,
    name: value.name,
    description: value.description,
    latitude: value.latitude,
    longitude: value.longitude,
    stopIds: [...value.stopIds],
    routeNames: [...value.routeNames],
  };
}

export function normalizePlaceGroups(value: unknown): CitywidePlaceGroup[] {
  const sourceGroups = record(value) && Array.isArray(value.groups) ? value.groups : [];
  const seenPlaceIds = new Set<string>();
  let duplicatePlaceId = false;
  const groups = CITYWIDE_PLACE_GROUPS.map((definition) => {
    const source = sourceGroups.find(
      (group): group is Record<string, unknown> =>
        record(group) && group.id === definition.id,
    );
    const places = source && Array.isArray(source.places)
      ? source.places
          .slice(0, 8)
          .map(normalizePlace)
          .filter((place): place is CitywidePlace => place !== null)
          .filter((place) => {
            if (seenPlaceIds.has(place.id)) {
              duplicatePlaceId = true;
              return false;
            }
            seenPlaceIds.add(place.id);
            return true;
          })
      : [];
    return { ...definition, places };
  });
  if (duplicatePlaceId) {
    return CITYWIDE_PLACE_GROUPS.map((definition) => ({
      ...definition,
      places: [],
    }));
  }
  return groups;
}

export function flattenPlaceGroups(groups: readonly CitywidePlaceGroup[]) {
  return groups.flatMap((group) => group.places);
}

export function movePlaceHighlight(
  currentIndex: number,
  optionCount: number,
  direction: "next" | "previous",
) {
  if (optionCount <= 0) return -1;
  if (direction === "next") {
    return currentIndex < 0 || currentIndex >= optionCount - 1
      ? 0
      : currentIndex + 1;
  }
  return currentIndex <= 0 || currentIndex >= optionCount
    ? optionCount - 1
    : currentIndex - 1;
}

export type PlaceSearchRequest = {
  sequence: number;
  signal: AbortSignal;
};

export type PlaceSearchRequestCoordinator = {
  begin(): PlaceSearchRequest;
  isCurrent(sequence: number): boolean;
  cancel(): void;
};

export function createPlaceSearchRequestCoordinator(): PlaceSearchRequestCoordinator {
  let sequence = 0;
  let activeController: AbortController | null = null;
  return {
    begin() {
      activeController?.abort();
      activeController = new AbortController();
      sequence += 1;
      return { sequence, signal: activeController.signal };
    },
    isCurrent(candidate) {
      return (
        candidate === sequence &&
        activeController !== null &&
        !activeController.signal.aborted
      );
    },
    cancel() {
      sequence += 1;
      activeController?.abort();
      activeController = null;
    },
  };
}

export type OneTimeLocationAttemptCoordinator = {
  begin(): boolean;
};

export function createOneTimeLocationAttemptCoordinator(): OneTimeLocationAttemptCoordinator {
  let used = false;
  return {
    begin() {
      if (used) return false;
      used = true;
      return true;
    },
  };
}

export type JourneySubmitRequest = {
  controller: AbortController;
};

export type JourneySubmitRequestCoordinator = {
  begin(): JourneySubmitRequest | null;
  complete(controller: AbortController): boolean;
  cancel(): void;
};

export function createJourneySubmitRequestCoordinator(): JourneySubmitRequestCoordinator {
  let activeController: AbortController | null = null;
  return {
    begin() {
      if (activeController) return null;
      activeController = new AbortController();
      return { controller: activeController };
    },
    complete(controller) {
      if (activeController !== controller) return false;
      activeController = null;
      return true;
    },
    cancel() {
      activeController?.abort();
      activeController = null;
    },
  };
}

const SAFE_PLAN_STATUSES = new Set<SafeJourneyPlanStatus>([
  "confirmed",
  "check_details",
  "unavailable",
  "updates_unavailable",
]);
const SAFE_LEG_TYPES = new Set<SafeJourneyLeg["type"]>([
  "walk",
  "wait",
  "ride",
  "transfer",
]);
const SAFE_ACCESSIBILITY_STATES = new Set<SafeJourneyLeg["accessibility"]["state"]>([
  "confirmed",
  "unknown",
  "blocked",
]);
const SAFE_SOURCES = new Set<SafeJourneySource["source"]>([
  "schedule",
  "arrivals",
  "vehicles",
  "service_changes",
  "stop_changes",
  "elevators",
  "station_access",
]);
const SAFE_SOURCE_URL_PAIRS = new Set([
  "schedule\u0000https://511.org/open-data/transit",
  "arrivals\u0000https://511.org/open-data/transit",
  "vehicles\u0000https://511.org/open-data/transit",
  "service_changes\u0000https://511.org/open-data/transit",
  "service_changes\u0000https://www.sfmta.com/travel-transit-updates?field_transit_type_disrupted_value=Accessibility",
  "stop_changes\u0000https://www.sfmta.com/travel-updates/temporary-stop-relocations",
  "elevators\u0000https://www.sfmta.com/elevator-status/elevatorstatus.php?src=prod",
  "station_access\u0000https://www.sfmta.com/getting-around/sfmta-accessibility/muni-access-guide/access-muni-metro/muni-metro-accessible-stops",
]);
const SAFE_FRESHNESS = new Set<SafeJourneySource["freshness"]>([
  "current",
  "older",
  "unavailable",
]);

function safeDuration(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= 24 * 60
  );
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
  const offsetHour = Number(match[10] ?? "0");
  const offsetMinute = Number(match[11] ?? "0");
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

function safeNullableIsoTimestamp(value: unknown): value is string | null {
  return value === null || safeIsoTimestamp(value);
}

function safeGeoJsonLine(value: unknown): value is SafeJourneyLeg["geometry"] {
  if (!record(value) || value.type !== "LineString" || !Array.isArray(value.coordinates)) {
    return false;
  }
  return (
    value.coordinates.length >= 2 &&
    value.coordinates.length <= MAX_GEOMETRY_POINTS &&
    value.coordinates.every((coordinate) => safeCoordinatePair(coordinate))
  );
}

function safeGeoJsonPoint(value: unknown): value is { type: "Point"; coordinates: [number, number] } {
  return record(value) && value.type === "Point" && safeCoordinatePair(value.coordinates);
}

function normalizeJourneyLeg(value: unknown): SafeJourneyLeg | null {
  if (!record(value)) return null;
  if (
    !SAFE_LEG_TYPES.has(value.type as SafeJourneyLeg["type"]) ||
    !safeText(value.from, MAX_PLAN_TEXT) ||
    !safeText(value.to, MAX_PLAN_TEXT) ||
    !safeIsoTimestamp(value.startAt) ||
    !safeIsoTimestamp(value.endAt) ||
    !safeDuration(value.durationMinutes) ||
    !safeText(value.instruction, MAX_PLAN_TEXT) ||
    !safeGeoJsonLine(value.geometry) ||
    !record(value.accessibility) ||
    !SAFE_ACCESSIBILITY_STATES.has(
      value.accessibility.state as SafeJourneyLeg["accessibility"]["state"],
    ) ||
    !Array.isArray(value.accessibility.reasons) ||
    value.accessibility.reasons.length > MAX_ACCESSIBILITY_REASONS ||
    !value.accessibility.reasons.every((reason) =>
      safeText(reason, MAX_REASON_TEXT),
    )
  ) {
    return null;
  }
  const type = value.type as SafeJourneyLeg["type"];
  const from = value.from as string;
  const to = value.to as string;
  const startAt = value.startAt as string;
  const endAt = value.endAt as string;
  const instruction = value.instruction as string;
  const geometry = value.geometry as SafeJourneyLeg["geometry"];
  const accessibility = value.accessibility as SafeJourneyLeg["accessibility"];
  let route: SafeJourneyLeg["route"];
  if (value.route !== undefined) {
    if (
      !record(value.route) ||
      !safeText(value.route.id, MAX_ROUTE_TEXT) ||
      !safeText(value.route.name, MAX_PLAN_TEXT) ||
      !safeText(value.route.color, 32) ||
      !safeText(value.route.destination, MAX_PLAN_TEXT)
    ) {
      return null;
    }
    route = {
      id: value.route.id as string,
      name: value.route.name as string,
      color: value.route.color as string,
      destination: value.route.destination as string,
    };
  }
  return {
    type,
    from,
    to,
    startAt,
    endAt,
    durationMinutes: value.durationMinutes,
    ...(route ? { route } : {}),
    instruction,
    geometry: {
      type: "LineString",
      coordinates: geometry.coordinates.map((coordinate) => [
        coordinate[0],
        coordinate[1],
      ]),
    },
    accessibility: {
      state: accessibility.state,
      reasons: [...accessibility.reasons],
    },
  };
}

function normalizeJourneySource(value: unknown): SafeJourneySource | null {
  if (!record(value)) return null;
  const source = value.source as SafeJourneySource["source"];
  const sourceUrl = typeof value.sourceUrl === "string" ? value.sourceUrl : "";
  if (
    !SAFE_SOURCES.has(source) ||
    !safeNullableIsoTimestamp(value.checkedAt) ||
    !safeNullableIsoTimestamp(value.sourceUpdatedAt) ||
    !SAFE_FRESHNESS.has(value.freshness as SafeJourneySource["freshness"]) ||
    !SAFE_SOURCE_URL_PAIRS.has(`${source}\u0000${sourceUrl}`)
  ) {
    return null;
  }
  const checkedAt = value.checkedAt as string | null;
  const sourceUpdatedAt = value.sourceUpdatedAt as string | null;
  const freshness = value.freshness as SafeJourneySource["freshness"];
  return {
    source,
    checkedAt,
    sourceUpdatedAt,
    freshness,
    sourceUrl,
  };
}

function normalizeJourneyMap(value: unknown): SafeJourneyMap | null {
  if (!record(value)) return null;
  if (
    !record(value.bounds) ||
    !finiteNumber(value.bounds.west) ||
    !finiteNumber(value.bounds.south) ||
    !finiteNumber(value.bounds.east) ||
    !finiteNumber(value.bounds.north) ||
    value.bounds.west < -180 ||
    value.bounds.west > 180 ||
    value.bounds.east < -180 ||
    value.bounds.east > 180 ||
    value.bounds.south < -90 ||
    value.bounds.south > 90 ||
    value.bounds.north < -90 ||
    value.bounds.north > 90 ||
    value.bounds.west > value.bounds.east ||
    value.bounds.south > value.bounds.north ||
    !safeGeoJsonPoint(value.origin) ||
    !safeGeoJsonPoint(value.destination) ||
    !record(value.affectedStops) ||
    value.affectedStops.type !== "FeatureCollection" ||
    !Array.isArray(value.affectedStops.features) ||
    value.affectedStops.features.length > MAX_MAP_FEATURES
  ) {
    return null;
  }
  const features: SafeJourneyMap["affectedStops"]["features"] = [];
  for (const feature of value.affectedStops.features) {
    if (
      !record(feature) ||
      feature.type !== "Feature" ||
      !safeGeoJsonPoint(feature.geometry) ||
      !record(feature.properties) ||
      !safeText(feature.properties.id, MAX_ROUTE_TEXT) ||
      !safeText(feature.properties.name, MAX_PLAN_TEXT) ||
      !SAFE_ACCESSIBILITY_STATES.has(
        feature.properties.accessibility as SafeJourneyLeg["accessibility"]["state"],
      )
    ) {
      return null;
    }
    const featureId = feature.properties.id as string;
    const featureName = feature.properties.name as string;
    const featureAccessibility =
      feature.properties.accessibility as SafeJourneyLeg["accessibility"]["state"];
    features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [feature.geometry.coordinates[0], feature.geometry.coordinates[1]],
      },
      properties: {
        id: featureId,
        name: featureName,
        accessibility: featureAccessibility,
      },
    });
  }
  return {
    bounds: {
      west: value.bounds.west,
      south: value.bounds.south,
      east: value.bounds.east,
      north: value.bounds.north,
    },
    origin: {
      type: "Point",
      coordinates: [value.origin.coordinates[0], value.origin.coordinates[1]],
    },
    destination: {
      type: "Point",
      coordinates: [
        value.destination.coordinates[0],
        value.destination.coordinates[1],
      ],
    },
    affectedStops: { type: "FeatureCollection", features },
  };
}

export function normalizeJourneyPlan(value: unknown): SafeJourneyPlan | null {
  if (!record(value)) return null;
  if (
    !SAFE_PLAN_STATUSES.has(value.status as SafeJourneyPlanStatus) ||
    !safeText(value.title, MAX_PLAN_TEXT) ||
    !safeText(value.summary, MAX_PLAN_TEXT) ||
    !safeIsoTimestamp(value.departureAt) ||
    !safeIsoTimestamp(value.arrivalAt) ||
    !safeDuration(value.durationMinutes) ||
    !Array.isArray(value.legs) ||
    value.legs.length > MAX_PLAN_LEGS ||
    !Array.isArray(value.warnings) ||
    value.warnings.length > MAX_PLAN_LIST_ITEMS ||
    !value.warnings.every((warning) => safeText(warning, MAX_PLAN_TEXT)) ||
    !Array.isArray(value.changes) ||
    value.changes.length > MAX_PLAN_LIST_ITEMS ||
    !value.changes.every((change) => safeText(change, MAX_PLAN_TEXT)) ||
    !Array.isArray(value.sources) ||
    value.sources.length > MAX_PLAN_SOURCES
  ) {
    return null;
  }
  const status = value.status as SafeJourneyPlanStatus;
  const title = value.title as string;
  const summary = value.summary as string;
  const departureAt = value.departureAt as string;
  const arrivalAt = value.arrivalAt as string;
  const legs = value.legs
    .map(normalizeJourneyLeg)
    .filter((leg): leg is SafeJourneyLeg => leg !== null);
  if (legs.length !== value.legs.length) return null;
  const sources = value.sources
    .map(normalizeJourneySource)
    .filter((source): source is SafeJourneySource => source !== null);
  if (sources.length !== value.sources.length) return null;
  const map = normalizeJourneyMap(value.map);
  if (!map) return null;
  return {
    status,
    title,
    summary,
    departureAt,
    arrivalAt,
    durationMinutes: value.durationMinutes,
    legs,
    warnings: [...value.warnings],
    changes: [...value.changes],
    sources,
    map,
  };
}

export function safePlainMessage(value: unknown): string | null {
  if (!safeText(value, MAX_ERROR_TEXT)) return null;
  return value as string;
}

export function safeResponseMessage(value: unknown): string | null {
  if (!record(value)) return null;
  return safePlainMessage(value.message);
}
