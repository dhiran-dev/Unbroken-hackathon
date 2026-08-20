import {
  REVIEWED_STATION_TOPOLOGY,
  type ReviewedStationTopology,
} from "@/domain/accessibility/topology";
import type { RouteCandidate } from "@/domain/journey/route-engine";

export type AccessibilityState = "confirmed" | "unknown" | "blocked";
export type EvidenceFreshness = "current" | "older" | "unavailable";
export type EvidenceSourceName =
  | "elevators"
  | "service_changes"
  | "stop_changes"
  | "station_access"
  | "trip_updates"
  | "alerts";

export type AccessibilityReasonCode =
  | "ACCESSIBILITY_ADVISORY_ACTIVE"
  | "CURRENT_TIMING_UNCERTAIN"
  | "ELEVATOR_OUT_OF_SERVICE"
  | "ELEVATOR_STATUS_UNKNOWN"
  | "INVALID_CANDIDATE"
  | "MAPPED_PATH_UNCONFIRMED"
  | "SERVICE_ALERT_ACTIVE"
  | "SOURCE_OLDER"
  | "SOURCE_UNAVAILABLE"
  | "STATION_ACCESS_UNAVAILABLE"
  | "STOP_ACCESS_UNKNOWN"
  | "STOP_RELOCATION_ACTIVE"
  | "STOP_SKIPPED"
  | "TRIP_CANCELLED";

export type AccessibilityReason = {
  code: AccessibilityReasonCode;
  entityId: string;
};

export type EvidenceProvenance = {
  source: EvidenceSourceName;
  state: EvidenceFreshness;
  checkedAt: Date | null;
  sourceUpdatedAt: Date | null;
  sourceUrl: string;
};

type SourceEvidence = Omit<EvidenceProvenance, "source">;

export type ElevatorEvidence = {
  equipmentId: string;
  state: "working" | "out_of_service" | "unknown";
};

export type ElevatorStationEvidence = {
  stationId: string;
  state: "accessible" | "limited" | "unavailable" | "unknown";
  elevators: ElevatorEvidence[];
};

export type ExactAccessibilityAdvisory = {
  advisoryId: string;
  stopIds: string[];
  routeIds: string[];
  startsAt: Date | null;
  endsAt: Date | null;
};

export type ExactStopRelocation = {
  relocationId: string;
  stopId: string;
  routeIds: string[];
  temporaryStop: string;
  boardingInstruction: string;
  startsAt: Date;
  endsAt: Date;
};

export type AccessibilityRelocationDetail = {
  relocationId: string;
  role: "boarding" | "alighting";
  instruction: string;
};

export type ExactTripUpdate = {
  updateId: string;
  tripId: string;
  routeId: string | null;
  stopId: string | null;
  scheduleRelationship: string;
  arrivalDelaySeconds: number | null;
  departureDelaySeconds: number | null;
};

export type ExactServiceAlert = {
  alertId: string;
  effect: string | null;
  activePeriods: Array<{ startsAt: Date | null; endsAt: Date | null }>;
  informedEntities: Array<{
    agencyId: string | null;
    routeId: string | null;
    tripId: string | null;
    stopId: string | null;
  }>;
};

export type AccessibilityEvidenceSnapshot = {
  elevators: SourceEvidence & { stations: ElevatorStationEvidence[] };
  advisories: SourceEvidence & { advisories: ExactAccessibilityAdvisory[] };
  relocations: SourceEvidence & { relocations: ExactStopRelocation[] };
  guides: SourceEvidence;
  tripUpdates: SourceEvidence & { updates: ExactTripUpdate[] };
  alerts: SourceEvidence & { alerts: ExactServiceAlert[] };
};

export interface AccessibilityEvidenceSource {
  read(at: Date): Promise<AccessibilityEvidenceSnapshot>;
}

export type AccessibilityDependencyKind =
  | "mapped_path"
  | "stop_access"
  | "accessibility_advisory"
  | "stop_relocation"
  | "trip_operation"
  | "service_alert";

export type AccessibilityDependency = {
  kind: AccessibilityDependencyKind;
  state: AccessibilityState;
  reasons: AccessibilityReason[];
  relocations?: AccessibilityRelocationDetail[];
};

export type AccessibilityLegAssessment = {
  legIndex: number;
  type: RouteCandidate["legs"][number]["type"];
  state: AccessibilityState;
  delaySeconds: number;
  departureDelaySeconds: number;
  arrivalDelaySeconds: number;
  dependencies: AccessibilityDependency[];
};

