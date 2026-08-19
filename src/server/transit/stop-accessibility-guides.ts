import {
  STOP_ACCESSIBILITY_GUIDE_COLLECTOR_ID,
  STOP_ACCESSIBILITY_GUIDE_SOURCE_URL,
  stopAccessibilityGuideEvidenceHash,
  validateStopAccessibilityGuides,
  type StopAccessibilityGuide,
  type StopAccessibilityGuideValidationResult,
} from "@/domain/transit/stop-accessibility-guides";

export {
  STOP_ACCESSIBILITY_GUIDE_COLLECTOR_ID,
  STOP_ACCESSIBILITY_GUIDE_SOURCE_URL,
};

export type StoredStopAccessibilityGuideSnapshot = {
  snapshotId: string;
  payloadHash: string;
  structuralFingerprint: string;
  checkedAt: Date;
  sourceUpdatedAt: null;
  sourceUrl: string;
  guides: StopAccessibilityGuide[];
};

type FailedReport = {
  accepted: false;
  rowCount: number;
  reasons: Array<{
    code: string;
    line?: number;
    field?: string;
    message: string;
  }>;
};

export type StopAccessibilityGuideRefreshAttempt =
  | {
      status: "validated";
      basedOnSnapshotId: string | null;
      checkedAt: Date;
      sourceUpdatedAt: null;
      sourceUrl: typeof STOP_ACCESSIBILITY_GUIDE_SOURCE_URL;
      payloadHash: string;
      structuralFingerprint: string;
      guides: StopAccessibilityGuide[];
      validationReport: Extract<
        StopAccessibilityGuideValidationResult,
        { accepted: true }
      >["report"];
    }
  | {
      status: "rejected" | "unavailable";
      basedOnSnapshotId: string | null;
      checkedAt: Date;
      sourceUpdatedAt: null;
      sourceUrl: typeof STOP_ACCESSIBILITY_GUIDE_SOURCE_URL;
      payloadHash: string;
      structuralFingerprint: null;
      validationReport: FailedReport;
    };

export type StopAccessibilityGuideRefreshResult =
  | {
      status: "promoted" | "unchanged";
      activeSnapshot: StoredStopAccessibilityGuideSnapshot;
    }
  | {
      status: "rejected" | "unavailable";
      activeSnapshot: StoredStopAccessibilityGuideSnapshot | null;
    };

export type StopAccessibilityGuideCollection = {
  collectorId: string;
  sourceUrl: string;
  collectedAt: Date;
  datasetComplete: boolean;
  envelope: unknown;
};

export type StopAccessibilityGuideCollector = {
  collect: () => Promise<StopAccessibilityGuideCollection>;
};

export type StopAccessibilityGuideStore = {
  getCurrentSnapshot: () => Promise<StoredStopAccessibilityGuideSnapshot | null>;
  getLatestAttempt: () => Promise<{
    status: "current" | "rejected" | "unavailable";
    checkedAt: Date;
  } | null>;
  applyRefreshAttempt: (
    attempt: StopAccessibilityGuideRefreshAttempt,
  ) => Promise<StopAccessibilityGuideRefreshResult>;
};

export type PublicStopAccessibilityGuide = Omit<
  StopAccessibilityGuide,
  "guideId"
>;
export type StopAccessibilityGuideView = {
  state: "current" | "older" | "unavailable";
  checkedAt: Date | null;
  sourceUpdatedAt: null;
  sourceUrl: typeof STOP_ACCESSIBILITY_GUIDE_SOURCE_URL;
  guides: PublicStopAccessibilityGuide[];
};

const MAX_COLLECTION_DURATION_MS = 10 * 60 * 1_000;
const CLOCK_SKEW_MS = 60 * 1_000;
const FRESHNESS_MS = 36 * 60 * 60 * 1_000;

async function currentSnapshot(store: StopAccessibilityGuideStore) {
  try {
    return await store.getCurrentSnapshot();
  } catch {
    return null;
  }
}

async function storeFailure(
  store: StopAccessibilityGuideStore,
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
    sourceUrl: STOP_ACCESSIBILITY_GUIDE_SOURCE_URL,
    payloadHash: stopAccessibilityGuideEvidenceHash({
      status: input.status,
      checkedAt: input.checkedAt,
      report: input.report,
    }),
    structuralFingerprint: null,
    validationReport: input.report,
  });
}

export async function refreshStopAccessibilityGuides(
  input: { at: Date },
  dependencies: {
    collector: StopAccessibilityGuideCollector;
    store: StopAccessibilityGuideStore;
  },
): Promise<StopAccessibilityGuideRefreshResult> {
  const previous = await currentSnapshot(dependencies.store);
  let collection: StopAccessibilityGuideCollection;
  try {
    collection = await dependencies.collector.collect();
  } catch {
    const report: FailedReport = {
      accepted: false,
      rowCount: 0,
      reasons: [
        {
          code: "COLLECTION_UNAVAILABLE",
          message: "The accessible-stop source could not be checked.",
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
          message: "The accessible-stop check time is invalid.",
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
  const validation = validateStopAccessibilityGuides({
    collectorId: collection.collectorId,
    sourceUrl: collection.sourceUrl,
    datasetComplete: collection.datasetComplete,
    envelope: collection.envelope,
    collectedAt,
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
      sourceUpdatedAt: null,
      sourceUrl: STOP_ACCESSIBILITY_GUIDE_SOURCE_URL,
      payloadHash: validation.payloadHash,
      structuralFingerprint: validation.structuralFingerprint,
      guides: validation.guides,
      validationReport: validation.report,
    });
  } catch {
    return { status: "unavailable", activeSnapshot: previous };
  }
}

export async function readStopAccessibilityGuides(
  input: { at: Date },
  dependencies: { store: StopAccessibilityGuideStore },
): Promise<StopAccessibilityGuideView> {
  const snapshot = await currentSnapshot(dependencies.store);
  if (!snapshot) {
    return {
      state: "unavailable",
      checkedAt: null,
      sourceUpdatedAt: null,
      sourceUrl: STOP_ACCESSIBILITY_GUIDE_SOURCE_URL,
      guides: [],
    };
  }
  let latest: Awaited<
    ReturnType<StopAccessibilityGuideStore["getLatestAttempt"]>
  >;
  try {
    latest = await dependencies.store.getLatestAttempt();
  } catch {
    latest = { status: "unavailable", checkedAt: input.at };
  }
  const checkedAge = input.at.valueOf() - snapshot.checkedAt.valueOf();
  const failedLatest =
    latest !== null &&
    latest.status !== "current" &&
    latest.checkedAt >= snapshot.checkedAt;
  return {
    state:
      !failedLatest && checkedAge >= 0 && checkedAge <= FRESHNESS_MS
        ? "current"
        : "older",
    checkedAt: snapshot.checkedAt,
    sourceUpdatedAt: null,
    sourceUrl: STOP_ACCESSIBILITY_GUIDE_SOURCE_URL,
    guides: snapshot.guides.map((guide) => ({
      stopId: guide.stopId,
      stationName: guide.stationName,
      routeNames: guide.routeNames,
      guidance: guide.guidance,
      accessibilityState: guide.accessibilityState,
      reviewed: guide.reviewed,
      publicUrl: guide.publicUrl,
    })),
  };
}
