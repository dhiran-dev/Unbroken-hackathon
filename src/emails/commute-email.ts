import type {
  SafeJourneyPlan,
  SafeJourneyPlanStatus,
  SafeJourneySource,
} from "@/domain/journey/citywide-journey-form";
import type { JourneyChangeSummary } from "@/domain/notifications/journey-changes";
import { formatPacific } from "@/lib/format";

/** Labels resolved by the authenticated commute adapter before rendering. */
export type CommuteEmailScheduleLabels = {
  originLabel: string;
  destinationLabel: string;
  departureLabel: string;
  arrivalLabel: string;
};

/**
 * The deliberately small, pure email seam. It accepts already-safe journey
 * and change projections; it never looks up a rider, place, source, or URL.
 */
export type CommuteEmailInput = {
  schedule: CommuteEmailScheduleLabels;
  plan: SafeJourneyPlan;
  changes: JourneyChangeSummary;
  manageUrl: string;
  /** The configured public HTTPS origin used to validate the manage link. */
  appOrigin: string;
};

export type CommuteEmail = {
  subject: string;
  html: string;
  text: string;
};

const STATUS_LABELS: Record<SafeJourneyPlanStatus, string> = {
  confirmed: "Step-free details confirmed",
  check_details: "Some details need checking",
  unavailable: "No step-free route confirmed",
  updates_unavailable: "Current updates are unavailable",
};

const LEG_LABELS: Record<SafeJourneyPlan["legs"][number]["type"], string> = {
  walk: "Walk",
  wait: "Wait",
  ride: "Ride",
  transfer: "Transfer",
};

const ACCESSIBILITY_LABELS: Record<
  SafeJourneyPlan["legs"][number]["accessibility"]["state"],
  string
> = {
  confirmed: "Step-free details confirmed",
  unknown: "Some details need checking",
  blocked: "No step-free route confirmed",
};

const SOURCE_LABELS: Record<SafeJourneySource["source"], string> = {
  schedule: "Muni schedule",
  arrivals: "Arrival updates",
  vehicles: "Vehicle locations",
  service_changes: "Service changes",
  stop_changes: "Stop changes",
  elevators: "Elevators",
  station_access: "Station access",
};

const SAFE_SOURCE_URLS: Readonly<
  Record<SafeJourneySource["source"], readonly string[]>
> = {
  schedule: ["https://511.org/open-data/transit"],
  arrivals: ["https://511.org/open-data/transit"],
  vehicles: ["https://511.org/open-data/transit"],
  service_changes: [
    "https://511.org/open-data/transit",
    "https://www.sfmta.com/travel-transit-updates?field_transit_type_disrupted_value=Accessibility",
  ],
  stop_changes: [
    "https://www.sfmta.com/travel-updates/temporary-stop-relocations",
  ],
  elevators: [
    "https://www.sfmta.com/elevator-status/elevatorstatus.php?src=prod",
  ],
  station_access: [
    "https://www.sfmta.com/getting-around/sfmta-accessibility/muni-access-guide/access-muni-metro/muni-metro-accessible-stops",
  ],
};

const SAFE_MANAGE_HASHES = new Set(["", "#first-trip", "#return-trip"]);

const MAX_LABEL_LENGTH = 180;
const MAX_BODY_ITEM_LENGTH = 180;
const MAX_LEGS = 12;
const MAX_PLAN_LEGS = 32;
const MAX_CHANGES_PER_SECTION = 6;
const MAX_PLAN_LIST_ITEMS = 64;
const MAX_SOURCES = 7;
const MAX_PLAN_TEXT_LENGTH = 1_000;
const MAX_ROUTE_TEXT_LENGTH = 160;
const MAX_REASON_TEXT_LENGTH = 300;
const MAX_ACCESSIBILITY_REASONS = 16;
const MAX_MAP_FEATURES = 64;
const MAX_GEOMETRY_POINTS = 8_192;
const ISO_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/u;

/** Words that belong to the implementation, not to a rider email. */
const INTERNAL_WORDS =
  /\b(?:fingerprint|reason|provider|outbox|queue|worker|collector|gtfs|otp|graphql|schema|protobuf|job|token|secret|operational)\b/iu;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cleanText(value: unknown, maximum: number): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, maximum)
    .trim();
}

