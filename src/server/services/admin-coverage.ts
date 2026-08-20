import type { GtfsCoverageCounts } from "@/domain/transit/gtfs-validation";
import { ACCESSIBILITY_ADVISORY_SOURCE_URL } from "@/domain/transit/accessibility-advisories";
import { STOP_ACCESSIBILITY_GUIDE_SOURCE_URL } from "@/domain/transit/stop-accessibility-guides";
import { STOP_RELOCATION_SOURCE_URL } from "@/domain/transit/stop-relocations";
import { PRODUCTION_SOURCE_URL } from "@/lib/env";

export const ADMIN_STATIC_SOURCE_URL =
  "https://511.org/open-data/transit" as const;
export const ADMIN_REALTIME_SOURCE_URL =
  "https://511.org/open-data/transit" as const;

const STATIC_SOURCE_URLS = new Set([
  ADMIN_STATIC_SOURCE_URL,
  "https://api.511.org/transit/datafeeds?operator_id=SF",
]);

export const ADMIN_REALTIME_FEED_TYPES = [
  "trip_updates",
  "vehicles",
  "alerts",
] as const;

export const ADMIN_SOURCE_DEFINITIONS = [
  {
    key: "elevators",
    label: "Elevator observations",
    sourceUrl: PRODUCTION_SOURCE_URL,
    maxAgeMs: 12 * 60 * 1_000,
  },
  {
    key: "accessibility_advisories",
    label: "Accessibility advisories",
    sourceUrl: ACCESSIBILITY_ADVISORY_SOURCE_URL,
    maxAgeMs: 90 * 60 * 1_000,
  },
  {
    key: "stop_relocations",
    label: "Stop relocations",
    sourceUrl: STOP_RELOCATION_SOURCE_URL,
    maxAgeMs: 60 * 60 * 1_000,
  },
  {
    key: "stop_accessibility",
    label: "Accessible-stop guidance",
    sourceUrl: STOP_ACCESSIBILITY_GUIDE_SOURCE_URL,
    maxAgeMs: 36 * 60 * 60 * 1_000,
  },
] as const;

export type AdminRealtimeFeedType = (typeof ADMIN_REALTIME_FEED_TYPES)[number];
export type AdminSourceKey = (typeof ADMIN_SOURCE_DEFINITIONS)[number]["key"];
export type AdminCoverageStatus = "current" | "older" | "unavailable";

export type AdminStaticCoverage = {
  state: "current" | "older";
  serviceDate: string;
  activeServiceCount: number;
  counts: GtfsCoverageCounts;
  checkedAt: Date;
  sourceUpdatedAt: Date | null;
  sourceUrl: string;
};

export type AdminRealtimeCoverage = {
  feedType: AdminRealtimeFeedType;
  status: AdminCoverageStatus;
  entityCount: number | null;
  checkedAt: Date | null;
  sourceUpdatedAt: Date | null;
  expiresAt: Date | null;
  sourceUrl: string | null;
};

export type AdminSourceCoverage = {
  key: AdminSourceKey;
  label: string;
  status: AdminCoverageStatus;
  rowCount: number | null;
  checkedAt: Date | null;
  sourceUpdatedAt: Date | null;
  sourceUrl: string | null;
};

export type AdminCoverageReaders = {
  readStaticCoverage: (at: Date) => Promise<unknown>;
  readRealtimeCoverage: (at: Date) => Promise<unknown>;
  readSourceCoverage: (at: Date) => Promise<unknown>;
};

type AdminStaticCoverageView = {
  status: AdminCoverageStatus;
  state: "current" | "older" | null;
  serviceDate: string | null;
  activeServiceCount: number | null;
  counts: GtfsCoverageCounts | null;
  checkedAt: Date | null;
  sourceUpdatedAt: Date | null;
  sourceUrl: string | null;
};

export type AdminCoverageSnapshot = {
  status: "current" | "partial" | "unavailable";
  static: AdminStaticCoverageView;
  realtime: AdminRealtimeCoverage[];
  sources: AdminSourceCoverage[];
};

const MAX_EXPIRY_AHEAD_MS = 24 * 60 * 60 * 1_000;
const STATIC_COUNT_KEYS = [
  "stops",
  "routes",
  "trips",
  "stopTimes",
  "services",
  "shapePoints",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSafeText(value: unknown, maximumLength = 512): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength &&
    !/[<>\u0000-\u001f\u007f]/u.test(value)
  );
}

function isSafeCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function cloneDate(value: Date): Date {
  return new Date(value.getTime());
}

function readPastDate(value: unknown, at: Date): Date | null {
  if (!(value instanceof Date)) return null;
  const milliseconds = value.getTime();
  if (!Number.isFinite(milliseconds) || milliseconds > at.getTime())
    return null;
  return cloneDate(value);
}

function readExpirationDate(
  value: unknown,
  checkedAt: Date,
  at: Date,
): Date | null {
  if (!(value instanceof Date)) return null;
  const milliseconds = value.getTime();
  if (
    !Number.isFinite(milliseconds) ||
    milliseconds < checkedAt.getTime() ||
    milliseconds > at.getTime() + MAX_EXPIRY_AHEAD_MS
  ) {
    return null;
  }
  return cloneDate(value);
}

function isAllowedUrl(
  value: unknown,
  allowed: string | Set<string>,
): value is string {
  if (!isSafeText(value, 2_048)) return false;
  return typeof allowed === "string" ? value === allowed : allowed.has(value);
}

function pacificDate(at: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function isServiceDate(value: unknown, at: Date) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    return false;
  }
  const parts = value.split("-");
  if (parts.length !== 3) return false;
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (![year, month, day].every(Number.isSafeInteger)) return false;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day &&
    value <= pacificDate(at)
  );
}

function unavailableStatic(): AdminStaticCoverageView {
  return {
    status: "unavailable",
    state: null,
    serviceDate: null,
    activeServiceCount: null,
    counts: null,
    checkedAt: null,
    sourceUpdatedAt: null,
    sourceUrl: null,
  };
}

function unavailableRealtime(
  feedType: AdminRealtimeFeedType,
): AdminRealtimeCoverage {
  return {
    feedType,
    status: "unavailable",
    entityCount: null,
    checkedAt: null,
    sourceUpdatedAt: null,
    expiresAt: null,
    sourceUrl: null,
  };
}

function unavailableSource(
  definition: (typeof ADMIN_SOURCE_DEFINITIONS)[number],
): AdminSourceCoverage {
  return {
    key: definition.key,
    label: definition.label,
    status: "unavailable",
    rowCount: null,
    checkedAt: null,
    sourceUpdatedAt: null,
    sourceUrl: null,
  };
}

function normalizeStaticCoverage(
  value: unknown,
  at: Date,
): AdminStaticCoverageView {
  if (!isRecord(value)) return unavailableStatic();
  const state = value.state;
  const serviceDate = value.serviceDate;
  const checkedAt = readPastDate(value.checkedAt, at);
  const sourceUpdatedAt =
    value.sourceUpdatedAt === null
      ? null
      : readPastDate(value.sourceUpdatedAt, at);
  if (
    (state !== "current" && state !== "older") ||
    !isServiceDate(serviceDate, at) ||
    !checkedAt ||
    (value.sourceUpdatedAt !== null && !sourceUpdatedAt) ||
    (sourceUpdatedAt !== null &&
      sourceUpdatedAt.getTime() > checkedAt.getTime()) ||
    !isAllowedUrl(value.sourceUrl, STATIC_SOURCE_URLS)
  ) {
    return unavailableStatic();
  }
  if (!isSafeCount(value.activeServiceCount) || value.activeServiceCount <= 0) {
    return unavailableStatic();
  }
  const sourceCounts = value.counts;
  if (!isRecord(sourceCounts)) return unavailableStatic();
  const counts = Object.fromEntries(
    STATIC_COUNT_KEYS.map((key) => [key, sourceCounts[key]]),
  );
  if (
    !STATIC_COUNT_KEYS.every((key) => {
      const count = counts[key];
      return isSafeCount(count) && count > 0;
    })
  ) {
    return unavailableStatic();
  }
  const serviceCount = counts.services;
  if (!isSafeCount(serviceCount) || value.activeServiceCount > serviceCount) {
    return unavailableStatic();
  }
  return {
    status: state,
    state,
    serviceDate: serviceDate as string,
    activeServiceCount: value.activeServiceCount,
    counts: counts as GtfsCoverageCounts,
    checkedAt,
    sourceUpdatedAt,
    sourceUrl: ADMIN_STATIC_SOURCE_URL,
  };
}

function validRealtimeFeedType(value: unknown): value is AdminRealtimeFeedType {
  return (
    typeof value === "string" &&
    (ADMIN_REALTIME_FEED_TYPES as readonly string[]).includes(value)
  );
}

