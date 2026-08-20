import type {
  AccessibilityEvidenceSnapshot,
  AccessibilityEvidenceSource,
  ExactAccessibilityAdvisory,
  ExactStopRelocation,
} from "@/domain/journey/accessibility-evidence";
import type { AccessibilityElevatorRead } from "@/server/journey/accessibility-elevator-read";
import type { RealtimeReadStore } from "@/domain/transit/realtime";
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

const ELEVATOR_SOURCE_URL =
  "https://www.sfmta.com/elevator-status/elevatorstatus.php?src=prod";
const REALTIME_SOURCE_URL = "https://511.org/open-data/transit";

export type TrustedAccessibilityReadDependencies = {
  readElevators(at: Date): Promise<AccessibilityElevatorRead | null>;
  readAdvisories(at: Date): Promise<AccessibilityAdvisoryView>;
  readRelocations(at: Date): Promise<StopRelocationView>;
  readGuides(at: Date): Promise<StopAccessibilityGuideView>;
  realtimeStore: RealtimeReadStore;
  resolveAdvisories?(
    view: AccessibilityAdvisoryView,
  ): Promise<ExactAccessibilityAdvisory[] | null>;
  resolveRelocations?(
    view: StopRelocationView,
  ): Promise<ExactStopRelocation[] | null>;
};

type SourceState = "current" | "older" | "unavailable";

function date(value: Date | null) {
  return value ? new Date(value) : null;
}

function provenance(
  state: SourceState,
  checkedAt: Date | null,
  sourceUpdatedAt: Date | null,
  sourceUrl: string,
) {
  return {
    state,
    checkedAt: date(checkedAt),
    sourceUpdatedAt: date(sourceUpdatedAt),
    sourceUrl,
  };
}

function unavailable(sourceUrl: string) {
  return provenance("unavailable", null, null, sourceUrl);
}

function safeJourneyText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 500 &&
    value === value.trim() &&
    !/[<>\u0000-\u001f\u007f]/u.test(value)
  );
}

function safeId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/u.test(value)
  );
}

function validDate(value: Date | null) {
  return value === null || Number.isFinite(value.getTime());
}

function validResolvedAdvisory(value: ExactAccessibilityAdvisory) {
  return (
    safeId(value.advisoryId) &&
    value.stopIds.every(safeId) &&
    value.routeIds.every(safeId) &&
    validDate(value.startsAt) &&
    validDate(value.endsAt) &&
    (!value.startsAt || !value.endsAt || value.startsAt <= value.endsAt)
  );
}

function sameNullableDate(left: Date | null, right: Date | null) {
  return left === null
    ? right === null
    : right !== null && left.getTime() === right.getTime();
}

function completeResolvedAdvisories(
  view: AccessibilityAdvisoryView,
  resolved: ExactAccessibilityAdvisory[],
) {
  const sourceIds = new Set(
    view.advisories.map((advisory) => advisory.advisoryId),
  );
  const resolvedIds = new Set(resolved.map((advisory) => advisory.advisoryId));
  if (
    sourceIds.size !== view.advisories.length ||
    resolvedIds.size !== resolved.length ||
    resolved.length !== view.advisories.length
  )
    return false;
  return resolved.every((advisory) => {
    const original = view.advisories.find(
      (candidate) => candidate.advisoryId === advisory.advisoryId,
    );
    return (
      original !== undefined &&
      validResolvedAdvisory(advisory) &&
      advisory.stopIds.length + advisory.routeIds.length > 0 &&
      new Set(advisory.stopIds).size === advisory.stopIds.length &&
      new Set(advisory.routeIds).size === advisory.routeIds.length &&
      sameNullableDate(original.startsAt, advisory.startsAt) &&
      sameNullableDate(original.endsAt, advisory.endsAt)
    );
  });
}