function riderText(
  value: unknown,
  fallback: string,
  maximum = MAX_BODY_ITEM_LENGTH,
) {
  const text = cleanText(value, maximum);
  return text.length > 0 && !INTERNAL_WORDS.test(text) ? text : fallback;
}

function label(value: unknown, fallback: string) {
  return riderText(value, fallback, MAX_LABEL_LENGTH);
}

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/gu,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character]!,
  );
}

function safeDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function timeLabel(value: unknown) {
  const date = safeDate(value);
  return date ? formatPacific(date) : "Unavailable";
}

function safeManageUrl(manageUrl: unknown, appOrigin: unknown): string | null {
  if (typeof manageUrl !== "string" || typeof appOrigin !== "string") {
    return null;
  }
  try {
    const configured = new URL(appOrigin);
    const candidate = new URL(manageUrl);
    if (
      configured.protocol !== "https:" ||
      candidate.protocol !== "https:" ||
      configured.origin !== candidate.origin ||
      configured.pathname !== "/" ||
      configured.username ||
      configured.password ||
      configured.search ||
      configured.hash ||
      candidate.pathname !== "/rider/trips" ||
      candidate.search ||
      candidate.username ||
      candidate.password ||
      !SAFE_MANAGE_HASHES.has(candidate.hash)
    ) {
      return null;
    }
    return candidate.toString();
  } catch {
    return null;
  }
}

function safeOfficialUrl(source: SafeJourneySource): string | null {
  const allowed = SAFE_SOURCE_URLS[source.source];
  if (!allowed?.includes(source.sourceUrl)) return null;
  try {
    const url = new URL(source.sourceUrl);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function sectionItems(
  changes: JourneyChangeSummary,
  title: "What changed" | "What is working" | "What needs checking",
  fallback: string,
) {
  const section = Array.isArray(changes?.sections)
    ? changes.sections.find((item) => item?.title === title)
    : undefined;
  const items = Array.isArray(section?.items)
    ? section.items
        .slice(0, MAX_CHANGES_PER_SECTION)
        .map((item) => riderText(item, fallback))
    : [];
  return items.length > 0 ? items : [fallback];
}

function changedItems(changes: JourneyChangeSummary) {
  return sectionItems(
    changes,
    "What changed",
    "No changes to your journey.",
  ).filter((item) => item !== "No changes to your journey.");
}

function subjectFor(
  schedule: CommuteEmailScheduleLabels,
  plan: SafeJourneyPlan,
  changes: JourneyChangeSummary,
) {
  if (plan.status !== "confirmed") {
    return "We couldn't confirm today's step-free route";
  }
  const departure = label(schedule.departureLabel, "usual");
  const changed = changedItems(changes).length;
  if (changed > 0) {
    const count = changed === 1 ? "one" : String(changed);
    return `Your ${departure} trip has ${count} change${changed === 1 ? "" : "s"}`;
  }
  return `Your ${departure} trip is unchanged`;
}

const SAFE_PLAN_STATUSES = new Set<SafeJourneyPlanStatus>([
  "confirmed",
  "check_details",
  "unavailable",
  "updates_unavailable",
]);
const SAFE_LEG_TYPES = new Set<SafeJourneyPlan["legs"][number]["type"]>([
  "walk",
  "wait",
  "ride",
  "transfer",
]);
const SAFE_ACCESSIBILITY_STATES = new Set<
  SafeJourneyPlan["legs"][number]["accessibility"]["state"]
>(["confirmed", "unknown", "blocked"]);
const SAFE_FRESHNESS = new Set<SafeJourneySource["freshness"]>([
  "current",
  "older",
  "unavailable",
]);
const SAFE_SOURCE_NAMES = new Set<SafeJourneySource["source"]>([
  "schedule",
  "arrivals",
  "vehicles",
  "service_changes",
  "stop_changes",
  "elevators",
  "station_access",
]);

function boundedString(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const text = cleanText(value, maximum);
  return text.length > 0 && text.length <= maximum ? text : null;
}

function strictTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = ISO_TIMESTAMP_PATTERN.exec(value);
  if (!match) return null;
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
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : value;
}

function nullableTimestamp(value: unknown): string | null | undefined {
  if (value === null) return null;
  return strictTimestamp(value) ?? undefined;
}

function finiteCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function coordinatePair(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    finiteCoordinate(value[0]) &&
    finiteCoordinate(value[1])
  );
}