function normalizeRealtimeRow(
  value: unknown,
  feedType: AdminRealtimeFeedType,
  at: Date,
): AdminRealtimeCoverage {
  if (!isRecord(value) || value.feedType !== feedType) {
    return unavailableRealtime(feedType);
  }
  const status = value.status;
  if (status === "unavailable") return unavailableRealtime(feedType);
  if (status !== "current" && status !== "older") {
    return unavailableRealtime(feedType);
  }
  const checkedAt = readPastDate(value.checkedAt, at);
  const sourceUpdatedAt =
    value.sourceUpdatedAt === null
      ? null
      : readPastDate(value.sourceUpdatedAt, at);
  const expiresAt = readExpirationDate(value.expiresAt, checkedAt ?? at, at);
  if (
    !isSafeCount(value.entityCount) ||
    !checkedAt ||
    (value.sourceUpdatedAt !== null && !sourceUpdatedAt) ||
    (sourceUpdatedAt !== null &&
      sourceUpdatedAt.getTime() > checkedAt.getTime()) ||
    !expiresAt ||
    !isAllowedUrl(value.sourceUrl, ADMIN_REALTIME_SOURCE_URL)
  ) {
    return unavailableRealtime(feedType);
  }
  const derivedStatus =
    expiresAt.getTime() >= at.getTime() ? "current" : "older";
  if (status !== derivedStatus) return unavailableRealtime(feedType);
  return {
    feedType,
    status: derivedStatus,
    entityCount: value.entityCount,
    checkedAt,
    sourceUpdatedAt,
    expiresAt,
    sourceUrl: ADMIN_REALTIME_SOURCE_URL,
  };
}

function normalizeRealtimeCoverage(
  value: unknown,
  at: Date,
): AdminRealtimeCoverage[] {
  if (!Array.isArray(value)) {
    return ADMIN_REALTIME_FEED_TYPES.map(unavailableRealtime);
  }
  const rows = value.filter(isRecord);
  if (
    rows.length !== value.length ||
    rows.some((row) => !validRealtimeFeedType(row.feedType))
  ) {
    return ADMIN_REALTIME_FEED_TYPES.map(unavailableRealtime);
  }
  return ADMIN_REALTIME_FEED_TYPES.map((feedType) => {
    const matches = rows.filter((row) => row.feedType === feedType);
    return matches.length === 1
      ? normalizeRealtimeRow(matches[0], feedType, at)
      : unavailableRealtime(feedType);
  });
}

function normalizeSourceRow(
  value: unknown,
  definition: (typeof ADMIN_SOURCE_DEFINITIONS)[number],
  at: Date,
): AdminSourceCoverage {
  if (!isRecord(value) || value.key !== definition.key) {
    return unavailableSource(definition);
  }
  const status = value.status;
  if (status === "unavailable") return unavailableSource(definition);
  if (status !== "current" && status !== "older") {
    return unavailableSource(definition);
  }
  const checkedAt = readPastDate(value.checkedAt, at);
  const sourceUpdatedAt =
    value.sourceUpdatedAt === null
      ? null
      : readPastDate(value.sourceUpdatedAt, at);
  if (
    !isSafeCount(value.rowCount) ||
    !checkedAt ||
    (value.sourceUpdatedAt !== null && !sourceUpdatedAt) ||
    (sourceUpdatedAt !== null &&
      sourceUpdatedAt.getTime() > checkedAt.getTime()) ||
    !isAllowedUrl(value.sourceUrl, definition.sourceUrl)
  ) {
    return unavailableSource(definition);
  }
  const derivedStatus = freshnessStatus(checkedAt, at, definition.maxAgeMs);
  if (status !== derivedStatus) return unavailableSource(definition);
  return {
    key: definition.key,
    label: definition.label,
    status: derivedStatus,
    rowCount: value.rowCount,
    checkedAt,
    sourceUpdatedAt,
    sourceUrl: definition.sourceUrl,
  };
}

function normalizeSourceCoverage(
  value: unknown,
  at: Date,
): AdminSourceCoverage[] {
  if (!Array.isArray(value)) {
    return ADMIN_SOURCE_DEFINITIONS.map(unavailableSource);
  }
  const rows = value.filter(isRecord);
  if (
    rows.length !== value.length ||
    rows.some(
      (row) =>
        typeof row.key !== "string" ||
        !ADMIN_SOURCE_DEFINITIONS.some(
          (definition) => definition.key === row.key,
        ),
    )
  ) {
    return ADMIN_SOURCE_DEFINITIONS.map(unavailableSource);
  }
  return ADMIN_SOURCE_DEFINITIONS.map((definition) => {
    const matches = rows.filter((row) => row.key === definition.key);
    return matches.length === 1
      ? normalizeSourceRow(matches[0], definition, at)
      : unavailableSource(definition);
  });
}

