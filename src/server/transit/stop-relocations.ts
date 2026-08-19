import {
  STOP_RELOCATION_COLLECTOR_ID,
  STOP_RELOCATION_SOURCE_URL,
  stopRelocationEvidenceHash,
  validateStopRelocations,
  type StopRelocation,
  type StopRelocationValidationResult,
} from "@/domain/transit/stop-relocations";

export { STOP_RELOCATION_COLLECTOR_ID, STOP_RELOCATION_SOURCE_URL };

export type StoredStopRelocationSnapshot = {
  snapshotId: string;
  payloadHash: string;
  structuralFingerprint: string;
  checkedAt: Date;
  sourceUpdatedAt: Date;
  sourceUrl: string;
  relocations: StopRelocation[];
};

type FailedReport = {
  accepted: false;
  rowCount: number;
  reasons: Array<{
    code: string;
    row?: number;
    field?: string;
    message: string;
  }>;
};

export type StopRelocationRefreshAttempt =
  | {
      status: "validated";
      basedOnSnapshotId: string | null;
      checkedAt: Date;
      sourceUpdatedAt: Date;
      sourceUrl: typeof STOP_RELOCATION_SOURCE_URL;
      payloadHash: string;
      structuralFingerprint: string;
      relocations: StopRelocation[];
      validationReport: Extract<
        StopRelocationValidationResult,
        { accepted: true }
      >["report"];
    }
  | {
      status: "rejected" | "unavailable";
      basedOnSnapshotId: string | null;
      checkedAt: Date;
      sourceUpdatedAt: null;
      sourceUrl: typeof STOP_RELOCATION_SOURCE_URL;
      payloadHash: string;
      structuralFingerprint: null;
      validationReport: FailedReport;
    };

export type StopRelocationRefreshResult =
  | {
      status: "promoted" | "unchanged";
      activeSnapshot: StoredStopRelocationSnapshot;
    }
  | {
      status: "rejected" | "unavailable";
      activeSnapshot: StoredStopRelocationSnapshot | null;
    };

export type StopRelocationCollection = {
  collectorId: string;
  sourceUrl: string;
  collectedAt: Date;
  datasetComplete: boolean;
  envelope: unknown;
  // The official list currently omits coordinates. Only verified, row-aligned
  // enrichment may populate them; missing values remain unknown and are not inferred.
  coordinates?: Readonly<
    Record<number, { latitude: number | null; longitude: number | null }>
  >;
};

export type StopRelocationCollector = {
  collect: () => Promise<StopRelocationCollection>;
};

export type StopRelocationStore = {
  getCurrentSnapshot: () => Promise<StoredStopRelocationSnapshot | null>;
  getLatestAttempt: () => Promise<{
    status: "current" | "rejected" | "unavailable";
    checkedAt: Date;
  } | null>;
  applyRefreshAttempt: (
    attempt: StopRelocationRefreshAttempt,
  ) => Promise<StopRelocationRefreshResult>;
};

export type PublicStopRelocation = Omit<StopRelocation, "applicant" | "rowId">;
export type StopRelocationView = {
  state: "current" | "older" | "unavailable";
  checkedAt: Date | null;
  sourceUpdatedAt: Date | null;
  sourceUrl: typeof STOP_RELOCATION_SOURCE_URL;
  relocations: PublicStopRelocation[];
};

const MAX_COLLECTION_DURATION_MS = 10 * 60 * 1_000;
const CLOCK_SKEW_MS = 60 * 1_000;
const FRESHNESS_MS = 60 * 60 * 1_000;

async function currentSnapshot(store: StopRelocationStore) {
  try {
    return await store.getCurrentSnapshot();
  } catch {
    return null;
  }
}

async function storeFailure(
  store: StopRelocationStore,
  input: {
    status: "rejected" | "unavailable";
    basedOnSnapshotId: string | null;
    checkedAt: Date;
    report: FailedReport;
  },
) {
  return store.applyRefreshAttempt({
    status: input.status,
    basedOnSnapshotId: input.basedOnSnapshotId,
    checkedAt: input.checkedAt,
    sourceUpdatedAt: null,
    sourceUrl: STOP_RELOCATION_SOURCE_URL,
    payloadHash: stopRelocationEvidenceHash({
      status: input.status,
      checkedAt: input.checkedAt,
      report: input.report,
    }),
    structuralFingerprint: null,
    validationReport: input.report,
  });
}