export type AccessibilityAssessment = {
  candidateId: string;
  state: AccessibilityState;
  delaySeconds: number;
  legs: AccessibilityLegAssessment[];
  sources: EvidenceProvenance[];
};

export interface AccessibilityEvidence {
  evaluate(
    candidate: RouteCandidate,
    at: Date,
  ): Promise<AccessibilityAssessment>;
  evaluateCandidates?(
    candidates: readonly RouteCandidate[],
    at: Date,
  ): Promise<AccessibilityAssessment[]>;
}

type StationStop = { stationId: string; direction?: "eastbound" | "westbound" };

const REVIEWED_STATION_STOPS: Readonly<Record<string, StationStop>> = {
  "16992": { stationId: "embarcadero", direction: "eastbound" },
  "17217": { stationId: "embarcadero", direction: "westbound" },
  "15731": { stationId: "montgomery", direction: "eastbound" },
  "16994": { stationId: "montgomery", direction: "westbound" },
  "15417": { stationId: "powell", direction: "eastbound" },
  "16995": { stationId: "powell", direction: "westbound" },
  "15727": { stationId: "civic-center", direction: "eastbound" },
  "16997": { stationId: "civic-center", direction: "westbound" },
  "15419": { stationId: "van-ness", direction: "eastbound" },
  "16996": { stationId: "van-ness", direction: "westbound" },
  "15726": { stationId: "church", direction: "eastbound" },
  "16998": { stationId: "church", direction: "westbound" },
  "15728": { stationId: "castro", direction: "eastbound" },
  "16991": { stationId: "castro", direction: "westbound" },
  "15730": { stationId: "forest-hill", direction: "eastbound" },
  "16993": { stationId: "forest-hill", direction: "westbound" },
  "17876": { stationId: "chinatown-rose-pak" },
  "17874": { stationId: "union-square-market-street" },
  "17877": { stationId: "union-square-market-street" },
  "17873": { stationId: "yerba-buena-moscone" },
  "17878": { stationId: "yerba-buena-moscone" },
};

function stateOf(dependencies: readonly AccessibilityDependency[]) {
  if (dependencies.some((dependency) => dependency.state === "blocked")) {
    return "blocked" as const;
  }
  if (dependencies.some((dependency) => dependency.state === "unknown")) {
    return "unknown" as const;
  }
  return "confirmed" as const;
}

function reason(
  code: AccessibilityReasonCode,
  entityId: string,
): AccessibilityReason {
  return { code, entityId };
}

function freshnessDependency(
  kind: AccessibilityDependencyKind,
  source: SourceEvidence,
): AccessibilityDependency | null {
  if (source.state === "current") return null;
  return {
    kind,
    state: "unknown",
    reasons: [
      reason(
        source.state === "older" ? "SOURCE_OLDER" : "SOURCE_UNAVAILABLE",
        kind,
      ),
    ],
  };
}

type StopAccessContext = "platform" | "street_and_platform";

const CONNECTED_STREET_STATIONS = new Set([
  "powell",
  "union-square-market-street",
]);

function requiredGroups(
  topology: ReviewedStationTopology,
  stop: StationStop,
  context: StopAccessContext,
) {
  const groups: Array<{ alternatives: readonly string[] }> = [];
  const platform =
    topology.platform ??
    (stop.direction ? topology[stop.direction] : undefined);
  if (platform) groups.push(platform);
  if (context === "street_and_platform" && topology.street) {
    if (CONNECTED_STREET_STATIONS.has(stop.stationId)) {
      const alternatives = [
        ...(REVIEWED_STATION_TOPOLOGY.powell?.street?.alternatives ?? []),
        ...(REVIEWED_STATION_TOPOLOGY["union-square-market-street"]?.street
          ?.alternatives ?? []),
      ];
      groups.push({ alternatives: [...new Set(alternatives)] });
    } else {
      groups.push(topology.street);
    }
  }
  return groups;
}

function equipmentState(
  equipmentId: string,
  snapshot: AccessibilityEvidenceSnapshot,
) {
  for (const station of snapshot.elevators.stations) {
    const elevator = station.elevators.find(
      (candidate) => candidate.equipmentId === equipmentId,
    );
    if (!elevator) continue;
    if (station.state === "unknown") return "unknown" as const;
    if (station.state === "unavailable") {
      return "out_of_service" as const;
    }
    return elevator.state;
  }
  return "unknown" as const;
}

