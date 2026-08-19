import {
  ACCESSIBILITY_ADVISORY_COLLECTOR_ID,
  ACCESSIBILITY_ADVISORY_SOURCE_URL,
  accessibilityEvidenceHash,
  validateAccessibilityAdvisories,
  type AccessibilityAdvisory,
  type AccessibilityValidationResult,
} from "@/domain/transit/accessibility-advisories";

export {
  ACCESSIBILITY_ADVISORY_COLLECTOR_ID,
  ACCESSIBILITY_ADVISORY_SOURCE_URL,
};

export type StoredAccessibilitySnapshot = {
  snapshotId: string;
  payloadHash: string;
  structuralFingerprint: string;
  checkedAt: Date;
  sourceUpdatedAt: Date | null;
  sourceUrl: string;
  advisories: AccessibilityAdvisory[];
};

type FailedAttemptReport = {
  accepted: false;
  rowCount: number;
  reasons: Array<{
    code: string;
    row?: number;
    field?: string;
    message: string;
  }>;
};

export type AccessibilityRefreshAttempt =
  | {
      status: "validated";
      basedOnSnapshotId: string | null;
      checkedAt: Date;
      sourceUpdatedAt: null;
      sourceUrl: typeof ACCESSIBILITY_ADVISORY_SOURCE_URL;
      payloadHash: string;
      structuralFingerprint: string;
      advisories: AccessibilityAdvisory[];
      validationReport: Extract<
        AccessibilityValidationResult,
        { accepted: true }
      >["report"];
    }
  | {
      status: "rejected" | "unavailable";
      basedOnSnapshotId: string | null;
      checkedAt: Date;
      sourceUpdatedAt: null;
      sourceUrl: typeof ACCESSIBILITY_ADVISORY_SOURCE_URL;
      payloadHash: string;
      structuralFingerprint: null;
      validationReport: FailedAttemptReport;
    };

export type AccessibilityRefreshResult =
  | {
      status: "promoted" | "unchanged";
      activeSnapshot: StoredAccessibilitySnapshot;
    }
  | {
      status: "rejected" | "unavailable";
      activeSnapshot: StoredAccessibilitySnapshot | null;
    };

export type AccessibilityAdvisoryCollection = {
  collectorId: string;
  sourceUrl: string;
  rows: readonly unknown[];
  collectedAt: Date;
  listingComplete: boolean;
  detailNavigationComplete: boolean;
};

export type AccessibilityAdvisoryCollector = {
  collect: () => Promise<AccessibilityAdvisoryCollection>;
};

export type AccessibilityAdvisoryStore = {
  getCurrentSnapshot: () => Promise<StoredAccessibilitySnapshot | null>;
  getLatestAttempt: () => Promise<{
    status: "current" | "rejected" | "unavailable";
    checkedAt: Date;
  } | null>;
  applyRefreshAttempt: (
    attempt: AccessibilityRefreshAttempt,
  ) => Promise<AccessibilityRefreshResult>;
};

export type AccessibilityAdvisoryView = {
  state: "current" | "older" | "unavailable";
  checkedAt: Date | null;
  sourceUpdatedAt: Date | null;
  sourceUrl: typeof ACCESSIBILITY_ADVISORY_SOURCE_URL;
  advisories: AccessibilityAdvisory[];
};

const MAX_RAW_ROWS = 100;
const MAX_COLLECTION_DURATION_MS = 10 * 60 * 1_000;
const COLLECTION_CLOCK_SKEW_MS = 60 * 1_000;

async function currentSnapshot(store: AccessibilityAdvisoryStore) {
  try {
    return await store.getCurrentSnapshot();
  } catch {
    return null;
  }
}

async function storeFailedAttempt(
  dependencies: { store: AccessibilityAdvisoryStore },
  input: {
    status: "rejected" | "unavailable";
    basedOnSnapshotId: string | null;
    checkedAt: Date;
    report: FailedAttemptReport;
  },
) {
  return dependencies.store.applyRefreshAttempt({
    status: input.status,
    basedOnSnapshotId: input.basedOnSnapshotId,
    checkedAt: input.checkedAt,
    sourceUpdatedAt: null,
    sourceUrl: ACCESSIBILITY_ADVISORY_SOURCE_URL,
    payloadHash: accessibilityEvidenceHash({
      status: input.status,
      checkedAt: input.checkedAt,
      report: input.report,
    }),
    structuralFingerprint: null,
    validationReport: input.report,
  });
}