function overallStatus(snapshot: Omit<AdminCoverageSnapshot, "status">) {
  const statuses = [
    snapshot.static.status,
    ...snapshot.realtime.map((feed) => feed.status),
    ...snapshot.sources.map((source) => source.status),
  ];
  if (statuses.every((status) => status === "unavailable"))
    return "unavailable" as const;
  if (statuses.every((status) => status === "current"))
    return "current" as const;
  return "partial" as const;
}

async function readSafely(
  reader: (at: Date) => Promise<unknown>,
  at: Date,
): Promise<unknown> {
  try {
    return await reader(at);
  } catch {
    return null;
  }
}

function unavailableSnapshot(): AdminCoverageSnapshot {
  const staticCoverage = unavailableStatic();
  const realtime = ADMIN_REALTIME_FEED_TYPES.map(unavailableRealtime);
  const sources = ADMIN_SOURCE_DEFINITIONS.map(unavailableSource);
  return {
    status: "unavailable",
    static: staticCoverage,
    realtime,
    sources,
  };
}

export function createAdminCoverageService(readers: AdminCoverageReaders) {
  return {
    async getCoverage(at = new Date()): Promise<AdminCoverageSnapshot> {
      if (!(at instanceof Date) || !Number.isFinite(at.getTime())) {
        return unavailableSnapshot();
      }
      const checkedAt = cloneDate(at);
      const [staticResult, realtimeResult, sourceResult] = await Promise.all([
        readSafely(readers.readStaticCoverage, checkedAt),
        readSafely(readers.readRealtimeCoverage, checkedAt),
        readSafely(readers.readSourceCoverage, checkedAt),
      ]);
      const snapshot = {
        static: normalizeStaticCoverage(staticResult, checkedAt),
        realtime: normalizeRealtimeCoverage(realtimeResult, checkedAt),
        sources: normalizeSourceCoverage(sourceResult, checkedAt),
      };
      return {
        status: overallStatus(snapshot),
        static: snapshot.static,
        realtime: snapshot.realtime,
        sources: snapshot.sources,
      };
    },
  };
}

function freshnessStatus(
  checkedAt: Date,
  at: Date,
  maxAgeMs: number,
): "current" | "older" {
  return at.getTime() - checkedAt.getTime() <= maxAgeMs ? "current" : "older";
}

async function readProductionStaticCoverage(at: Date): Promise<unknown> {
  const { getTransitCoverage } = await import("@/server/transit/coverage");
  const snapshot = await getTransitCoverage(at);
  if (!snapshot) return null;
  return {
    state: snapshot.state,
    serviceDate: snapshot.coverage.serviceDate,
    activeServiceCount: snapshot.coverage.activeServiceCount,
    counts: { ...snapshot.coverage.counts },
    checkedAt: new Date(snapshot.checkedAt),
    sourceUpdatedAt: snapshot.sourceUpdatedAt
      ? new Date(snapshot.sourceUpdatedAt)
      : null,
    sourceUrl: snapshot.sourceUrl,
  } satisfies AdminStaticCoverage;
}