function normalizeGeometry(
  value: unknown,
): SafeJourneyPlan["legs"][number]["geometry"] | null {
  if (
    !isRecord(value) ||
    value.type !== "LineString" ||
    !Array.isArray(value.coordinates)
  ) {
    return null;
  }
  if (
    value.coordinates.length < 2 ||
    value.coordinates.length > MAX_GEOMETRY_POINTS ||
    !value.coordinates.every(coordinatePair)
  ) {
    return null;
  }
  return {
    type: "LineString",
    coordinates: value.coordinates.map((coordinate) => [
      coordinate[0],
      coordinate[1],
    ]),
  };
}

function normalizeLeg(value: unknown): SafeJourneyPlan["legs"][number] | null {
  if (!isRecord(value) || !SAFE_LEG_TYPES.has(value.type as never)) return null;
  const from = boundedString(value.from, MAX_PLAN_TEXT_LENGTH);
  const to = boundedString(value.to, MAX_PLAN_TEXT_LENGTH);
  const startAt = strictTimestamp(value.startAt);
  const endAt = strictTimestamp(value.endAt);
  const instruction = boundedString(value.instruction, MAX_PLAN_TEXT_LENGTH);
  const durationMinutes = value.durationMinutes;
  const accessibility = value.accessibility;
  const geometry = normalizeGeometry(value.geometry);
  if (
    !from ||
    !to ||
    !startAt ||
    !endAt ||
    !instruction ||
    !geometry ||
    typeof durationMinutes !== "number" ||
    !Number.isSafeInteger(durationMinutes) ||
    durationMinutes < 0 ||
    durationMinutes > 24 * 60 ||
    !isRecord(accessibility) ||
    !SAFE_ACCESSIBILITY_STATES.has(accessibility.state as never) ||
    !Array.isArray(accessibility.reasons) ||
    accessibility.reasons.length > MAX_ACCESSIBILITY_REASONS
  ) {
    return null;
  }
  const reasons = accessibility.reasons.map((reason) =>
    boundedString(reason, MAX_REASON_TEXT_LENGTH),
  );
  if (reasons.some((reason) => reason === null)) return null;

  let route: SafeJourneyPlan["legs"][number]["route"];
  if (value.route !== undefined) {
    if (!isRecord(value.route)) return null;
    const id = boundedString(value.route.id, MAX_ROUTE_TEXT_LENGTH);
    const name = boundedString(value.route.name, MAX_PLAN_TEXT_LENGTH);
    const color = boundedString(value.route.color, 32);
    const destination = boundedString(
      value.route.destination,
      MAX_PLAN_TEXT_LENGTH,
    );
    if (!id || !name || !color || !destination) return null;
    route = { id, name, color, destination };
  }

  return {
    type: value.type as SafeJourneyPlan["legs"][number]["type"],
    from,
    to,
    startAt,
    endAt,
    durationMinutes,
    ...(route ? { route } : {}),
    instruction,
    geometry,
    accessibility: {
      state:
        accessibility.state as SafeJourneyPlan["legs"][number]["accessibility"]["state"],
      reasons: reasons as string[],
    },
  };
}

function normalizeSource(value: unknown): SafeJourneySource | null {
  if (!isRecord(value)) return null;
  const sourceValue = value.source;
  if (
    typeof sourceValue !== "string" ||
    !SAFE_SOURCE_NAMES.has(sourceValue as SafeJourneySource["source"])
  ) {
    return null;
  }
  const source = sourceValue as SafeJourneySource["source"];
  const sourceUrl = value.sourceUrl;
  const checkedAt = nullableTimestamp(value.checkedAt);
  const sourceUpdatedAt = nullableTimestamp(value.sourceUpdatedAt);
  if (
    !SOURCE_LABELS[source] ||
    typeof sourceUrl !== "string" ||
    !SAFE_SOURCE_URLS[source]?.includes(sourceUrl) ||
    checkedAt === undefined ||
    sourceUpdatedAt === undefined ||
    !SAFE_FRESHNESS.has(value.freshness as never)
  ) {
    return null;
  }
  return {
    source,
    checkedAt,
    sourceUpdatedAt,
    freshness: value.freshness as SafeJourneySource["freshness"],
    sourceUrl,
  };
}