export async function refreshStopRelocations(
  input: { at: Date },
  dependencies: {
    collector: StopRelocationCollector;
    store: StopRelocationStore;
  },
): Promise<StopRelocationRefreshResult> {
  const previous = await currentSnapshot(dependencies.store);
  let collection: StopRelocationCollection;
  try {
    collection = await dependencies.collector.collect();
  } catch {
    const report: FailedReport = {
      accepted: false,
      rowCount: 0,
      reasons: [
        {
          code: "COLLECTION_UNAVAILABLE",
          message: "The stop relocation source could not be checked.",
        },
      ],
    };
    try {
      return await storeFailure(dependencies.store, {
        status: "unavailable",
        basedOnSnapshotId: previous?.snapshotId ?? null,
        checkedAt: input.at,
        report,
      });
    } catch {
      return { status: "unavailable", activeSnapshot: previous };
    }
  }
  const collectedAt = collection.collectedAt;
  if (
    !(collectedAt instanceof Date) ||
    Number.isNaN(collectedAt.valueOf()) ||
    collectedAt.valueOf() < input.at.valueOf() - CLOCK_SKEW_MS ||
    collectedAt.valueOf() > input.at.valueOf() + MAX_COLLECTION_DURATION_MS
  ) {
    const report: FailedReport = {
      accepted: false,
      rowCount: 0,
      reasons: [
        {
          code: "COLLECTION_TIME_INVALID",
          message: "The stop relocation check time is invalid.",
        },
      ],
    };
    try {
      return await storeFailure(dependencies.store, {
        status: "rejected",
        basedOnSnapshotId: previous?.snapshotId ?? null,
        checkedAt: input.at,
        report,
      });
    } catch {
      return { status: "unavailable", activeSnapshot: previous };
    }
  }
  const validation = validateStopRelocations({
    collectorId: collection.collectorId,
    sourceUrl: collection.sourceUrl,
    datasetComplete: collection.datasetComplete,
    envelope: collection.envelope,
    collectedAt,
    previousRowCount: previous?.relocations.length ?? null,
    coordinates: collection.coordinates,
  });
  try {
    if (!validation.accepted) {
      return await storeFailure(dependencies.store, {
        status: "rejected",
        basedOnSnapshotId: previous?.snapshotId ?? null,
        checkedAt: collectedAt,
        report: validation.report,
      });
    }
    return await dependencies.store.applyRefreshAttempt({
      status: "validated",
      basedOnSnapshotId: previous?.snapshotId ?? null,
      checkedAt: collectedAt,
      sourceUpdatedAt: validation.sourceUpdatedAt,
      sourceUrl: STOP_RELOCATION_SOURCE_URL,
      payloadHash: validation.payloadHash,
      structuralFingerprint: validation.structuralFingerprint,
      relocations: validation.relocations,
      validationReport: validation.report,
    });
  } catch {
    return { status: "unavailable", activeSnapshot: previous };
  }
}

export async function readStopRelocations(
  input: { at: Date },
  dependencies: { store: StopRelocationStore },
): Promise<StopRelocationView> {
  const snapshot = await currentSnapshot(dependencies.store);
  if (!snapshot) {
    return {
      state: "unavailable",
      checkedAt: null,
      sourceUpdatedAt: null,
      sourceUrl: STOP_RELOCATION_SOURCE_URL,
      relocations: [],
    };
  }
  let latest: Awaited<ReturnType<StopRelocationStore["getLatestAttempt"]>>;
  try {
    latest = await dependencies.store.getLatestAttempt();
  } catch {
    latest = { status: "unavailable", checkedAt: input.at };
  }
  const checkedAge = input.at.valueOf() - snapshot.checkedAt.valueOf();
  const sourceAge = input.at.valueOf() - snapshot.sourceUpdatedAt.valueOf();
  const failedLatest =
    latest !== null &&
    latest.status !== "current" &&
    latest.checkedAt >= snapshot.checkedAt;
  return {
    state:
      !failedLatest &&
      checkedAge >= 0 &&
      checkedAge <= FRESHNESS_MS &&
      sourceAge >= 0 &&
      sourceAge <= FRESHNESS_MS
        ? "current"
        : "older",
    checkedAt: snapshot.checkedAt,
    sourceUpdatedAt: snapshot.sourceUpdatedAt,
    sourceUrl: STOP_RELOCATION_SOURCE_URL,
    relocations: snapshot.relocations.map((relocation) => ({
      stopId: relocation.stopId,
      stopName: relocation.stopName,
      routeNames: relocation.routeNames,
      temporaryStop: relocation.temporaryStop,
      scheduleText: relocation.scheduleText,
      startsAt: relocation.startsAt,
      endsAt: relocation.endsAt,
      latitude: relocation.latitude,
      longitude: relocation.longitude,
      publicUrl: relocation.publicUrl,
      boardingInstruction: relocation.boardingInstruction,
    })),
  };
}
