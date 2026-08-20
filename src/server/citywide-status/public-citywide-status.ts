import type {
  PublicElevator,
  PublicStation,
  RiderStationState,
} from "@/domain/accessibility/model";
import type { AccessibilityElevatorRead } from "@/server/journey/accessibility-elevator-read";
import {
  ACCESSIBILITY_ADVISORY_SOURCE_URL,
  type AccessibilityAdvisoryView,
} from "@/server/transit/accessibility-advisories";
import {
  STOP_ACCESSIBILITY_GUIDE_SOURCE_URL,
  type StopAccessibilityGuideView,
} from "@/server/transit/stop-accessibility-guides";
import {
  STOP_RELOCATION_SOURCE_URL,
  type StopRelocationView,
} from "@/server/transit/stop-relocations";

export const ELEVATOR_SOURCE_URL =
  "https://www.sfmta.com/elevator-status/elevatorstatus.php?src=prod" as const;
export const REALTIME_SOURCE_URL = "https://511.org/open-data/transit" as const;

export type PublicStatusState = "current" | "older" | "unavailable";

export type PublicRealtimeAlert = {
  entityId: string;
  header: string;
  effect: string | null;
  description: string | null;
  url: string | null;
  activePeriods: Array<{ startsAt: Date | null; endsAt: Date | null }>;
  informedEntities: Array<{
    agencyId: string | null;
    routeId: string | null;
    tripId: string | null;
    stopId: string | null;
  }>;
};

export type PublicRealtimeAlertsView = {
  state: PublicStatusState;
  checkedAt: Date | null;
  sourceUpdatedAt: Date | null;
  sourceUrl: typeof REALTIME_SOURCE_URL;
  alerts: PublicRealtimeAlert[];
};

export type PublicCitywideStatusReads = {
  /** The trusted elevator view with its collection/check time. */
  readElevators: (at: Date) => Promise<AccessibilityElevatorRead | null>;
  readAdvisories: (at: Date) => Promise<AccessibilityAdvisoryView>;
  readRelocations: (at: Date) => Promise<StopRelocationView>;
  readGuides: (at: Date) => Promise<StopAccessibilityGuideView>;
  readRealtimeAlerts: (at: Date) => Promise<PublicRealtimeAlertsView>;
};

export type PublicStatusElevator = Omit<PublicElevator, "sourceKey">;

export type PublicStatusStation = Omit<PublicStation, "elevators"> & {
  elevators: PublicStatusElevator[];
};

export type PublicStatusSection<T> = {
  state: PublicStatusState;
  checkedAt: Date | null;
  sourceUpdatedAt: Date | null;
  sourceUrl: string;
  summary: string;
  count: number;
  items: T[];
};

export type PublicElevatorStatusSection = Omit<
  PublicStatusSection<PublicStatusStation>,
  "items"
> & {
  /** Kept as `stations` to preserve the original public elevator semantics. */
  stations: PublicStatusStation[];
  counts: Record<RiderStationState, number>;
};

export type PublicAdvisoryItem = {
  title: string;
  affectedRoutes: string[];
  affectedStops: string[];
  publicUrl: string;
};

export type PublicRelocationItem = {
  stopName: string;
  routeNames: string[];
  temporaryStop: string;
  scheduleText: string;
  startsAt: Date;
  endsAt: Date;
  latitude: number | null;
  longitude: number | null;
  publicUrl: typeof STOP_RELOCATION_SOURCE_URL;
  boardingInstruction: string;
};

export type PublicGuideItem = {
  stationName: string;
  routeNames: string[];
  guidance: string;
  accessibilityState: "unknown";
  reviewed: true;
};

export type PublicAlertItem = {
  header: string;
  effect: string | null;
  routeIds: string[];
  stopIds: string[];
};

export type PublicCitywideStatusView = {
  elevators: PublicElevatorStatusSection;
  advisories: PublicStatusSection<PublicAdvisoryItem>;
  relocations: PublicStatusSection<PublicRelocationItem>;
  guides: PublicStatusSection<PublicGuideItem>;
  alerts: PublicStatusSection<PublicAlertItem>;
};

export type PublicCitywideStatusFilter = {
  query: string;
  type:
    "all" | "elevators" | "advisories" | "relocations" | "guides" | "alerts";
  state: "all" | PublicStatusState;
};

export interface PublicCitywideStatus {
  read(at: Date): Promise<PublicCitywideStatusView>;
}

const MAX_ITEMS = 100;
const MAX_TEXT = 300;
const MAX_ENTITY_TEXT = 100;
const UNAVAILABLE_SUMMARY = "Current information is unavailable.";
const OLDER_SUMMARY = "Older information is shown.";
const EMPTY_SUMMARY = "No current changes.";