async function elevators(
  result: PromiseSettledResult<AccessibilityElevatorRead | null>,
): Promise<AccessibilityEvidenceSnapshot["elevators"]> {
  if (result.status === "rejected" || !result.value) {
    return { ...unavailable(ELEVATOR_SOURCE_URL), stations: [] };
  }
  const { accessibility, checkedAt } = result.value;
  return {
    ...provenance(
      accessibility.trust.state,
      checkedAt,
      accessibility.trust.sourceValidAt,
      ELEVATOR_SOURCE_URL,
    ),
    stations: accessibility.stations.map((station) => ({
      stationId: station.slug,
      state: station.state,
      elevators: station.elevators.map((elevator) => ({
        equipmentId: elevator.sourceKey,
        state: elevator.state,
      })),
    })),
  };
}

async function advisories(
  result: PromiseSettledResult<AccessibilityAdvisoryView>,
  resolve: TrustedAccessibilityReadDependencies["resolveAdvisories"],
): Promise<AccessibilityEvidenceSnapshot["advisories"]> {
  if (result.status === "rejected") {
    return {
      ...unavailable(ACCESSIBILITY_ADVISORY_SOURCE_URL),
      advisories: [],
    };
  }
  const view = result.value;
  const source = provenance(
    view.state,
    view.checkedAt,
    view.sourceUpdatedAt,
    ACCESSIBILITY_ADVISORY_SOURCE_URL,
  );
  if (view.state !== "current") {
    return { ...source, advisories: [] };
  }
  if (!resolve) {
    return {
      ...unavailable(ACCESSIBILITY_ADVISORY_SOURCE_URL),
      advisories: [],
    };
  }
  try {
    const resolved = await resolve(view);
    if (!resolved || !completeResolvedAdvisories(view, resolved)) {
      return {
        ...unavailable(ACCESSIBILITY_ADVISORY_SOURCE_URL),
        advisories: [],
      };
    }
    return {
      ...source,
      advisories: resolved.map((advisory) => ({
        advisoryId: advisory.advisoryId,
        stopIds: [...new Set(advisory.stopIds)].sort(),
        routeIds: [...new Set(advisory.routeIds)].sort(),
        startsAt: date(advisory.startsAt),
        endsAt: date(advisory.endsAt),
      })),
    };
  } catch {
    return {
      ...unavailable(ACCESSIBILITY_ADVISORY_SOURCE_URL),
      advisories: [],
    };
  }
}

async function relocations(
  result: PromiseSettledResult<StopRelocationView>,
  resolve: TrustedAccessibilityReadDependencies["resolveRelocations"],
): Promise<AccessibilityEvidenceSnapshot["relocations"]> {
  if (result.status === "rejected") {
    return { ...unavailable(STOP_RELOCATION_SOURCE_URL), relocations: [] };
  }
  const view = result.value;
  const source = provenance(
    view.state,
    view.checkedAt,
    view.sourceUpdatedAt,
    STOP_RELOCATION_SOURCE_URL,
  );
  if (view.state !== "current") return { ...source, relocations: [] };
  if (!resolve)
    return { ...unavailable(STOP_RELOCATION_SOURCE_URL), relocations: [] };
  try {
    const resolved = await resolve(view);
    const ids = new Set(resolved?.map((row) => row.relocationId));
    if (
      !resolved ||
      resolved.length !== view.relocations.length ||
      ids.size !== resolved.length ||
      resolved.some(
        (row) =>
          !safeId(row.relocationId) ||
          !safeId(row.stopId) ||
          row.routeIds.length === 0 ||
          new Set(row.routeIds).size !== row.routeIds.length ||
          !row.routeIds.every(safeId) ||
          !safeJourneyText(row.temporaryStop) ||
          !safeJourneyText(row.boardingInstruction) ||
          !view.relocations.some(
            (sourceRow) =>
              sourceRow.stopId === row.stopId &&
              sourceRow.temporaryStop === row.temporaryStop &&
              sourceRow.boardingInstruction === row.boardingInstruction &&
              sourceRow.startsAt.getTime() === row.startsAt.getTime() &&
              sourceRow.endsAt.getTime() === row.endsAt.getTime(),
          ) ||
          !validDate(row.startsAt) ||
          !validDate(row.endsAt) ||
          row.startsAt > row.endsAt,
      )
    ) {
      return { ...unavailable(STOP_RELOCATION_SOURCE_URL), relocations: [] };
    }
    return {
      ...source,
      relocations: resolved.map((row) => ({
        relocationId: row.relocationId,
        stopId: row.stopId,
        routeIds: [...row.routeIds].sort(),
        temporaryStop: row.temporaryStop,
        boardingInstruction: row.boardingInstruction,
        startsAt: new Date(row.startsAt),
        endsAt: new Date(row.endsAt),
      })),
    };
  } catch {
    return { ...unavailable(STOP_RELOCATION_SOURCE_URL), relocations: [] };
  }
}

