import {
  validateGtfsFileSet,
  type GtfsCoverageSummary,
  type GtfsValidatedSnapshot,
  type GtfsValidationPolicy,
  type GtfsValidationResult,
} from "@/domain/transit/gtfs-validation";

export type GtfsArchive = {
  files: Readonly<Record<string, string | undefined>>;
  feedHash: string;
  checkedAt: Date;
  sourceUpdatedAt: Date | null;
  sourceUrl: string;
  etag: string | null;
  lastModified: string | null;
  manifest: Readonly<Record<string, { bytes: number; sha256: string }>>;
};

export type GtfsArchiveEvidence = Omit<GtfsArchive, "files">;

export type ActiveGtfsSnapshot = {
  snapshotId: string;
  feedHash: string;
  coverage: GtfsCoverageSummary;
  checkedAt: Date;
  sourceUpdatedAt: Date | null;
  sourceUrl: string;
};

type AcceptedValidation = Extract<GtfsValidationResult, { accepted: true }>;
type RejectedValidation = Extract<GtfsValidationResult, { accepted: false }>;

export type GtfsSnapshotAttempt =
  | {
      status: "validated";
      basedOnFeedHash: string | null;
      archive: GtfsArchiveEvidence;
      validation: AcceptedValidation;
    }
  | {
      status: "rejected";
      basedOnFeedHash: string | null;
      archive: GtfsArchiveEvidence;
      validation: RejectedValidation;
    };

export type StoredGtfsRefreshResult =
  | { status: "promoted"; activeSnapshot: ActiveGtfsSnapshot }
  | { status: "unchanged"; activeSnapshot: ActiveGtfsSnapshot }
  | { status: "rejected"; activeSnapshot: ActiveGtfsSnapshot | null };

export type GtfsRefreshResult = StoredGtfsRefreshResult;

export type GtfsArchiveLoader = {
  load: () => Promise<GtfsArchive>;
};

export type GtfsSnapshotStore = {
  getActiveSnapshot: () => Promise<ActiveGtfsSnapshot | null>;
  applyRefreshAttempt: (
    attempt: GtfsSnapshotAttempt,
  ) => Promise<StoredGtfsRefreshResult>;
};

export class GtfsRefreshError extends Error {
  constructor(
    readonly code: "ARCHIVE_UNAVAILABLE" | "STORE_UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "GtfsRefreshError";
  }
}

export type RefreshGtfsSnapshotDependencies = {
  archiveLoader: GtfsArchiveLoader;
  snapshotStore: GtfsSnapshotStore;
  validationPolicy: GtfsValidationPolicy;
};

function sanFranciscoDate(at: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const value = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${value.year}-${value.month}-${value.day}`;
}

function withoutRawFiles(archive: GtfsArchive): GtfsArchiveEvidence {
  return {
    feedHash: archive.feedHash,
    checkedAt: archive.checkedAt,
    sourceUpdatedAt: archive.sourceUpdatedAt,
    sourceUrl: archive.sourceUrl,
    etag: archive.etag,
    lastModified: archive.lastModified,
    manifest: archive.manifest,
  };
}

async function readActiveSnapshot(store: GtfsSnapshotStore) {
  try {
    return await store.getActiveSnapshot();
  } catch {
    throw new GtfsRefreshError(
      "STORE_UNAVAILABLE",
      "The trusted schedule snapshot could not be read or changed.",
    );
  }
}

async function loadArchive(loader: GtfsArchiveLoader) {
  try {
    return await loader.load();
  } catch {
    throw new GtfsRefreshError(
      "ARCHIVE_UNAVAILABLE",
      "The schedule archive could not be loaded.",
    );
  }
}

async function storeAttempt(
  store: GtfsSnapshotStore,
  attempt: GtfsSnapshotAttempt,
) {
  try {
    return await store.applyRefreshAttempt(attempt);
  } catch {
    throw new GtfsRefreshError(
      "STORE_UNAVAILABLE",
      "The trusted schedule snapshot could not be read or changed.",
    );
  }
}

export async function refreshGtfsSnapshot(
  input: { at: Date },
  dependencies: RefreshGtfsSnapshotDependencies,
): Promise<GtfsRefreshResult> {
  const activeSnapshot = await readActiveSnapshot(dependencies.snapshotStore);
  const archive = await loadArchive(dependencies.archiveLoader);

  const validation = validateGtfsFileSet({
    files: archive.files,
    serviceDate: sanFranciscoDate(input.at),
    policy: dependencies.validationPolicy,
    previousCoverage: activeSnapshot?.coverage,
  });
  const evidence = withoutRawFiles(archive);

  if (!validation.accepted) {
    return storeAttempt(dependencies.snapshotStore, {
      status: "rejected",
      basedOnFeedHash: activeSnapshot?.feedHash ?? null,
      archive: evidence,
      validation,
    });
  }

  return storeAttempt(dependencies.snapshotStore, {
    status: "validated",
    basedOnFeedHash: activeSnapshot?.feedHash ?? null,
    archive: evidence,
    validation: validation as {
      accepted: true;
      summary: GtfsCoverageSummary;
      snapshot: GtfsValidatedSnapshot;
    },
  });
}
