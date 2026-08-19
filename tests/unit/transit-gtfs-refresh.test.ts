import { describe, expect, it } from "vitest";

import type { GtfsCoverageSummary } from "@/domain/transit/gtfs-validation";
import { minimalGtfsFeed, minimalGtfsPolicy } from "../support/minimal-gtfs";
import {
  GtfsRefreshError,
  refreshGtfsSnapshot,
  type ActiveGtfsSnapshot,
  type GtfsArchive,
  type GtfsSnapshotAttempt,
  type GtfsSnapshotStore,
  type StoredGtfsRefreshResult,
} from "@/server/transit/gtfs-refresh";

function archive(
  feedHash: string,
  files: Readonly<Record<string, string | undefined>> = minimalGtfsFeed(),
): GtfsArchive {
  return {
    files,
    feedHash,
    checkedAt: new Date("2026-08-19T06:30:00.000Z"),
    sourceUpdatedAt: new Date("2026-08-19T05:00:00.000Z"),
    sourceUrl: "https://api.511.org/transit/datafeeds?operator_id=SF",
    etag: '"schedule-v2"',
    lastModified: "Wed, 19 Aug 2026 05:00:00 GMT",
    manifest: {
      "stops.txt": { bytes: 128, sha256: "stops-hash" },
    },
  };
}

function coverage(
  overrides: Partial<GtfsCoverageSummary["counts"]> = {},
): GtfsCoverageSummary {
  return {
    serviceDate: "2026-08-18",
    activeServiceCount: 1,
    counts: {
      stops: 2,
      routes: 1,
      trips: 1,
      stopTimes: 2,
      services: 1,
      shapePoints: 2,
      ...overrides,
    },
    fingerprint: "a".repeat(64),
  };
}

function activeSnapshot(
  feedHash = "old-feed",
  activeCoverage = coverage(),
): ActiveGtfsSnapshot {
  return {
    snapshotId: "snapshot-old",
    feedHash,
    coverage: activeCoverage,
    checkedAt: new Date("2026-08-18T18:00:00.000Z"),
    sourceUpdatedAt: null,
    sourceUrl: "https://api.511.org/transit/datafeeds?operator_id=SF",
  };
}

class MemorySnapshotStore implements GtfsSnapshotStore {
  readonly attempts: GtfsSnapshotAttempt[] = [];

  constructor(
    public active: ActiveGtfsSnapshot | null,
    private readonly applyResult?: StoredGtfsRefreshResult,
    private readonly failure?: Error,
  ) {}

  async getActiveSnapshot(): Promise<ActiveGtfsSnapshot | null> {
    if (this.failure) {
      throw this.failure;
    }
    return this.active;
  }

  async applyRefreshAttempt(
    attempt: GtfsSnapshotAttempt,
  ): Promise<StoredGtfsRefreshResult> {
    if (this.failure) {
      throw this.failure;
    }
    this.attempts.push(attempt);
    if (this.applyResult) {
      return this.applyResult;
    }
    if (attempt.status === "rejected") {
      return { status: "rejected", activeSnapshot: this.active };
    }

    const unchanged = this.active?.feedHash === attempt.archive.feedHash;
    this.active = {
      snapshotId: "snapshot-new",
      feedHash: attempt.archive.feedHash,
      coverage: attempt.validation.summary,
      checkedAt: attempt.archive.checkedAt,
      sourceUpdatedAt: attempt.archive.sourceUpdatedAt,
      sourceUrl: attempt.archive.sourceUrl,
    };
    return {
      status: unchanged ? "unchanged" : "promoted",
      activeSnapshot: this.active,
    };
  }
}