function stopAccess(
  stopId: string | null,
  context: StopAccessContext,
  snapshot: AccessibilityEvidenceSnapshot,
): AccessibilityDependency {
  if (!stopId) {
    return {
      kind: "stop_access",
      state: "unknown",
      reasons: [reason("STOP_ACCESS_UNKNOWN", "missing_stop_id")],
    };
  }
  const reviewed = REVIEWED_STATION_STOPS[stopId];
  if (!reviewed) {
    const guideFreshness = freshnessDependency("stop_access", snapshot.guides);
    if (guideFreshness) return guideFreshness;
    return {
      kind: "stop_access",
      state: "unknown",
      reasons: [reason("STOP_ACCESS_UNKNOWN", stopId)],
    };
  }
  const elevatorFreshness = freshnessDependency(
    "stop_access",
    snapshot.elevators,
  );
  if (elevatorFreshness) return elevatorFreshness;
  const station = snapshot.elevators.stations.find(
    (candidate) => candidate.stationId === reviewed.stationId,
  );
  if (!station || station.state === "unknown") {
    return {
      kind: "stop_access",
      state: "unknown",
      reasons: [reason("ELEVATOR_STATUS_UNKNOWN", reviewed.stationId)],
    };
  }
  if (station.state === "unavailable") {
    return {
      kind: "stop_access",
      state: "blocked",
      reasons: [reason("STATION_ACCESS_UNAVAILABLE", reviewed.stationId)],
    };
  }
  const topology = REVIEWED_STATION_TOPOLOGY[reviewed.stationId];
  const groups = topology ? requiredGroups(topology, reviewed, context) : [];
  if (groups.length === 0) {
    return {
      kind: "stop_access",
      state: "unknown",
      reasons: [reason("ELEVATOR_STATUS_UNKNOWN", reviewed.stationId)],
    };
  }
  for (const group of groups) {
    const states = group.alternatives.map((equipmentId) =>
      equipmentState(equipmentId, snapshot),
    );
    if (states.includes("working")) continue;
    if (states.every((state) => state === "out_of_service")) {
      return {
        kind: "stop_access",
        state: "blocked",
        reasons: group.alternatives.map((id) =>
          reason("ELEVATOR_OUT_OF_SERVICE", id),
        ),
      };
    }
    return {
      kind: "stop_access",
      state: "unknown",
      reasons: [reason("ELEVATOR_STATUS_UNKNOWN", reviewed.stationId)],
    };
  }
  return { kind: "stop_access", state: "confirmed", reasons: [] };
}

function intervalsOverlap(
  startsAt: Date | null,
  endsAt: Date | null,
  legStartsAt: Date,
  legEndsAt: Date,
) {
  return (
    (!startsAt || startsAt <= legEndsAt) && (!endsAt || endsAt >= legStartsAt)
  );
}

function sortedReasons(reasons: AccessibilityReason[]) {
  return [
    ...new Map(
      reasons.map((item) => [item.code + "\u0000" + item.entityId, item]),
    ).values(),
  ].sort(
    (left, right) =>
      left.code.localeCompare(right.code) ||
      left.entityId.localeCompare(right.entityId),
  );
}

function eventDependency(
  kind: AccessibilityDependencyKind,
  source: SourceEvidence,
  reasons: AccessibilityReason[],
) {
  const freshness = freshnessDependency(kind, source);
  if (freshness) return freshness;
  const unique = sortedReasons(reasons);
  return unique.length > 0
    ? { kind, state: "blocked" as const, reasons: unique }
    : { kind, state: "confirmed" as const, reasons: [] };
}

function endpointStopIds(
  leg: Extract<RouteCandidate["legs"][number], { type: "ride" }>,
) {
  return new Set(
    [leg.from.stopId, leg.to.stopId].filter((id): id is string => id !== null),
  );
}

function advisoryDependency(
  leg: Extract<RouteCandidate["legs"][number], { type: "ride" }>,
  snapshot: AccessibilityEvidenceSnapshot,
) {
  const stopIds = endpointStopIds(leg);
  return eventDependency(
    "accessibility_advisory",
    snapshot.advisories,
    snapshot.advisories.advisories
      .filter(
        (advisory) =>
          safeEntityId(advisory.advisoryId) &&
          intervalsOverlap(
            advisory.startsAt,
            advisory.endsAt,
            leg.startAt,
            leg.endAt,
          ) &&
          (advisory.routeIds.includes(leg.routeId) ||
            advisory.stopIds.some((stopId) => stopIds.has(stopId))),
      )
      .map((advisory) =>
        reason("ACCESSIBILITY_ADVISORY_ACTIVE", advisory.advisoryId),
      ),
  );
}