async function readProductionRealtimeCoverage(at: Date): Promise<unknown> {
  const [{ db }, { and, desc, eq, lte, sql: drizzleSql }, schema] =
    await Promise.all([
      import("@/server/db/client"),
      import("drizzle-orm"),
      import("@/server/db/schema/transit"),
    ]);
  const active = await db.query.transitFeedSnapshots.findFirst({
    columns: { id: true },
    where: eq(schema.transitFeedSnapshots.status, "active"),
    orderBy: (table, helpers) => [helpers.desc(table.acceptedAt)],
  });
  if (!active) return [];
  const rows = await db
    .select({
      feedType: schema.realtimeFeedSnapshots.feedType,
      entityCount: schema.realtimeFeedSnapshots.entityCount,
      checkedAt: schema.realtimeFeedSnapshots.checkedAt,
      sourceUpdatedAt: schema.realtimeFeedSnapshots.sourceUpdatedAt,
      expiresAt: schema.realtimeFeedSnapshots.expiresAt,
    })
    .from(schema.realtimeFeedSnapshots)
    .where(
      and(
        eq(schema.realtimeFeedSnapshots.transitSnapshotId, active.id),
        eq(schema.realtimeFeedSnapshots.valid, true),
        lte(schema.realtimeFeedSnapshots.checkedAt, at),
        drizzleSql`${schema.realtimeFeedSnapshots.validationReport}->>'kind' = 'trusted'`,
      ),
    )
    .orderBy(desc(schema.realtimeFeedSnapshots.checkedAt));
  const latest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!latest.has(row.feedType)) latest.set(row.feedType, row);
  }
  return [...latest.values()].map((row) => ({
    feedType: row.feedType,
    entityCount: row.entityCount,
    checkedAt: row.checkedAt,
    sourceUpdatedAt: row.sourceUpdatedAt,
    expiresAt: row.expiresAt,
    status:
      row.expiresAt instanceof Date && row.expiresAt.getTime() >= at.getTime()
        ? "current"
        : "older",
    sourceUrl: ADMIN_REALTIME_SOURCE_URL,
  }));
}

async function readProductionSourceCoverage(at: Date): Promise<unknown> {
  const [{ db }, { and, desc, eq }, schema] = await Promise.all([
    import("@/server/db/client"),
    import("drizzle-orm"),
    import("@/server/db/schema"),
  ]);
  const [[elevator], sourceRows] = await Promise.all([
    db
      .select({
        checkedAt: schema.trustedSnapshots.collectedAt,
        sourceUpdatedAt: schema.trustedSnapshots.sourceValidAt,
        rowCount: schema.collectionRuns.rowCount,
        acceptedAt: schema.trustedSnapshots.acceptedAt,
      })
      .from(schema.trustedSnapshots)
      .innerJoin(
        schema.collectionRuns,
        eq(schema.trustedSnapshots.collectionRunId, schema.collectionRuns.id),
      )
      .where(
        and(
          eq(schema.trustedSnapshots.trustState, "current"),
          eq(schema.collectionRuns.status, "accepted"),
        ),
      )
      .orderBy(desc(schema.trustedSnapshots.acceptedAt))
      .limit(1),
    db
      .select({
        key: schema.sourceSnapshots.kind,
        checkedAt: schema.sourceSnapshots.checkedAt,
        sourceUpdatedAt: schema.sourceSnapshots.sourceUpdatedAt,
        rowCount: schema.sourceSnapshots.rowCount,
        acceptedAt: schema.sourceSnapshots.acceptedAt,
      })
      .from(schema.sourceSnapshots)
      .where(eq(schema.sourceSnapshots.status, "current"))
      .orderBy(
        desc(schema.sourceSnapshots.acceptedAt),
        desc(schema.sourceSnapshots.checkedAt),
      ),
  ]);
  const sourceCoverage: Array<Record<string, unknown>> = [];
  if (elevator) {
    sourceCoverage.push({
      key: "elevators",
      status: freshnessStatus(
        elevator.checkedAt,
        at,
        ADMIN_SOURCE_DEFINITIONS[0].maxAgeMs,
      ),
      rowCount: elevator.rowCount,
      checkedAt: elevator.checkedAt,
      sourceUpdatedAt: elevator.sourceUpdatedAt,
      sourceUrl: PRODUCTION_SOURCE_URL,
    });
  }
  const seen = new Set<string>();
  for (const row of sourceRows) {
    if (seen.has(row.key)) continue;
    seen.add(row.key);
    const definition = ADMIN_SOURCE_DEFINITIONS.find(
      (candidate) => candidate.key === row.key,
    );
    if (!definition) continue;
    sourceCoverage.push({
      key: definition.key,
      status: freshnessStatus(row.checkedAt, at, definition.maxAgeMs),
      rowCount: row.rowCount,
      checkedAt: row.checkedAt,
      sourceUpdatedAt: row.sourceUpdatedAt,
      sourceUrl: definition.sourceUrl,
    });
  }
  return sourceCoverage;
}

export function createProductionAdminCoverageReaders(): AdminCoverageReaders {
  return {
    readStaticCoverage: readProductionStaticCoverage,
    readRealtimeCoverage: readProductionRealtimeCoverage,
    readSourceCoverage: readProductionSourceCoverage,
  };
}

export async function getAdminCoverage(at = new Date()) {
  return createAdminCoverageService(
    createProductionAdminCoverageReaders(),
  ).getCoverage(at);
}