describe("Muni schedule refresh", () => {
  it("derives the San Francisco service date and promotes normalized rows", async () => {
    const store = new MemorySnapshotStore(activeSnapshot());

    const result = await refreshGtfsSnapshot(
      { at: new Date("2026-08-19T06:30:00.000Z") },
      {
        archiveLoader: { load: async () => archive("new-feed") },
        snapshotStore: store,
        validationPolicy: minimalGtfsPolicy,
      },
    );

    expect(result).toEqual({
      status: "promoted",
      activeSnapshot: expect.objectContaining({
        snapshotId: "snapshot-new",
        feedHash: "new-feed",
        coverage: expect.objectContaining({ serviceDate: "2026-08-18" }),
      }),
    });
    expect(store.attempts).toHaveLength(1);
    expect(store.attempts[0]).toMatchObject({
      status: "validated",
      validation: {
        summary: {
          serviceDate: "2026-08-18",
        },
        snapshot: {
          stops: [{ stopId: "STOP-A" }, { stopId: "STOP-B" }],
          routes: [{ routeId: "ROUTE-N" }],
          trips: [{ tripId: "TRIP-1" }],
          stopTimes: [
            { tripId: "TRIP-1", stopId: "STOP-A", stopSequence: 1 },
            { tripId: "TRIP-1", stopId: "STOP-B", stopSequence: 2 },
          ],
        },
      },
    });
  });

  it("returns coverage read back by storage after integrity checks", async () => {
    const databaseCoverage = coverage({ stops: 3_238, routes: 68 });
    const stored = activeSnapshot("new-feed", databaseCoverage);
    const store = new MemorySnapshotStore(null, {
      status: "promoted",
      activeSnapshot: stored,
    });

    const result = await refreshGtfsSnapshot(
      { at: new Date("2026-08-19T18:00:00.000Z") },
      {
        archiveLoader: { load: async () => archive("new-feed") },
        snapshotStore: store,
        validationPolicy: minimalGtfsPolicy,
      },
    );

    expect(result).toEqual({ status: "promoted", activeSnapshot: stored });
  });

  it("records a validation rejection and retains the prior active snapshot", async () => {
    const prior = activeSnapshot();
    const store = new MemorySnapshotStore(prior);
    const files: Record<string, string | undefined> = minimalGtfsFeed();
    delete files["stop_times.txt"];

    const result = await refreshGtfsSnapshot(
      { at: new Date("2026-08-19T18:00:00.000Z") },
      {
        archiveLoader: { load: async () => archive("bad-feed", files) },
        snapshotStore: store,
        validationPolicy: minimalGtfsPolicy,
      },
    );

    expect(result).toEqual({ status: "rejected", activeSnapshot: prior });
    expect(store.attempts).toEqual([
      expect.objectContaining({
        status: "rejected",
        archive: expect.objectContaining({ feedHash: "bad-feed" }),
        validation: {
          accepted: false,
          reasons: [
            expect.objectContaining({
              code: "MISSING_REQUIRED_FILE",
              file: "stop_times.txt",
            }),
          ],
        },
      }),
    ]);
  });

  it("does not promote when storage integrity checks reject staged rows", async () => {
    const prior = activeSnapshot();
    const store = new MemorySnapshotStore(prior, {
      status: "rejected",
      activeSnapshot: prior,
    });

    const result = await refreshGtfsSnapshot(
      { at: new Date("2026-08-19T18:00:00.000Z") },
      {
        archiveLoader: { load: async () => archive("new-feed") },
        snapshotStore: store,
        validationPolicy: minimalGtfsPolicy,
      },
    );

    expect(result).toEqual({ status: "rejected", activeSnapshot: prior });
    expect(store.active).toBe(prior);
  });

  it("treats the active feed hash as an idempotent refresh", async () => {
    const prior = activeSnapshot("same-feed");
    const store = new MemorySnapshotStore(prior);

    const result = await refreshGtfsSnapshot(
      { at: new Date("2026-08-19T18:00:00.000Z") },
      {
        archiveLoader: { load: async () => archive("same-feed") },
        snapshotStore: store,
        validationPolicy: minimalGtfsPolicy,
      },
    );

    expect(result).toEqual({
      status: "unchanged",
      activeSnapshot: expect.objectContaining({
        snapshotId: "snapshot-new",
        feedHash: "same-feed",
        coverage: expect.objectContaining({ serviceDate: "2026-08-19" }),
      }),
    });
    expect(store.attempts).toEqual([
      expect.objectContaining({
        status: "validated",
        basedOnFeedHash: "same-feed",
      }),
    ]);
  });

  it("rejects an expired same-hash schedule and retains the active snapshot", async () => {
    const prior = activeSnapshot("same-feed");
    const store = new MemorySnapshotStore(prior);

    const result = await refreshGtfsSnapshot(
      { at: new Date("2026-08-19T18:00:00.000Z") },
      {
        archiveLoader: {
          load: async () =>
            archive(
              "same-feed",
              minimalGtfsFeed({ startsOn: "20260801", endsOn: "20260818" }),
            ),
        },
        snapshotStore: store,
        validationPolicy: minimalGtfsPolicy,
      },
    );

    expect(result).toEqual({ status: "rejected", activeSnapshot: prior });
    expect(store.attempts).toEqual([
      expect.objectContaining({
        status: "rejected",
        basedOnFeedHash: "same-feed",
      }),
    ]);
  });

  it("fails closed when the archive cannot be loaded", async () => {
    const prior = activeSnapshot();
    const store = new MemorySnapshotStore(prior);

    await expect(
      refreshGtfsSnapshot(
        { at: new Date("2026-08-19T18:00:00.000Z") },
        {
          archiveLoader: {
            load: async () => {
              throw new Error("token=must-not-leak");
            },
          },
          snapshotStore: store,
          validationPolicy: minimalGtfsPolicy,
        },
      ),
    ).rejects.toEqual(
      expect.objectContaining<GtfsRefreshError>({
        name: "GtfsRefreshError",
        code: "ARCHIVE_UNAVAILABLE",
        message: "The schedule archive could not be loaded.",
      }),
    );
    expect(store.active).toBe(prior);
    expect(store.attempts).toEqual([]);
  });

  it("fails closed when snapshot storage is unavailable", async () => {
    const store = new MemorySnapshotStore(
      activeSnapshot(),
      undefined,
      new Error("database address must not leak"),
    );

    await expect(
      refreshGtfsSnapshot(
        { at: new Date("2026-08-19T18:00:00.000Z") },
        {
          archiveLoader: { load: async () => archive("new-feed") },
          snapshotStore: store,
          validationPolicy: minimalGtfsPolicy,
        },
      ),
    ).rejects.toEqual(
      expect.objectContaining<GtfsRefreshError>({
        name: "GtfsRefreshError",
        code: "STORE_UNAVAILABLE",
        message: "The trusted schedule snapshot could not be read or changed.",
      }),
    );
    expect(store.attempts).toEqual([]);
  });
});