function relocationDependency(
  leg: Extract<RouteCandidate["legs"][number], { type: "ride" }>,
  snapshot: AccessibilityEvidenceSnapshot,
): AccessibilityDependency {
  const freshness = freshnessDependency(
    "stop_relocation",
    snapshot.relocations,
  );
  if (freshness) return freshness;
  const matches = snapshot.relocations.relocations.filter(
    (relocation) =>
      safeEntityId(relocation.relocationId) &&
      relocation.routeIds.includes(leg.routeId) &&
      (relocation.stopId === leg.from.stopId ||
        relocation.stopId === leg.to.stopId) &&
      intervalsOverlap(
        relocation.startsAt,
        relocation.endsAt,
        leg.startAt,
        leg.endAt,
      ),
  );
  const relocations = matches
    .map((relocation): AccessibilityRelocationDetail => {
      const boarding = relocation.stopId === leg.from.stopId;
      return {
        relocationId: relocation.relocationId,
        role: boarding ? "boarding" : "alighting",
        instruction: boarding
          ? relocation.boardingInstruction
          : `Get off at ${relocation.temporaryStop}.`,
      };
    })
    .sort(
      (left, right) =>
        left.role.localeCompare(right.role) ||
        left.relocationId.localeCompare(right.relocationId),
    );
  const reasons = sortedReasons(
    relocations.map((relocation) =>
      reason("STOP_RELOCATION_ACTIVE", relocation.relocationId),
    ),
  );
  return reasons.length > 0
    ? {
        kind: "stop_relocation",
        state: "unknown",
        reasons,
        relocations,
      }
    : {
        kind: "stop_relocation",
        state: "confirmed",
        reasons: [],
      };
}

const MAX_DELAY_SECONDS = 6 * 60 * 60;

function boundedDelay(value: number | null) {
  return Number.isSafeInteger(value) &&
    value !== null &&
    Math.abs(value) <= MAX_DELAY_SECONDS
    ? value
    : null;
}

function tripEvidence(
  leg: Extract<RouteCandidate["legs"][number], { type: "ride" }>,
  snapshot: AccessibilityEvidenceSnapshot,
) {
  const freshness = freshnessDependency("trip_operation", snapshot.tripUpdates);
  if (freshness) {
    return {
      dependency: freshness,
      departureDelaySeconds: 0,
      arrivalDelaySeconds: 0,
      delaySeconds: 0,
    };
  }
  const updates = snapshot.tripUpdates.updates.filter(
    (update) =>
      update.tripId === leg.tripId &&
      (update.routeId === null || update.routeId === leg.routeId),
  );
  const endpoints = endpointStopIds(leg);
  const reasons: AccessibilityReason[] = [];
  for (const update of updates) {
    if (
      update.scheduleRelationship === "CANCELED" ||
      update.scheduleRelationship === "DELETED"
    ) {
      reasons.push(reason("TRIP_CANCELLED", leg.tripId));
    } else if (
      update.scheduleRelationship === "SKIPPED" &&
      update.stopId !== null &&
      endpoints.has(update.stopId)
    ) {
      reasons.push(reason("STOP_SKIPPED", update.stopId));
    }
  }
  const maximumDelay = (
    candidates: ExactTripUpdate[],
    field: "arrivalDelaySeconds" | "departureDelaySeconds",
  ) => {
    const delays = candidates
      .map((update) => boundedDelay(update[field]))
      .filter((value): value is number => value !== null);
    return delays.length > 0 ? Math.max(...delays) : null;
  };
  const tripLevel = updates.filter((update) => update.stopId === null);
  const boarding = updates.filter(
    (update) => leg.from.stopId !== null && update.stopId === leg.from.stopId,
  );
  const alighting = updates.filter(
    (update) => leg.to.stopId !== null && update.stopId === leg.to.stopId,
  );
  const departureDelaySeconds =
    maximumDelay(boarding, "departureDelaySeconds") ??
    maximumDelay(tripLevel, "departureDelaySeconds") ??
    0;
  const endpointArrival =
    maximumDelay(alighting, "arrivalDelaySeconds") ??
    maximumDelay(tripLevel, "arrivalDelaySeconds");
  const arrivalDelaySeconds = endpointArrival ?? 0;
  return {
    dependency: eventDependency(
      "trip_operation",
      snapshot.tripUpdates,
      reasons,
    ),
    departureDelaySeconds,
    arrivalDelaySeconds,
    delaySeconds:
      endpointArrival === null ? departureDelaySeconds : arrivalDelaySeconds,
  };
}