function guides(
  result: PromiseSettledResult<StopAccessibilityGuideView>,
): AccessibilityEvidenceSnapshot["guides"] {
  if (result.status === "rejected") {
    return unavailable(STOP_ACCESSIBILITY_GUIDE_SOURCE_URL);
  }
  return provenance(
    result.value.state,
    result.value.checkedAt,
    result.value.sourceUpdatedAt,
    STOP_ACCESSIBILITY_GUIDE_SOURCE_URL,
  );
}

async function tripUpdates(
  result: PromiseSettledResult<
    Awaited<ReturnType<RealtimeReadStore["getTrustedSnapshot"]>>
  >,
): Promise<AccessibilityEvidenceSnapshot["tripUpdates"]> {
  if (result.status === "rejected" || !result.value) {
    return { ...unavailable(REALTIME_SOURCE_URL), updates: [] };
  }
  const snapshot = result.value;
  return {
    ...provenance(
      "current",
      snapshot.checkedAt,
      snapshot.sourceUpdatedAt,
      REALTIME_SOURCE_URL,
    ),
    updates: snapshot.tripUpdates.map((update) => ({
      updateId: update.updateId,
      tripId: update.tripId,
      routeId: update.routeId,
      stopId: update.stopId,
      scheduleRelationship: update.scheduleRelationship,
      arrivalDelaySeconds: update.arrivalDelaySeconds,
      departureDelaySeconds: update.departureDelaySeconds,
    })),
  };
}

async function alerts(
  result: PromiseSettledResult<
    Awaited<ReturnType<RealtimeReadStore["getTrustedSnapshot"]>>
  >,
): Promise<AccessibilityEvidenceSnapshot["alerts"]> {
  if (result.status === "rejected" || !result.value) {
    return { ...unavailable(REALTIME_SOURCE_URL), alerts: [] };
  }
  const snapshot = result.value;
  return {
    ...provenance(
      "current",
      snapshot.checkedAt,
      snapshot.sourceUpdatedAt,
      REALTIME_SOURCE_URL,
    ),
    alerts: snapshot.alerts.map((alert) => ({
      alertId: alert.entityId,
      effect: alert.effect,
      activePeriods: alert.activePeriods.map((period) => ({
        startsAt: date(period.startsAt),
        endsAt: date(period.endsAt),
      })),
      informedEntities: alert.informedEntities.map((entity) => ({
        agencyId: entity.agencyId,
        routeId: entity.routeId,
        tripId: entity.tripId,
        stopId: entity.stopId,
      })),
    })),
  };
}

export function createTrustedAccessibilityEvidenceSource(
  dependencies: TrustedAccessibilityReadDependencies,
): AccessibilityEvidenceSource {
  return {
    async read(at) {
      const [
        elevatorResult,
        advisoryResult,
        relocationResult,
        guideResult,
        tripResult,
        alertResult,
      ] = await Promise.allSettled([
        dependencies.readElevators(new Date(at)),
        dependencies.readAdvisories(new Date(at)),
        dependencies.readRelocations(new Date(at)),
        dependencies.readGuides(new Date(at)),
        dependencies.realtimeStore.getTrustedSnapshot(
          "trip_updates",
          new Date(at),
        ),
        dependencies.realtimeStore.getTrustedSnapshot("alerts", new Date(at)),
      ]);

      return {
        elevators: await elevators(elevatorResult),
        advisories: await advisories(
          advisoryResult,
          dependencies.resolveAdvisories,
        ),
        relocations: await relocations(
          relocationResult,
          dependencies.resolveRelocations,
        ),
        guides: guides(guideResult),
        tripUpdates: await tripUpdates(tripResult),
        alerts: await alerts(alertResult),
      };
    },
  };
}