function cloneDate(value: Date | null): Date | null {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
    return null;
  return new Date(value);
}

function state(value: unknown): PublicStatusState {
  return value === "current" || value === "older" || value === "unavailable"
    ? value
    : "unavailable";
}

function text(value: unknown, maximum = MAX_TEXT): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum ||
    value.trim() !== value ||
    /[<>\u0000-\u001f\u007f]/u.test(value)
  ) {
    return null;
  }
  return value;
}

function safeEntityList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) return [];
  const entities = value
    .map((item) => text(item, MAX_ENTITY_TEXT))
    .filter((item): item is string => item !== null);
  return [...new Set(entities)].sort((left, right) =>
    left.localeCompare(right),
  );
}

function safeSfmtaDetailUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 512) return null;
  try {
    const url = new URL(value);
    const decodedPath = decodeURIComponent(url.pathname);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "www.sfmta.com" ||
      url.port !== "" ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== "" ||
      !decodedPath.startsWith("/travel-updates/") ||
      decodedPath.endsWith("/") ||
      decodedPath.includes("\\") ||
      decodedPath.includes("//") ||
      decodedPath.split("/").includes("..") ||
      /[\u0000-\u001f\u007f]/u.test(decodedPath)
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function canonicalSourceUrl(expected: string): string {
  return expected;
}

function sectionSummary(
  stateValue: PublicStatusState,
  count: number,
  noun: string,
) {
  if (stateValue === "unavailable") return UNAVAILABLE_SUMMARY;
  if (stateValue === "older") return OLDER_SUMMARY;
  if (count === 0) return EMPTY_SUMMARY;
  return `${count} ${noun}${count === 1 ? "" : "s"}.`;
}

function unavailableSection<T>(sourceUrl: string): PublicStatusSection<T> {
  return {
    state: "unavailable",
    checkedAt: null,
    sourceUpdatedAt: null,
    sourceUrl,
    summary: UNAVAILABLE_SUMMARY,
    count: 0,
    items: [],
  };
}

function safeProjection<T>(project: () => T, fallback: T): T {
  try {
    return project();
  } catch {
    return fallback;
  }
}

function unavailableElevators(): PublicElevatorStatusSection {
  return {
    ...unavailableSection<PublicStatusStation>(ELEVATOR_SOURCE_URL),
    stations: [],
    counts: { accessible: 0, limited: 0, unavailable: 0, unknown: 0 },
  };
}

function elevatorStation(station: PublicStation): PublicStatusStation {
  const elevators: PublicStatusElevator[] = station.elevators
    .slice(0, MAX_ITEMS)
    .flatMap((elevator) => {
      const name = text(elevator.name);
      const role = text(elevator.role ?? "Elevator access");
      const alternativeName = elevator.alternativeName
        ? text(elevator.alternativeName)
        : null;
      if (!name || !role) return [];
      return [
        {
          name,
          state:
            elevator.state === "working" ||
            elevator.state === "out_of_service" ||
            elevator.state === "unknown"
              ? elevator.state
              : "unknown",
          lastChangedAt: cloneDate(elevator.lastChangedAt),
          role,
          alternativeName,
        },
      ];
    });
  const name = text(station.name) ?? "Station";
  const slug = text(station.slug, 160) ?? "station";
  const stationState: RiderStationState =
    station.state === "accessible" ||
    station.state === "limited" ||
    station.state === "unavailable" ||
    station.state === "unknown"
      ? station.state
      : "unknown";
  return {
    slug,
    name,
    corridorOrder: Number.isSafeInteger(station.corridorOrder)
      ? station.corridorOrder
      : Number.MAX_SAFE_INTEGER,
    state: stationState,
    elevators,
  };
}

function readElevatorSection(
  result: PromiseSettledResult<AccessibilityElevatorRead | null>,
): PublicElevatorStatusSection {
  if (result.status === "rejected" || !result.value)
    return unavailableElevators();
  const accessibility = result.value.accessibility;
  if (!accessibility || !Array.isArray(accessibility.stations)) {
    return unavailableElevators();
  }
  const stations = accessibility.stations
    .slice(0, MAX_ITEMS)
    .map(elevatorStation)
    .sort(
      (left, right) =>
        left.corridorOrder - right.corridorOrder ||
        left.name.localeCompare(right.name),
    );
  const counts: Record<RiderStationState, number> = {
    accessible: 0,
    limited: 0,
    unavailable: 0,
    unknown: 0,
  };
  for (const station of stations) counts[station.state] += 1;
  const currentState = state(accessibility.trust.state);
  const sourceUpdatedAt = cloneDate(accessibility.trust.sourceValidAt);
  const checked = cloneDate(result.value.checkedAt);
  if (currentState !== "unavailable" && !checked) return unavailableElevators();
  return {
    state: currentState,
    checkedAt: checked,
    sourceUpdatedAt,
    sourceUrl: canonicalSourceUrl(ELEVATOR_SOURCE_URL),
    summary: sectionSummary(currentState, stations.length, "station"),
    count: stations.length,
    stations,
    counts,
  };
}

function advisoryItems(view: AccessibilityAdvisoryView): PublicAdvisoryItem[] {
  return view.advisories.slice(0, MAX_ITEMS).flatMap((advisory) => {
    const title = text(advisory.title);
    const publicUrl = safeSfmtaDetailUrl(advisory.publicUrl);
    if (!title || !publicUrl) return [];
    return [
      {
        title,
        affectedRoutes: safeEntityList(advisory.affectedRoutes),
        affectedStops: safeEntityList(advisory.affectedStops),
        publicUrl,
      },
    ];
  });
}

function readAdvisorySection(
  result: PromiseSettledResult<AccessibilityAdvisoryView>,
): PublicStatusSection<PublicAdvisoryItem> {
  if (result.status === "rejected") {
    return unavailableSection(ACCESSIBILITY_ADVISORY_SOURCE_URL);
  }
  const view = result.value;
  const sourceState = state(view.state);
  const checkedAt = cloneDate(view.checkedAt);
  if (sourceState !== "unavailable" && !checkedAt)
    return unavailableSection(ACCESSIBILITY_ADVISORY_SOURCE_URL);
  const items = sourceState === "unavailable" ? [] : advisoryItems(view);
  return {
    state: sourceState,
    checkedAt,
    sourceUpdatedAt: cloneDate(view.sourceUpdatedAt),
    sourceUrl: canonicalSourceUrl(ACCESSIBILITY_ADVISORY_SOURCE_URL),
    summary: sectionSummary(
      sourceState,
      items.length,
      "accessibility advisory",
    ),
    count: items.length,
    items,
  };
}

function relocationItems(view: StopRelocationView): PublicRelocationItem[] {
  return view.relocations.slice(0, MAX_ITEMS).flatMap((relocation) => {
    const stopName = text(relocation.stopName);
    const routeNames = safeEntityList(relocation.routeNames);
    const temporaryStop = text(relocation.temporaryStop);
    const scheduleText = text(relocation.scheduleText);
    const boardingInstruction = text(relocation.boardingInstruction);
    const startsAt = cloneDate(relocation.startsAt);
    const endsAt = cloneDate(relocation.endsAt);
    if (
      !stopName ||
      routeNames.length === 0 ||
      !temporaryStop ||
      !scheduleText ||
      !boardingInstruction ||
      !startsAt ||
      !endsAt ||
      startsAt > endsAt
    ) {
      return [];
    }
    const latitude =
      typeof relocation.latitude === "number" &&
      Number.isFinite(relocation.latitude) &&
      relocation.latitude >= -90 &&
      relocation.latitude <= 90
        ? relocation.latitude
        : null;
    const longitude =
      typeof relocation.longitude === "number" &&
      Number.isFinite(relocation.longitude) &&
      relocation.longitude >= -180 &&
      relocation.longitude <= 180
        ? relocation.longitude
        : null;
    return [
      {
        stopName,
        routeNames,
        temporaryStop,
        scheduleText,
        startsAt,
        endsAt,
        latitude,
        longitude,
        publicUrl: STOP_RELOCATION_SOURCE_URL,
        boardingInstruction,
      },
    ];
  });
}

function readRelocationSection(
  result: PromiseSettledResult<StopRelocationView>,
): PublicStatusSection<PublicRelocationItem> {
  if (result.status === "rejected")
    return unavailableSection(STOP_RELOCATION_SOURCE_URL);
  const view = result.value;
  const sourceState = state(view.state);
  const checkedAt = cloneDate(view.checkedAt);
  if (sourceState !== "unavailable" && !checkedAt)
    return unavailableSection(STOP_RELOCATION_SOURCE_URL);
  const items = sourceState === "unavailable" ? [] : relocationItems(view);
  return {
    state: sourceState,
    checkedAt,
    sourceUpdatedAt: cloneDate(view.sourceUpdatedAt),
    sourceUrl: canonicalSourceUrl(STOP_RELOCATION_SOURCE_URL),
    summary: sectionSummary(sourceState, items.length, "moved stop"),
    count: items.length,
    items,
  };
}

function guideItems(view: StopAccessibilityGuideView): PublicGuideItem[] {
  return view.guides.slice(0, MAX_ITEMS).flatMap((guide) => {
    const stationName = text(guide.stationName);
    const routeNames = safeEntityList(guide.routeNames);
    const guidance = text(guide.guidance);
    if (!stationName || routeNames.length === 0 || !guidance) return [];
    return [
      {
        stationName,
        routeNames,
        guidance,
        accessibilityState: "unknown" as const,
        reviewed: true as const,
      },
    ];
  });
}

function readGuideSection(
  result: PromiseSettledResult<StopAccessibilityGuideView>,
): PublicStatusSection<PublicGuideItem> {
  if (result.status === "rejected") {
    return unavailableSection(STOP_ACCESSIBILITY_GUIDE_SOURCE_URL);
  }
  const view = result.value;
  const sourceState = state(view.state);
  const checkedAt = cloneDate(view.checkedAt);
  if (sourceState !== "unavailable" && !checkedAt)
    return unavailableSection(STOP_ACCESSIBILITY_GUIDE_SOURCE_URL);
  const items = sourceState === "unavailable" ? [] : guideItems(view);
  return {
    state: sourceState,
    checkedAt,
    sourceUpdatedAt: null,
    sourceUrl: canonicalSourceUrl(STOP_ACCESSIBILITY_GUIDE_SOURCE_URL),
    summary: sectionSummary(sourceState, items.length, "accessibility guide"),
    count: items.length,
    items,
  };
}

function alertItems(view: PublicRealtimeAlertsView): PublicAlertItem[] {
  return view.alerts.slice(0, MAX_ITEMS).flatMap((alert) => {
    const header = text(alert.header);
    const effect =
      alert.effect === null ? null : text(alert.effect, MAX_ENTITY_TEXT);
    if (!header || (alert.effect !== null && !effect)) return [];
    const routeIds = safeEntityList(
      alert.informedEntities.map((entity) => entity.routeId).filter(Boolean),
    );
    const stopIds = safeEntityList(
      alert.informedEntities.map((entity) => entity.stopId).filter(Boolean),
    );
    return [{ header, effect, routeIds, stopIds }];
  });
}

function readAlertSection(
  result: PromiseSettledResult<PublicRealtimeAlertsView>,
): PublicStatusSection<PublicAlertItem> {
  if (result.status === "rejected")
    return unavailableSection(REALTIME_SOURCE_URL);
  const view = result.value;
  const sourceState = state(view.state);
  const checkedAt = cloneDate(view.checkedAt);
  if (sourceState !== "unavailable" && !checkedAt)
    return unavailableSection(REALTIME_SOURCE_URL);
  const items = sourceState === "unavailable" ? [] : alertItems(view);
  return {
    state: sourceState,
    checkedAt,
    sourceUpdatedAt: cloneDate(view.sourceUpdatedAt),
    sourceUrl: canonicalSourceUrl(REALTIME_SOURCE_URL),
    summary: sectionSummary(sourceState, items.length, "service alert"),
    count: items.length,
    items,
  };
}

export function createPublicCitywideStatus(
  dependencies: PublicCitywideStatusReads,
): PublicCitywideStatus {
  return {
    async read(at) {
      const evaluatedAt = cloneDate(at);
      if (!evaluatedAt) {
        return {
          elevators: unavailableElevators(),
          advisories: unavailableSection(ACCESSIBILITY_ADVISORY_SOURCE_URL),
          relocations: unavailableSection(STOP_RELOCATION_SOURCE_URL),
          guides: unavailableSection(STOP_ACCESSIBILITY_GUIDE_SOURCE_URL),
          alerts: unavailableSection(REALTIME_SOURCE_URL),
        };
      }

      // Keep each source behind its own internal seam: a rejected read is
      // reduced to that source's unavailable section below and never prevents
      // another source from being published.
      const [
        elevatorResult,
        advisoryResult,
        relocationResult,
        guideResult,
        alertResult,
      ] = await Promise.allSettled([
        dependencies.readElevators(new Date(evaluatedAt)),
        dependencies.readAdvisories(new Date(evaluatedAt)),
        dependencies.readRelocations(new Date(evaluatedAt)),
        dependencies.readGuides(new Date(evaluatedAt)),
        dependencies.readRealtimeAlerts(new Date(evaluatedAt)),
      ]);

      return {
        elevators: safeProjection(
          () => readElevatorSection(elevatorResult),
          unavailableElevators(),
        ),
        advisories: safeProjection(
          () => readAdvisorySection(advisoryResult),
          unavailableSection(ACCESSIBILITY_ADVISORY_SOURCE_URL),
        ),
        relocations: safeProjection(
          () => readRelocationSection(relocationResult),
          unavailableSection(STOP_RELOCATION_SOURCE_URL),
        ),
        guides: safeProjection(
          () => readGuideSection(guideResult),
          unavailableSection(STOP_ACCESSIBILITY_GUIDE_SOURCE_URL),
        ),
        alerts: safeProjection(
          () => readAlertSection(alertResult),
          unavailableSection(REALTIME_SOURCE_URL),
        ),
      };
    },
  };
}