const DISRUPTIVE_ALERT_EFFECTS = new Set([
  "ACCESSIBILITY_ISSUE",
  "DETOUR",
  "MODIFIED_SERVICE",
  "NO_SERVICE",
  "REDUCED_SERVICE",
  "SIGNIFICANT_DELAYS",
  "STOP_MOVED",
]);

function alertDependency(
  leg: Extract<RouteCandidate["legs"][number], { type: "ride" }>,
  snapshot: AccessibilityEvidenceSnapshot,
) {
  const stopIds = endpointStopIds(leg);
  const matchesEntity = (
    entity: ExactServiceAlert["informedEntities"][number],
  ) => {
    const agencyWide =
      entity.agencyId === "SF" &&
      entity.routeId === null &&
      entity.tripId === null &&
      entity.stopId === null;
    if (agencyWide) return true;
    if (entity.agencyId !== null && entity.agencyId !== "SF") return false;
    const identifierCount = [
      entity.routeId,
      entity.tripId,
      entity.stopId,
    ].filter((value) => value !== null).length;
    return (
      identifierCount > 0 &&
      (entity.routeId === null || entity.routeId === leg.routeId) &&
      (entity.tripId === null || entity.tripId === leg.tripId) &&
      (entity.stopId === null || stopIds.has(entity.stopId))
    );
  };
  return eventDependency(
    "service_alert",
    snapshot.alerts,
    snapshot.alerts.alerts
      .filter(
        (alert) =>
          safeEntityId(alert.alertId) &&
          alert.effect !== null &&
          DISRUPTIVE_ALERT_EFFECTS.has(alert.effect) &&
          (alert.activePeriods.length === 0 ||
            alert.activePeriods.some((period) =>
              intervalsOverlap(
                period.startsAt,
                period.endsAt,
                leg.startAt,
                leg.endAt,
              ),
            )) &&
          alert.informedEntities.some(matchesEntity),
      )
      .map((alert) => reason("SERVICE_ALERT_ACTIVE", alert.alertId)),
  );
}

function provenance(
  snapshot: AccessibilityEvidenceSnapshot,
): EvidenceProvenance[] {
  const entries: Array<[EvidenceSourceName, SourceEvidence]> = [
    ["elevators", snapshot.elevators],
    ["service_changes", snapshot.advisories],
    ["stop_changes", snapshot.relocations],
    ["station_access", snapshot.guides],
    ["trip_updates", snapshot.tripUpdates],
    ["alerts", snapshot.alerts],
  ];
  return entries.map(([source, value]) => ({
    source,
    state: value.state,
    checkedAt: value.checkedAt ? new Date(value.checkedAt) : null,
    sourceUpdatedAt: value.sourceUpdatedAt
      ? new Date(value.sourceUpdatedAt)
      : null,
    sourceUrl: value.sourceUrl,
  }));
}

const OFFICIAL_SOURCE_URLS = {
  elevators:
    "https://www.sfmta.com/elevator-status/elevatorstatus.php?src=prod",
  advisories:
    "https://www.sfmta.com/travel-transit-updates?field_transit_type_disrupted_value=Accessibility",
  relocations:
    "https://www.sfmta.com/travel-updates/temporary-stop-relocations",
  guides:
    "https://www.sfmta.com/getting-around/sfmta-accessibility/muni-access-guide/access-muni-metro/muni-metro-accessible-stops",
  realtime: "https://511.org/open-data/transit",
} as const;

function unavailableSource(sourceUrl: string): SourceEvidence {
  return {
    state: "unavailable",
    checkedAt: null,
    sourceUpdatedAt: null,
    sourceUrl,
  };
}

function unavailableSnapshot(): AccessibilityEvidenceSnapshot {
  return {
    elevators: {
      ...unavailableSource(OFFICIAL_SOURCE_URLS.elevators),
      stations: [],
    },
    advisories: {
      ...unavailableSource(OFFICIAL_SOURCE_URLS.advisories),
      advisories: [],
    },
    relocations: {
      ...unavailableSource(OFFICIAL_SOURCE_URLS.relocations),
      relocations: [],
    },
    guides: unavailableSource(OFFICIAL_SOURCE_URLS.guides),
    tripUpdates: {
      ...unavailableSource(OFFICIAL_SOURCE_URLS.realtime),
      updates: [],
    },
    alerts: {
      ...unavailableSource(OFFICIAL_SOURCE_URLS.realtime),
      alerts: [],
    },
  };
}

function safeEntityId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/u.test(value)
  );
}

function safeEvidenceText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 500 &&
    value === value.trim() &&
    !/[<>\u0000-\u001f\u007f]/u.test(value)
  );
}

function finiteDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validSourceShape(value: unknown, expectedUrl: string) {
  if (!isRecord(value)) return false;
  return (
    (value.state === "current" ||
      value.state === "older" ||
      value.state === "unavailable") &&
    (value.state !== "current" || finiteDate(value.checkedAt)) &&
    (value.checkedAt === null || finiteDate(value.checkedAt)) &&
    (value.sourceUpdatedAt === null || finiteDate(value.sourceUpdatedAt)) &&
    value.sourceUrl === expectedUrl
  );
}

function validIdArray(value: unknown, allowEmpty = true): value is string[] {
  return (
    Array.isArray(value) &&
    (allowEmpty || value.length > 0) &&
    value.every(safeEntityId) &&
    new Set(value).size === value.length
  );
}

function validWindow(startsAt: unknown, endsAt: unknown, allowOpen: boolean) {
  if (
    (!allowOpen && (!finiteDate(startsAt) || !finiteDate(endsAt))) ||
    (allowOpen && !(startsAt === null || finiteDate(startsAt))) ||
    (allowOpen && !(endsAt === null || finiteDate(endsAt)))
  ) {
    return false;
  }
  return (
    startsAt === null ||
    endsAt === null ||
    (finiteDate(startsAt) &&
      finiteDate(endsAt) &&
      startsAt.getTime() <= endsAt.getTime())
  );
}

function validElevatorStations(value: unknown) {
  if (!Array.isArray(value)) return false;
  const stationIds = new Set<string>();
  const equipmentIds = new Set<string>();
  for (const station of value) {
    if (
      !isRecord(station) ||
      !safeEntityId(station.stationId) ||
      !["accessible", "limited", "unavailable", "unknown"].includes(
        String(station.state),
      ) ||
      !Array.isArray(station.elevators) ||
      stationIds.has(station.stationId)
    ) {
      return false;
    }
    stationIds.add(station.stationId);
    for (const elevator of station.elevators) {
      if (
        !isRecord(elevator) ||
        !safeEntityId(elevator.equipmentId) ||
        !["working", "out_of_service", "unknown"].includes(
          String(elevator.state),
        ) ||
        equipmentIds.has(elevator.equipmentId)
      ) {
        return false;
      }
      equipmentIds.add(elevator.equipmentId);
    }
  }
  return true;
}

function validAdvisories(value: unknown) {
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  return value.every((advisory) => {
    if (
      !isRecord(advisory) ||
      !safeEntityId(advisory.advisoryId) ||
      ids.has(advisory.advisoryId) ||
      !validIdArray(advisory.stopIds) ||
      !validIdArray(advisory.routeIds) ||
      (advisory.stopIds.length === 0 && advisory.routeIds.length === 0) ||
      !validWindow(advisory.startsAt, advisory.endsAt, true)
    ) {
      return false;
    }
    ids.add(advisory.advisoryId);
    return true;
  });
}

function validRelocations(value: unknown) {
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  return value.every((relocation) => {
    if (
      !isRecord(relocation) ||
      !safeEntityId(relocation.relocationId) ||
      ids.has(relocation.relocationId) ||
      !safeEntityId(relocation.stopId) ||
      !validIdArray(relocation.routeIds, false) ||
      !safeEvidenceText(relocation.temporaryStop) ||
      !safeEvidenceText(relocation.boardingInstruction) ||
      !validWindow(relocation.startsAt, relocation.endsAt, false)
    ) {
      return false;
    }
    ids.add(relocation.relocationId);
    return true;
  });
}

const TRUSTED_TRIP_RELATIONSHIPS = new Set([
  "SCHEDULED",
  "ADDED",
  "UNSCHEDULED",
  "CANCELED",
  "DELETED",
  "REPLACEMENT",
  "DUPLICATED",
  "NEW",
  "SKIPPED",
]);

function validDelay(value: unknown) {
  return (
    value === null ||
    (typeof value === "number" &&
      Number.isSafeInteger(value) &&
      Math.abs(value) <= MAX_DELAY_SECONDS)
  );
}

function validTripUpdates(value: unknown) {
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  return value.every((update) => {
    if (
      !isRecord(update) ||
      !safeEntityId(update.updateId) ||
      ids.has(update.updateId) ||
      !safeEntityId(update.tripId) ||
      !(update.routeId === null || safeEntityId(update.routeId)) ||
      !(update.stopId === null || safeEntityId(update.stopId)) ||
      typeof update.scheduleRelationship !== "string" ||
      !TRUSTED_TRIP_RELATIONSHIPS.has(update.scheduleRelationship) ||
      !validDelay(update.arrivalDelaySeconds) ||
      !validDelay(update.departureDelaySeconds)
    ) {
      return false;
    }
    ids.add(update.updateId);
    return true;
  });
}