export async function refreshAccessibilityAdvisories(
  input: { at: Date },
  dependencies: {
    collector: AccessibilityAdvisoryCollector;
    store: AccessibilityAdvisoryStore;
  },
): Promise<AccessibilityRefreshResult> {
  const previous = await currentSnapshot(dependencies.store);
  let collection: Awaited<
    ReturnType<AccessibilityAdvisoryCollector["collect"]>
  >;
  try {
    collection = await dependencies.collector.collect();
  } catch {
    const report: FailedAttemptReport = {
      accepted: false,
      rowCount: 0,
      reasons: [
        {
          code: "COLLECTION_UNAVAILABLE",
          message: "The accessibility advisory source could not be checked.",
        },
      ],
    };
    try {
      return await storeFailedAttempt(dependencies, {
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
    collectedAt.valueOf() < input.at.valueOf() - COLLECTION_CLOCK_SKEW_MS ||
    collectedAt.valueOf() > input.at.valueOf() + MAX_COLLECTION_DURATION_MS
  ) {
    const report: FailedAttemptReport = {
      accepted: false,
      rowCount: 0,
      reasons: [
        {
          code: "COLLECTION_TIME_INVALID",
          message: "The accessibility advisory check time is invalid.",
        },
      ],
    };
    try {
      return await storeFailedAttempt(dependencies, {
        status: "rejected",
        basedOnSnapshotId: previous?.snapshotId ?? null,
        checkedAt: input.at,
        report,
      });
    } catch {
      return { status: "unavailable", activeSnapshot: previous };
    }
  }

  const rows = Array.isArray(collection.rows)
    ? collection.rows.slice(0, MAX_RAW_ROWS + 1)
    : [];
  const validation = validateAccessibilityAdvisories({
    collectorId: collection.collectorId,
    sourceUrl: collection.sourceUrl,
    rows,
    at: collectedAt,
    previousRowCount: previous?.advisories.length ?? null,
    listingComplete: collection.listingComplete === true,
    detailNavigationComplete: collection.detailNavigationComplete === true,
  });

  try {
    if (!validation.accepted) {
      return await storeFailedAttempt(dependencies, {
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
      sourceUrl: ACCESSIBILITY_ADVISORY_SOURCE_URL,
      payloadHash: validation.payloadHash,
      structuralFingerprint: validation.structuralFingerprint,
      advisories: validation.advisories,
      validationReport: validation.report,
    });
  } catch {
    return { status: "unavailable", activeSnapshot: previous };
  }
}

export async function readAccessibilityAdvisories(
  input: { at: Date },
  dependencies: { store: AccessibilityAdvisoryStore },
): Promise<AccessibilityAdvisoryView> {
  const snapshot = await currentSnapshot(dependencies.store);
  if (!snapshot) {
    return {
      state: "unavailable",
      checkedAt: null,
      sourceUpdatedAt: null,
      sourceUrl: ACCESSIBILITY_ADVISORY_SOURCE_URL,
      advisories: [],
    };
  }
  let latestAttempt: Awaited<
    ReturnType<AccessibilityAdvisoryStore["getLatestAttempt"]>
  >;
  try {
    latestAttempt = await dependencies.store.getLatestAttempt();
  } catch {
    latestAttempt = { status: "unavailable", checkedAt: input.at };
  }
  const age = input.at.valueOf() - snapshot.checkedAt.valueOf();
  const latestFailed =
    latestAttempt !== null &&
    latestAttempt.status !== "current" &&
    latestAttempt.checkedAt >= snapshot.checkedAt;
  return {
    state:
      !latestFailed && age >= 0 && age <= 90 * 60 * 1_000 ? "current" : "older",
    checkedAt: snapshot.checkedAt,
    sourceUpdatedAt: null,
    sourceUrl: ACCESSIBILITY_ADVISORY_SOURCE_URL,
    advisories: snapshot.advisories,
  };
}