function normalizeMap(value: unknown): SafeJourneyPlan["map"] | null {
  if (!isRecord(value) || !isRecord(value.bounds)) return null;
  const bounds = value.bounds;
  if (
    !finiteCoordinate(bounds.west) ||
    !finiteCoordinate(bounds.south) ||
    !finiteCoordinate(bounds.east) ||
    !finiteCoordinate(bounds.north) ||
    !isRecord(value.origin) ||
    value.origin.type !== "Point" ||
    !coordinatePair(value.origin.coordinates) ||
    !isRecord(value.destination) ||
    value.destination.type !== "Point" ||
    !coordinatePair(value.destination.coordinates) ||
    !isRecord(value.affectedStops) ||
    value.affectedStops.type !== "FeatureCollection" ||
    !Array.isArray(value.affectedStops.features) ||
    value.affectedStops.features.length > MAX_MAP_FEATURES
  ) {
    return null;
  }
  const features = value.affectedStops.features.map((feature) => {
    if (
      !isRecord(feature) ||
      feature.type !== "Feature" ||
      !isRecord(feature.geometry) ||
      feature.geometry.type !== "Point" ||
      !coordinatePair(feature.geometry.coordinates) ||
      !isRecord(feature.properties) ||
      typeof feature.properties.id !== "string" ||
      typeof feature.properties.name !== "string" ||
      !SAFE_ACCESSIBILITY_STATES.has(feature.properties.accessibility as never)
    ) {
      return null;
    }
    const id = boundedString(feature.properties.id, MAX_ROUTE_TEXT_LENGTH);
    const name = boundedString(feature.properties.name, MAX_PLAN_TEXT_LENGTH);
    if (!id || !name) return null;
    return {
      type: "Feature" as const,
      geometry: {
        type: "Point" as const,
        coordinates: [
          feature.geometry.coordinates[0],
          feature.geometry.coordinates[1],
        ] as [number, number],
      },
      properties: {
        id,
        name,
        accessibility: feature.properties
          .accessibility as SafeJourneyPlan["legs"][number]["accessibility"]["state"],
      },
    };
  });
  if (features.some((feature) => feature === null)) return null;
  return {
    bounds: {
      west: bounds.west as number,
      south: bounds.south as number,
      east: bounds.east as number,
      north: bounds.north as number,
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
    affectedStops: {
      type: "FeatureCollection",
      features: features as NonNullable<(typeof features)[number]>[],
    },
  };
}

function emptyMap(): SafeJourneyPlan["map"] {
  return {
    bounds: { west: -122.58, south: 37.68, east: -122.31, north: 37.86 },
    origin: { type: "Point", coordinates: [-122.42, 37.75] },
    destination: { type: "Point", coordinates: [-122.42, 37.75] },
    affectedStops: { type: "FeatureCollection", features: [] },
  };
}

function unavailablePlan(): SafeJourneyPlan {
  return {
    status: "updates_unavailable",
    title: "Current updates are unavailable",
    summary: "Current journey details are unavailable right now.",
    departureAt: "2026-01-01T00:00:00.000Z",
    arrivalAt: "2026-01-01T00:00:00.000Z",
    durationMinutes: 0,
    legs: [],
    warnings: [],
    changes: [],
    sources: [],
    map: emptyMap(),
  };
}

function normalizePlan(value: unknown): SafeJourneyPlan | null {
  if (!isRecord(value)) return null;
  const status = value.status as SafeJourneyPlanStatus;
  const title = boundedString(value.title, MAX_PLAN_TEXT_LENGTH);
  const summary = boundedString(value.summary, MAX_PLAN_TEXT_LENGTH);
  const departureAt = strictTimestamp(value.departureAt);
  const arrivalAt = strictTimestamp(value.arrivalAt);
  const durationMinutes = value.durationMinutes;
  const legs = value.legs;
  const warnings = value.warnings;
  const changes = value.changes;
  const sources = value.sources;
  const map = normalizeMap(value.map);
  if (
    !SAFE_PLAN_STATUSES.has(status) ||
    !title ||
    !summary ||
    !departureAt ||
    !arrivalAt ||
    typeof durationMinutes !== "number" ||
    !Number.isSafeInteger(durationMinutes) ||
    durationMinutes < 0 ||
    durationMinutes > 24 * 60 ||
    !Array.isArray(legs) ||
    legs.length > MAX_PLAN_LEGS ||
    !Array.isArray(warnings) ||
    warnings.length > MAX_PLAN_LIST_ITEMS ||
    !warnings.every((warning) =>
      boundedString(warning, MAX_PLAN_TEXT_LENGTH),
    ) ||
    !Array.isArray(changes) ||
    changes.length > MAX_PLAN_LIST_ITEMS ||
    !changes.every((change) => boundedString(change, MAX_PLAN_TEXT_LENGTH)) ||
    !Array.isArray(sources) ||
    sources.length > MAX_SOURCES ||
    !map
  ) {
    return null;
  }
  const normalizedLegs = legs.map(normalizeLeg);
  const normalizedSources = sources.map(normalizeSource);
  if (
    normalizedLegs.some((leg) => leg === null) ||
    normalizedSources.some((source) => source === null)
  ) {
    return null;
  }
  return {
    status,
    title,
    summary,
    departureAt,
    arrivalAt,
    durationMinutes,
    legs: normalizedLegs.slice(0, MAX_LEGS) as NonNullable<
      (typeof normalizedLegs)[number]
    >[],
    warnings: warnings as string[],
    changes: changes as string[],
    sources: normalizedSources as NonNullable<
      (typeof normalizedSources)[number]
    >[],
    map,
  };
}

function normalizeSchedule(value: unknown): CommuteEmailScheduleLabels {
  const schedule = isRecord(value) ? value : {};
  return {
    originLabel:
      cleanText(schedule.originLabel, MAX_LABEL_LENGTH) ||
      "your starting place",
    destinationLabel:
      cleanText(schedule.destinationLabel, MAX_LABEL_LENGTH) ||
      "your destination",
    departureLabel:
      cleanText(schedule.departureLabel, MAX_LABEL_LENGTH) || "usual",
    arrivalLabel:
      cleanText(schedule.arrivalLabel, MAX_LABEL_LENGTH) || "Unavailable",
  };
}

function defaultChanges(): JourneyChangeSummary {
  return {
    sections: [
      { title: "What changed", items: ["No changes to your journey."] },
      { title: "What is working", items: [] },
      {
        title: "What needs checking",
        items: ["Current journey details need checking."],
      },
    ],
  };
}

function normalizeChanges(value: unknown): JourneyChangeSummary {
  if (
    !isRecord(value) ||
    !Array.isArray(value.sections) ||
    value.sections.length !== 3
  ) {
    return defaultChanges();
  }
  const titles = [
    "What changed",
    "What is working",
    "What needs checking",
  ] as const;
  const sections = value.sections.map((section, index) => {
    if (
      !isRecord(section) ||
      section.title !== titles[index] ||
      !Array.isArray(section.items) ||
      section.items.length > MAX_PLAN_LIST_ITEMS
    ) {
      return null;
    }
    const items = section.items
      .slice(0, MAX_CHANGES_PER_SECTION)
      .map((item) => boundedString(item, MAX_BODY_ITEM_LENGTH));
    return items.every((item): item is string => item !== null)
      ? { title: titles[index], items }
      : null;
  });
  if (sections.some((section) => section === null)) return defaultChanges();
  return { sections: sections as JourneyChangeSummary["sections"] };
}

function normalizeInput(value: unknown): CommuteEmailInput {
  const input = isRecord(value) ? value : {};
  return {
    schedule: normalizeSchedule(input.schedule),
    plan: normalizePlan(input.plan) ?? unavailablePlan(),
    changes: normalizeChanges(input.changes),
    manageUrl: typeof input.manageUrl === "string" ? input.manageUrl : "",
    appOrigin: typeof input.appOrigin === "string" ? input.appOrigin : "",
  };
}

function renderSummary(
  schedule: CommuteEmailScheduleLabels,
  plan: SafeJourneyPlan,
) {
  const origin = label(schedule.originLabel, "your starting place");
  const destination = label(schedule.destinationLabel, "your destination");
  const departure = label(schedule.departureLabel, timeLabel(plan.departureAt));
  const arrival = label(schedule.arrivalLabel, timeLabel(plan.arrivalAt));
  const summary = riderText(
    plan.summary,
    "Journey details are available below.",
  );
  return {
    origin,
    destination,
    departure,
    arrival,
    status: STATUS_LABELS[plan.status] ?? "Some details need checking",
    summary,
  };
}

function renderStep(leg: SafeJourneyPlan["legs"][number], index: number) {
  const type = LEG_LABELS[leg.type] ?? "Step";
  const from = riderText(leg.from, "the previous place", MAX_LABEL_LENGTH);
  const to = riderText(leg.to, "the next place", MAX_LABEL_LENGTH);
  const instruction = riderText(leg.instruction, "Follow the signs.");
  const duration =
    typeof leg.durationMinutes === "number" &&
    Number.isSafeInteger(leg.durationMinutes) &&
    leg.durationMinutes >= 0
      ? `${leg.durationMinutes} minute${leg.durationMinutes === 1 ? "" : "s"}`
      : "an estimated time";
  const accessibility = ACCESSIBILITY_LABELS[leg.accessibility.state];
  return `${index + 1}. ${type} from ${from} to ${to}. ${instruction} (${duration}). ${accessibility}.`;
}

function renderSources(plan: SafeJourneyPlan) {
  const sources = Array.isArray(plan.sources)
    ? plan.sources.slice(0, MAX_SOURCES)
    : [];
  return sources
    .map((source) => {
      const safeSource = isRecord(source)
        ? (source as SafeJourneySource)
        : null;
      if (!safeSource || !SOURCE_LABELS[safeSource.source]) return null;
      const officialUrl = safeOfficialUrl(safeSource);
      const checked = timeLabel(safeSource.checkedAt);
      const sourceUpdated = safeDate(safeSource.sourceUpdatedAt)
        ? timeLabel(safeSource.sourceUpdatedAt)
        : null;
      return {
        label: SOURCE_LABELS[safeSource.source],
        officialUrl,
        checked,
        sourceUpdated,
        sourceUpdatedLabel: safeSource.sourceUrl.includes("www.sfmta.com/")
          ? "SFMTA updated at"
          : "Official source updated at",
      };
    })
    .filter((source): source is NonNullable<typeof source> => source !== null);
}

const DARK_CLIENT_STYLES = `
      :root { color-scheme: light dark; }
      @media (prefers-color-scheme: dark) {
        .email-shell { background-color:#111827 !important; color:#f9fafb !important; }
        .email-card { background-color:#1f2937 !important; color:#f9fafb !important; border-color:#4b5563 !important; }
        .email-muted { color:#d1d5db !important; }
        .email-link { color:#93c5fd !important; }
      }
    `;

function htmlList(items: readonly string[]) {
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function textList(items: readonly string[]) {
  return items.map((item) => `- ${item}`).join("\n");
}

/** Render one deterministic email without network, persistence, or provider state. */
export function buildCommuteEmail(input: CommuteEmailInput): CommuteEmail {
  const normalized = normalizeInput(input);
  const schedule = normalized.schedule;
  const plan = normalized.plan;
  const changes = normalized.changes;
  const summary = renderSummary(schedule, plan);
  const changed = sectionItems(
    changes,
    "What changed",
    "No changes to your journey.",
  );
  const working = sectionItems(
    changes,
    "What is working",
    "No step-free details are confirmed right now.",
  );
  const checking = sectionItems(
    changes,
    "What needs checking",
    "No additional details need checking.",
  );
  const legs = Array.isArray(plan.legs)
    ? plan.legs.slice(0, MAX_LEGS).map(renderStep)
    : [];
  const steps =
    legs.length > 0 ? legs : ["No journey steps are available right now."];
  const sources = renderSources(plan);
  const manageUrl = safeManageUrl(normalized.manageUrl, normalized.appOrigin);

  const sourceHtml = sources.length
    ? sources
        .map(
          (source) => `<li>
            <strong>${escapeHtml(source.label)}</strong>
            ${
              source.officialUrl
                ? `<a class="email-link" href="${escapeHtml(source.officialUrl)}" rel="noopener noreferrer">Official source</a>`
                : `<span class="email-muted">Official source unavailable</span>`
            }<br>
            <span><strong>Checked by UNBROKEN at</strong> ${escapeHtml(source.checked)}</span>
            ${
              source.sourceUpdated
                ? `<br><span><strong>${escapeHtml(source.sourceUpdatedLabel)}</strong> ${escapeHtml(source.sourceUpdated)}</span>`
                : ""
            }
          </li>`,
        )
        .join("")
    : `<li><strong>Checked by UNBROKEN at</strong> Unavailable</li>`;

  const sourceText = sources.length
    ? sources
        .map(
          (source) =>
            `${source.label}\n${source.officialUrl ? `Official source: ${source.officialUrl}` : "Official source unavailable"}\nChecked by UNBROKEN at ${source.checked}${source.sourceUpdated ? `\n${source.sourceUpdatedLabel} ${source.sourceUpdated}` : ""}`,
        )
        .join("\n\n")
    : "Checked by UNBROKEN at Unavailable";

  const manageHtml = manageUrl
    ? `<a class="email-link" href="${escapeHtml(manageUrl)}" rel="noopener noreferrer">Manage this trip</a>`
    : `<span>Manage this trip in My trips.</span>`;
  const manageText = manageUrl
    ? `Manage this trip: ${manageUrl}`
    : "Manage this trip in My trips.";

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>${DARK_CLIENT_STYLES}</style>
  </head>
  <body class="email-shell" style="margin:0;background-color:#ffffff;color:#17202a;font-family:Arial,sans-serif;line-height:1.5;">
    <main style="margin:0 auto;max-width:640px;padding:24px 16px;">
      <article class="email-card" style="background-color:#ffffff;border:1px solid #cbd5e1;border-radius:12px;color:#17202a;padding:24px;">
        <h1>Trip summary</h1>
        <p><strong>${escapeHtml(summary.status)}</strong></p>
        <p>${escapeHtml(summary.summary)}</p>
        <dl>
          <dt><strong>From</strong></dt><dd>${escapeHtml(summary.origin)}</dd>
          <dt><strong>To</strong></dt><dd>${escapeHtml(summary.destination)}</dd>
          <dt><strong>Planned departure</strong></dt><dd>${escapeHtml(summary.departure)}</dd>
          <dt><strong>Estimated arrival</strong></dt><dd>${escapeHtml(summary.arrival)}</dd>
        </dl>

        <h2>What changed</h2>
        ${htmlList(changed)}
        <h2>What is working</h2>
        ${htmlList(working)}
        <h2>What needs checking</h2>
        ${htmlList(checking)}

        <h2>Journey steps</h2>
        <ol>${steps.map((step) => `<li>${escapeHtml(step.replace(/^\d+\. /u, ""))}</li>`).join("")}</ol>

        <h2>Sources and times</h2>
        <ul>${sourceHtml}</ul>
        <p style="margin-top:24px;">${manageHtml}</p>
      </article>
    </main>
  </body>
</html>`;

  const text = `Trip summary
${summary.status}
${summary.summary}
From: ${summary.origin}
To: ${summary.destination}
Planned departure: ${summary.departure}
Estimated arrival: ${summary.arrival}

What changed
${textList(changed)}

What is working
${textList(working)}

What needs checking
${textList(checking)}

Journey steps
${steps.join("\n")}

Sources and times
${sourceText}

${manageText}`;

  return {
    subject: subjectFor(schedule, plan, changes),
    html,
    text,
  };
}