function validAlertPeriods(value: unknown) {
  return (
    Array.isArray(value) &&
    value.every(
      (period) =>
        isRecord(period) && validWindow(period.startsAt, period.endsAt, true),
    )
  );
}

function validInformedEntities(value: unknown) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((entity) => {
      if (!isRecord(entity)) return false;
      const identifiers = [
        entity.agencyId,
        entity.routeId,
        entity.tripId,
        entity.stopId,
      ];
      return (
        identifiers.every(
          (identifier) => identifier === null || safeEntityId(identifier),
        ) &&
        (entity.agencyId === null || entity.agencyId === "SF") &&
        identifiers.some((identifier) => identifier !== null)
      );
    })
  );
}

function validAlerts(value: unknown) {
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  return value.every((alert) => {
    if (
      !isRecord(alert) ||
      !safeEntityId(alert.alertId) ||
      ids.has(alert.alertId) ||
      !(alert.effect === null || safeEntityId(alert.effect)) ||
      !validAlertPeriods(alert.activePeriods) ||
      !validInformedEntities(alert.informedEntities)
    ) {
      return false;
    }
    ids.add(alert.alertId);
    return true;
  });
}

function validSnapshot(value: unknown): value is AccessibilityEvidenceSnapshot {
  if (!isRecord(value)) return false;
  const { elevators, advisories, relocations, guides, tripUpdates, alerts } =
    value;
  return (
    validSourceShape(elevators, OFFICIAL_SOURCE_URLS.elevators) &&
    isRecord(elevators) &&
    validElevatorStations(elevators.stations) &&
    validSourceShape(advisories, OFFICIAL_SOURCE_URLS.advisories) &&
    isRecord(advisories) &&
    validAdvisories(advisories.advisories) &&
    validSourceShape(relocations, OFFICIAL_SOURCE_URLS.relocations) &&
    isRecord(relocations) &&
    validRelocations(relocations.relocations) &&
    validSourceShape(guides, OFFICIAL_SOURCE_URLS.guides) &&
    validSourceShape(tripUpdates, OFFICIAL_SOURCE_URLS.realtime) &&
    isRecord(tripUpdates) &&
    validTripUpdates(tripUpdates.updates) &&
    validSourceShape(alerts, OFFICIAL_SOURCE_URLS.realtime) &&
    isRecord(alerts) &&
    validAlerts(alerts.alerts)
  );
}

function validCandidate(candidate: RouteCandidate, at: Date) {
  if (
    !finiteDate(at) ||
    !candidate ||
    !safeEntityId(candidate.id) ||
    !finiteDate(candidate.departureAt) ||
    !finiteDate(candidate.arrivalAt) ||
    !Number.isFinite(candidate.durationSeconds) ||
    candidate.durationSeconds < 0 ||
    candidate.arrivalAt.getTime() - candidate.departureAt.getTime() !==
      candidate.durationSeconds * 1_000 ||
    !Array.isArray(candidate.legs) ||
    candidate.legs.length === 0
  ) {
    return false;
  }
  return candidate.legs.every((leg) => {
    if (
      !finiteDate(leg.startAt) ||
      !finiteDate(leg.endAt) ||
      !Number.isFinite(leg.durationSeconds) ||
      leg.durationSeconds < 0 ||
      leg.endAt.getTime() - leg.startAt.getTime() !==
        leg.durationSeconds * 1_000 ||
      leg.startAt < candidate.departureAt ||
      leg.endAt > candidate.arrivalAt ||
      (leg.from.stopId !== null && !safeEntityId(leg.from.stopId)) ||
      (leg.to.stopId !== null && !safeEntityId(leg.to.stopId)) ||
      leg.geometry.type !== "LineString" ||
      !Array.isArray(leg.geometry.coordinates) ||
      leg.geometry.coordinates.length < 2 ||
      leg.geometry.coordinates.some(
        (coordinate) =>
          !Array.isArray(coordinate) ||
          coordinate.length !== 2 ||
          !coordinate.every(Number.isFinite),
      )
    ) {
      return false;
    }
    return (
      leg.type !== "ride" ||
      (safeEntityId(leg.routeId) &&
        safeEntityId(leg.tripId) &&
        leg.intermediateStopIds.every(safeEntityId))
    );
  });
}

