import { describe, expect, it } from "vitest";

import {
  createAdminCoverageService,
  type AdminCoverageReaders,
} from "@/server/services/admin-coverage";

const checkedAt = new Date("2026-08-20T12:00:00.000Z");
const sourceUpdatedAt = new Date("2026-08-20T11:59:00.000Z");

function readers(
  overrides: Partial<AdminCoverageReaders> = {},
): AdminCoverageReaders {
  return {
    readStaticCoverage: async () => ({
      state: "current",
      serviceDate: "2026-08-20",
      activeServiceCount: 6,
      counts: {
        stops: 3_238,
        routes: 68,
        trips: 50_690,
        stopTimes: 1_901_119,
        services: 6,
        shapePoints: 45_308,
      },
      checkedAt,
      sourceUpdatedAt,
      sourceUrl: "https://511.org/open-data/transit",
    }),
    readRealtimeCoverage: async () => [
      {
        feedType: "trip_updates",
        status: "current",
        entityCount: 120,
        checkedAt,
        sourceUpdatedAt,
        expiresAt: new Date("2026-08-20T12:05:00.000Z"),
        sourceUrl: "https://511.org/open-data/transit",
      },
      {
        feedType: "vehicles",
        status: "current",
        entityCount: 80,
        checkedAt,
        sourceUpdatedAt,
        expiresAt: new Date("2026-08-20T12:05:00.000Z"),
        sourceUrl: "https://511.org/open-data/transit",
      },
      {
        feedType: "alerts",
        status: "current",
        entityCount: 4,
        checkedAt,
        sourceUpdatedAt,
        expiresAt: new Date("2026-08-20T12:15:00.000Z"),
        sourceUrl: "https://511.org/open-data/transit",
      },
    ],
    readSourceCoverage: async () => [
      {
        key: "elevators",
        label: "ignored reader label",
        status: "current",
        rowCount: 33,
        checkedAt,
        sourceUpdatedAt,
        sourceUrl:
          "https://www.sfmta.com/elevator-status/elevatorstatus.php?src=prod",
      },
      {
        key: "accessibility_advisories",
        label: "ignored reader label",
        status: "current",
        rowCount: 11,
        checkedAt,
        sourceUpdatedAt,
        sourceUrl:
          "https://www.sfmta.com/travel-transit-updates?field_transit_type_disrupted_value=Accessibility",
      },
      {
        key: "stop_relocations",
        label: "ignored reader label",
        status: "current",
        rowCount: 6,
        checkedAt,
        sourceUpdatedAt,
        sourceUrl:
          "https://www.sfmta.com/travel-updates/temporary-stop-relocations",
      },
      {
        key: "stop_accessibility",
        label: "ignored reader label",
        status: "current",
        rowCount: 41,
        checkedAt,
        sourceUpdatedAt: null,
        sourceUrl:
          "https://www.sfmta.com/getting-around/sfmta-accessibility/muni-access-guide/access-muni-metro/muni-metro-accessible-stops",
      },
    ],
    ...overrides,
  };
}