async function readEvidenceSnapshot(
  source: AccessibilityEvidenceSource,
  at: Date,
) {
  try {
    const snapshot = structuredClone(await source.read(new Date(at)));
    return validSnapshot(snapshot) ? snapshot : unavailableSnapshot();
  } catch {
    return unavailableSnapshot();
  }
}

function assertValidCandidate(candidate: RouteCandidate, at: Date) {
  let candidateIsValid = false;
  try {
    candidateIsValid = validCandidate(candidate, at);
  } catch {
    candidateIsValid = false;
  }
  if (!candidateIsValid) {
    throw new AccessibilityEvidenceInvalidError();
  }
}

function evaluateEvidenceSnapshot(
  candidate: RouteCandidate,
  at: Date,
  snapshot: AccessibilityEvidenceSnapshot,
): AccessibilityAssessment {
  assertValidCandidate(candidate, at);
  const rideIndices = candidate.legs.flatMap((leg, index) =>
    leg.type === "ride" ? [index] : [],
  );
  const firstRideIndex = rideIndices[0] ?? -1;
  const lastRideIndex = rideIndices.at(-1) ?? -1;
  const legs = candidate.legs.map(
    (leg, legIndex): AccessibilityLegAssessment => {
      const dependencies: AccessibilityDependency[] = [];
      if (leg.type === "walk" || leg.type === "transfer") {
        dependencies.push({
          kind: "mapped_path",
          state: "unknown",
          reasons: [reason("MAPPED_PATH_UNCONFIRMED", "leg:" + legIndex)],
        });
        if (leg.type === "transfer") {
          dependencies.push(stopAccess(leg.from.stopId, "platform", snapshot));
          if (leg.to.stopId !== leg.from.stopId) {
            dependencies.push(stopAccess(leg.to.stopId, "platform", snapshot));
          }
        }
      } else if (leg.type === "wait") {
        dependencies.push(stopAccess(leg.from.stopId, "platform", snapshot));
      } else {
        if (leg.type !== "ride") {
          throw new AccessibilityEvidenceInvalidError();
        }
        dependencies.push(
          stopAccess(
            leg.from.stopId,
            legIndex === firstRideIndex ? "street_and_platform" : "platform",
            snapshot,
          ),
        );
        dependencies.push(
          stopAccess(
            leg.to.stopId,
            legIndex === lastRideIndex ? "street_and_platform" : "platform",
            snapshot,
          ),
        );
        dependencies.push(advisoryDependency(leg, snapshot));
        dependencies.push(relocationDependency(leg, snapshot));
        const trip = tripEvidence(leg, snapshot);
        dependencies.push(trip.dependency);
        dependencies.push(alertDependency(leg, snapshot));
        return {
          legIndex,
          type: leg.type,
          state: stateOf(dependencies),
          delaySeconds: trip.delaySeconds,
          departureDelaySeconds: trip.departureDelaySeconds,
          arrivalDelaySeconds: trip.arrivalDelaySeconds,
          dependencies,
        };
      }
      return {
        legIndex,
        type: leg.type,
        state: stateOf(dependencies),
        delaySeconds: 0,
        departureDelaySeconds: 0,
        arrivalDelaySeconds: 0,
        dependencies,
      };
    },
  );
  return {
    candidateId: candidate.id,
    state: stateOf(
      legs.map((leg) => ({
        kind: "mapped_path",
        state: leg.state,
        reasons: [],
      })),
    ),
    delaySeconds:
      [...legs].reverse().find((leg) => leg.type === "ride")?.delaySeconds ?? 0,
    legs,
    sources: provenance(snapshot),
  };
}

export function createAccessibilityEvidence(
  source: AccessibilityEvidenceSource,
): AccessibilityEvidence {
  return {
    async evaluate(candidate, at) {
      assertValidCandidate(candidate, at);
      const snapshot = await readEvidenceSnapshot(source, at);
      return evaluateEvidenceSnapshot(candidate, at, snapshot);
    },
    async evaluateCandidates(candidates, at) {
      candidates.forEach((candidate) => assertValidCandidate(candidate, at));
      const snapshot = await readEvidenceSnapshot(source, at);
      return candidates.map((candidate) =>
        evaluateEvidenceSnapshot(candidate, at, snapshot),
      );
    },
  };
}

export class AccessibilityEvidenceInvalidError extends Error {
  readonly code = "ACCESSIBILITY_EVIDENCE_INVALID";

  constructor() {
    super("The journey candidate or evaluation time is invalid.");
    this.name = "AccessibilityEvidenceInvalidError";
  }
}