describe("operator citywide coverage seam", () => {
  it("returns trusted static counts, realtime counts, source counts, and both timestamps", async () => {
    const coverage =
      await createAdminCoverageService(readers()).getCoverage(checkedAt);

    expect(coverage.status).toBe("current");
    expect(coverage.static).toMatchObject({
      status: "current",
      serviceDate: "2026-08-20",
      counts: {
        stops: 3_238,
        routes: 68,
        trips: 50_690,
        stopTimes: 1_901_119,
        services: 6,
        shapePoints: 45_308,
      },
      checkedAt,
      sourceUpdatedAt,
    });
    expect(coverage.realtime).toEqual([
      expect.objectContaining({
        feedType: "trip_updates",
        status: "current",
        entityCount: 120,
        checkedAt,
        sourceUpdatedAt,
      }),
      expect.objectContaining({
        feedType: "vehicles",
        status: "current",
        entityCount: 80,
        checkedAt,
        sourceUpdatedAt,
      }),
      expect.objectContaining({
        feedType: "alerts",
        status: "current",
        entityCount: 4,
        checkedAt,
        sourceUpdatedAt,
      }),
    ]);
    expect(coverage.sources).toEqual([
      expect.objectContaining({
        key: "elevators",
        rowCount: 33,
        checkedAt,
        sourceUpdatedAt,
      }),
      expect.objectContaining({
        key: "accessibility_advisories",
        rowCount: 11,
      }),
      expect.objectContaining({ key: "stop_relocations", rowCount: 6 }),
      expect.objectContaining({ key: "stop_accessibility", rowCount: 41 }),
    ]);
  });

  it("marks missing summaries unavailable without inventing counts or timestamps", async () => {
    const coverage = await createAdminCoverageService(
      readers({
        readStaticCoverage: async () => null,
        readRealtimeCoverage: async () => [
          {
            feedType: "trip_updates",
            status: "current",
            entityCount: 12,
            checkedAt,
            sourceUpdatedAt,
            expiresAt: new Date("2026-08-20T12:05:00.000Z"),
            sourceUrl: "https://511.org/open-data/transit",
          },
        ],
        readSourceCoverage: async () => [],
      }),
    ).getCoverage(checkedAt);

    expect(coverage.status).toBe("partial");
    expect(coverage.static).toMatchObject({
      status: "unavailable",
      counts: null,
      checkedAt: null,
      sourceUpdatedAt: null,
      sourceUrl: null,
    });
    expect(coverage.realtime).toEqual([
      expect.objectContaining({
        feedType: "trip_updates",
        status: "current",
        entityCount: 12,
      }),
      expect.objectContaining({
        feedType: "vehicles",
        status: "unavailable",
        entityCount: null,
        checkedAt: null,
        sourceUpdatedAt: null,
      }),
      expect.objectContaining({
        feedType: "alerts",
        status: "unavailable",
        entityCount: null,
        checkedAt: null,
        sourceUpdatedAt: null,
      }),
    ]);
    expect(coverage.sources).toHaveLength(4);
    expect(
      coverage.sources.every(
        (source) =>
          source.status === "unavailable" &&
          source.rowCount === null &&
          source.checkedAt === null &&
          source.sourceUpdatedAt === null,
      ),
    ).toBe(true);
  });

  it("isolates a static reader failure from trusted realtime and source summaries", async () => {
    const coverage = await createAdminCoverageService(
      readers({
        readStaticCoverage: async () => {
          throw new Error("static reader failed");
        },
      }),
    ).getCoverage(checkedAt);

    expect(coverage.status).toBe("partial");
    expect(coverage.static.status).toBe("unavailable");
    expect(coverage.realtime.every((feed) => feed.status === "current")).toBe(
      true,
    );
    expect(
      coverage.sources.every((source) => source.status === "current"),
    ).toBe(true);
  });

  it("isolates a realtime reader failure from trusted static and source summaries", async () => {
    const coverage = await createAdminCoverageService(
      readers({
        readRealtimeCoverage: async () => {
          throw new Error("realtime reader failed");
        },
      }),
    ).getCoverage(checkedAt);

    expect(coverage.status).toBe("partial");
    expect(coverage.static.status).toBe("current");
    expect(
      coverage.realtime.every((feed) => feed.status === "unavailable"),
    ).toBe(true);
    expect(
      coverage.sources.every((source) => source.status === "current"),
    ).toBe(true);
  });

  it("isolates a source reader failure from trusted static and realtime summaries", async () => {
    const coverage = await createAdminCoverageService(
      readers({
        readSourceCoverage: async () => {
          throw new Error("source reader failed");
        },
      }),
    ).getCoverage(checkedAt);

    expect(coverage.status).toBe("partial");
    expect(coverage.static.status).toBe("current");
    expect(coverage.realtime.every((feed) => feed.status === "current")).toBe(
      true,
    );
    expect(
      coverage.sources.every((source) => source.status === "unavailable"),
    ).toBe(true);
  });

  it("fails malformed rows closed while preserving valid rows in other fixed entries", async () => {
    const baseline = readers();
    const staticCoverage = await baseline.readStaticCoverage(checkedAt);
    const realtimeCoverage = await baseline.readRealtimeCoverage(checkedAt);
    const sourceCoverage = await baseline.readSourceCoverage(checkedAt);
    const coverage = await createAdminCoverageService(
      readers({
        readStaticCoverage: async () => ({
          ...(staticCoverage as Record<string, unknown>),
          counts: {
            ...((staticCoverage as Record<string, unknown>).counts as Record<
              string,
              unknown
            >),
            routes: -1,
          },
        }),
        readRealtimeCoverage: async () => [
          ...(realtimeCoverage as Array<Record<string, unknown>>).filter(
            (row) => row.feedType !== "alerts",
          ),
          {
            ...((realtimeCoverage as Array<Record<string, unknown>>).find(
              (row) => row.feedType === "alerts",
            ) as Record<string, unknown>),
            sourceUrl: "https://example.invalid/secret",
          },
        ],
        readSourceCoverage: async () => [
          ...(sourceCoverage as Array<Record<string, unknown>>).filter(
            (row) => row.key !== "elevators",
          ),
          {
            ...((sourceCoverage as Array<Record<string, unknown>>).find(
              (row) => row.key === "elevators",
            ) as Record<string, unknown>),
            rowCount: Number.NaN,
          },
        ],
      }),
    ).getCoverage(checkedAt);

    expect(coverage.static.status).toBe("unavailable");
    expect(
      coverage.realtime.find((feed) => feed.feedType === "alerts")?.status,
    ).toBe("unavailable");
    expect(
      coverage.realtime
        .filter((feed) => feed.feedType !== "alerts")
        .every((feed) => feed.status === "current"),
    ).toBe(true);
    expect(
      coverage.sources.find((source) => source.key === "elevators")?.status,
    ).toBe("unavailable");
    expect(
      coverage.sources
        .filter((source) => source.key !== "elevators")
        .every((source) => source.status === "current"),
    ).toBe(true);
  });

  it("keeps an expired but trusted realtime row visible as older", async () => {
    const baseline = readers();
    const realtimeCoverage = await baseline.readRealtimeCoverage(checkedAt);
    const coverage = await createAdminCoverageService(
      readers({
        readRealtimeCoverage: async () =>
          (realtimeCoverage as Array<Record<string, unknown>>).map((row) =>
            row.feedType === "trip_updates"
              ? {
                  ...row,
                  status: "older",
                  checkedAt: new Date("2026-08-20T11:50:00.000Z"),
                  sourceUpdatedAt: new Date("2026-08-20T11:49:00.000Z"),
                  expiresAt: new Date("2026-08-20T11:59:00.000Z"),
                }
              : row,
          ),
      }),
    ).getCoverage(checkedAt);

    expect(
      coverage.realtime.find((feed) => feed.feedType === "trip_updates"),
    ).toMatchObject({
      status: "older",
      entityCount: 120,
      checkedAt: new Date("2026-08-20T11:50:00.000Z"),
    });
    expect(coverage.status).toBe("partial");
  });

  it("fails closed when realtime status disagrees with its expiry", async () => {
    const baseline = readers();
    const realtimeCoverage = await baseline.readRealtimeCoverage(checkedAt);
    const coverage = await createAdminCoverageService(
      readers({
        readRealtimeCoverage: async () =>
          (realtimeCoverage as Array<Record<string, unknown>>).map((row) =>
            row.feedType === "trip_updates"
              ? {
                  ...row,
                  status: "current",
                  checkedAt: new Date("2026-08-20T11:50:00.000Z"),
                  sourceUpdatedAt: new Date("2026-08-20T11:49:00.000Z"),
                  expiresAt: new Date("2026-08-20T11:59:00.000Z"),
                }
              : row,
          ),
      }),
    ).getCoverage(checkedAt);

    expect(
      coverage.realtime.find((feed) => feed.feedType === "trip_updates"),
    ).toMatchObject({
      status: "unavailable",
      entityCount: null,
      checkedAt: null,
    });
  });

  it("fails closed when source status disagrees with its fixed freshness window", async () => {
    const baseline = readers();
    const sourceCoverage = await baseline.readSourceCoverage(checkedAt);
    const staleCheckedAt = new Date(checkedAt.getTime() - 12 * 60 * 1_000 - 1);
    const coverage = await createAdminCoverageService(
      readers({
        readSourceCoverage: async () =>
          (sourceCoverage as Array<Record<string, unknown>>).map((row) =>
            row.key === "elevators"
              ? {
                  ...row,
                  status: "current",
                  checkedAt: staleCheckedAt,
                  sourceUpdatedAt: new Date(staleCheckedAt.getTime() - 1_000),
                }
              : row,
          ),
      }),
    ).getCoverage(checkedAt);

    expect(
      coverage.sources.find((source) => source.key === "elevators"),
    ).toMatchObject({
      status: "unavailable",
      rowCount: null,
      checkedAt: null,
    });
  });

  it("fails closed when static evidence has zero or inconsistent meaningful counts", async () => {
    const baseline = readers();
    const staticCoverage = await baseline.readStaticCoverage(checkedAt);
    const coverage = await createAdminCoverageService(
      readers({
        readStaticCoverage: async () => ({
          ...(staticCoverage as Record<string, unknown>),
          activeServiceCount: 0,
          counts: {
            stops: 0,
            routes: 0,
            trips: 0,
            stopTimes: 0,
            services: 0,
            shapePoints: 0,
          },
        }),
      }),
    ).getCoverage(checkedAt);

    expect(coverage.static).toMatchObject({
      status: "unavailable",
      activeServiceCount: null,
      counts: null,
      checkedAt: null,
    });
    expect(coverage.realtime.every((feed) => feed.status === "current")).toBe(
      true,
    );
    expect(
      coverage.sources.every((source) => source.status === "current"),
    ).toBe(true);
  });

  it("rejects static active calendars that exceed the trusted service rows", async () => {
    const baseline = readers();
    const staticCoverage = await baseline.readStaticCoverage(checkedAt);
    const coverage = await createAdminCoverageService(
      readers({
        readStaticCoverage: async () => ({
          ...(staticCoverage as Record<string, unknown>),
          activeServiceCount: 7,
        }),
      }),
    ).getCoverage(checkedAt);

    expect(coverage.static).toMatchObject({
      status: "unavailable",
      activeServiceCount: null,
      counts: null,
      checkedAt: null,
    });
  });

  it("marks duplicate entries unavailable instead of selecting one silently", async () => {
    const baseline = readers();
    const realtimeCoverage = await baseline.readRealtimeCoverage(checkedAt);
    const sourceCoverage = await baseline.readSourceCoverage(checkedAt);
    const coverage = await createAdminCoverageService(
      readers({
        readRealtimeCoverage: async () => [
          ...(realtimeCoverage as Array<Record<string, unknown>>),
          ...(realtimeCoverage as Array<Record<string, unknown>>).filter(
            (row) => row.feedType === "trip_updates",
          ),
        ],
        readSourceCoverage: async () => [
          ...(sourceCoverage as Array<Record<string, unknown>>),
          ...(sourceCoverage as Array<Record<string, unknown>>).filter(
            (row) => row.key === "elevators",
          ),
        ],
      }),
    ).getCoverage(checkedAt);

    expect(
      coverage.realtime.find((feed) => feed.feedType === "trip_updates")
        ?.status,
    ).toBe("unavailable");
    expect(
      coverage.realtime
        .filter((feed) => feed.feedType !== "trip_updates")
        .every((feed) => feed.status === "current"),
    ).toBe(true);
    expect(
      coverage.sources.find((source) => source.key === "elevators")?.status,
    ).toBe("unavailable");
    expect(
      coverage.sources
        .filter((source) => source.key !== "elevators")
        .every((source) => source.status === "current"),
    ).toBe(true);
  });

  it("rejects future checked times and does not expose mutable reader objects", async () => {
    const baseline = readers();
    const staticCoverage = await baseline.readStaticCoverage(checkedAt);
    const realtimeCoverage = await baseline.readRealtimeCoverage(checkedAt);
    const sourceCoverage = await baseline.readSourceCoverage(checkedAt);
    const future = new Date("2026-08-20T12:00:01.000Z");
    const coverage = await createAdminCoverageService(
      readers({
        readStaticCoverage: async () => ({
          ...(staticCoverage as Record<string, unknown>),
          checkedAt: future,
        }),
        readRealtimeCoverage: async () => [
          ...(realtimeCoverage as Array<Record<string, unknown>>).filter(
            (row) => row.feedType !== "alerts",
          ),
          {
            ...((realtimeCoverage as Array<Record<string, unknown>>).find(
              (row) => row.feedType === "alerts",
            ) as Record<string, unknown>),
            checkedAt: future,
          },
        ],
        readSourceCoverage: async () => [
          ...(sourceCoverage as Array<Record<string, unknown>>).filter(
            (row) => row.key !== "elevators",
          ),
          {
            ...((sourceCoverage as Array<Record<string, unknown>>).find(
              (row) => row.key === "elevators",
            ) as Record<string, unknown>),
            checkedAt: future,
          },
        ],
      }),
    ).getCoverage(checkedAt);

    expect(coverage.static.status).toBe("unavailable");
    expect(
      coverage.realtime.find((feed) => feed.feedType === "alerts")?.status,
    ).toBe("unavailable");
    expect(
      coverage.sources.find((source) => source.key === "elevators")?.status,
    ).toBe("unavailable");

    const second =
      await createAdminCoverageService(readers()).getCoverage(checkedAt);
    coverage.static.counts = null;
    coverage.realtime[0]?.checkedAt?.setTime(0);
    coverage.sources.pop();
    expect(second.static.counts?.stops).toBe(3_238);
    expect(second.realtime).toHaveLength(3);
    expect(second.sources).toHaveLength(4);
  });
});
