import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";

import {
  incidentStateValues,
  runClassificationValues,
  runStatusValues,
  type ComponentStatusValue,
  type IncidentStateValue,
  type RunClassificationValue,
  type RunStatusValue,
} from "@/lib/operator-labels";
import { formatDuration } from "@/lib/format";
import { db } from "@/server/db/client";
import {
  collectionRuns,
  componentChecks,
  equipment,
  equipmentStatusEvents,
  incidents,
  jobs,
  observations,
  operatorActions,
  rawPayloads,
  stationStatusEvents,
  stations,
  trustedSnapshots,
  user,
  workerHeartbeats,
} from "@/server/db/schema";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;
const EXPORT_LIMIT = 10_000;
const TRUST_FRESHNESS_SECONDS = 10 * 60;
const WORKER_FRESHNESS_SECONDS = 90;

type QuerySource = URLSearchParams | Record<string, string | string[] | undefined>;

function queryValue(source: QuerySource, key: string) {
  const raw = source instanceof URLSearchParams ? source.get(key) : source[key];
  return (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";
}

function parsePageSize(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed)
    ? Math.min(MAX_PAGE_SIZE, Math.max(5, parsed))
    : DEFAULT_PAGE_SIZE;
}

function parseDate(value: string, endOfDay = false) {
  if (!value) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`
    : value;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseChoice<T extends readonly string[]>(value: string, choices: T) {
  return choices.includes(value) ? value : "all";
}

function encodeCursor(value: Record<string, string | number>, sort: string) {
  return Buffer.from(JSON.stringify({ ...value, sort }), "utf8").toString("base64url");
}

function decodeCursor(value: string) {
  if (!value || value.length > 512) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    return parsed;
  } catch {
    return null;
  }
}

function parseCursorDate(value: unknown) {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function safeSearch(value: string) {
  return value.trim().slice(0, 120);
}

export type RunSort = "newest" | "oldest";

export type RunFilters = {
  q: string;
  status: RunStatusValue | "all";
  classification: RunClassificationValue | "all";
  trigger: string;
  from: Date | null;
  to: Date | null;
  sort: RunSort;
  cursor: string;
  pageSize: number;
};

export function parseRunFilters(source: QuerySource): RunFilters {
  const sort = queryValue(source, "sort");
  return {
    q: safeSearch(queryValue(source, "q")),
    status: parseChoice(queryValue(source, "status"), runStatusValues) as
      | RunStatusValue
      | "all",
    classification: parseChoice(
      queryValue(source, "classification"),
      runClassificationValues,
    ) as RunClassificationValue | "all",
    trigger: queryValue(source, "trigger") || "all",
    from: parseDate(queryValue(source, "from")),
    to: parseDate(queryValue(source, "to"), true),
    sort: sort === "oldest" ? "oldest" : "newest",
    cursor: queryValue(source, "cursor"),
    pageSize: parsePageSize(queryValue(source, "pageSize")),
  };
}

function runWhere(filters: RunFilters, includeCursor: boolean) {
  const conditions = [];
  if (filters.q) {
    const pattern = `%${filters.q}%`;
    conditions.push(sql`(
      cast(${collectionRuns.id} as text) ilike ${pattern}
      or ${collectionRuns.trigger} ilike ${pattern}
      or cast(${collectionRuns.status} as text) ilike ${pattern}
      or cast(${collectionRuns.classification} as text) ilike ${pattern}
    )`);
  }
  if (filters.status !== "all") conditions.push(eq(collectionRuns.status, filters.status));
  if (filters.classification !== "all") {
    conditions.push(eq(collectionRuns.classification, filters.classification));
  }
  if (filters.trigger !== "all") conditions.push(eq(collectionRuns.trigger, filters.trigger));
  if (filters.from) conditions.push(gte(collectionRuns.createdAt, filters.from));
  if (filters.to) conditions.push(lte(collectionRuns.createdAt, filters.to));

  if (includeCursor) {
    const cursor = decodeCursor(filters.cursor);
    const cursorDate = parseCursorDate(cursor?.value);
    const cursorId = typeof cursor?.id === "string" ? cursor.id : null;
    if (
      cursor?.sort === filters.sort &&
      cursorDate &&
      cursorId
    ) {
      conditions.push(
        filters.sort === "oldest"
          ? or(
              gt(collectionRuns.createdAt, cursorDate),
              and(eq(collectionRuns.createdAt, cursorDate), gt(collectionRuns.id, cursorId)),
            )
          : or(
              lt(collectionRuns.createdAt, cursorDate),
              and(eq(collectionRuns.createdAt, cursorDate), lt(collectionRuns.id, cursorId)),
            ),
      );
    }
  }
  return and(...conditions);
}

export async function queryRuns(filters: RunFilters) {
  const baseWhere = runWhere(filters, false);
  const where = runWhere(filters, true);
  const [rows, totalRows] = await Promise.all([
    db
      .select()
      .from(collectionRuns)
      .where(where)
      .orderBy(
        filters.sort === "oldest" ? asc(collectionRuns.createdAt) : desc(collectionRuns.createdAt),
        filters.sort === "oldest" ? asc(collectionRuns.id) : desc(collectionRuns.id),
      )
      .limit(filters.pageSize + 1),
    db.select({ total: count() }).from(collectionRuns).where(baseWhere),
  ]);
  const hasNext = rows.length > filters.pageSize;
  const visibleRows = rows.slice(0, filters.pageSize);
  const last = visibleRows.at(-1);
  return {
    rows: visibleRows,
    total: Number(totalRows[0]?.total ?? 0),
    hasNext,
    nextCursor:
      hasNext && last
        ? encodeCursor({ value: last.createdAt.toISOString(), id: last.id }, filters.sort)
        : null,
  };
}

export type IncidentFilters = {
  q: string;
  state: IncidentStateValue | "all";
  classification: RunClassificationValue | "all";
  from: Date | null;
  to: Date | null;
  sort: RunSort;
  cursor: string;
  pageSize: number;
};

export function parseIncidentFilters(source: QuerySource): IncidentFilters {
  return {
    q: safeSearch(queryValue(source, "q")),
    state: parseChoice(queryValue(source, "state"), incidentStateValues) as
      | IncidentStateValue
      | "all",
    classification: parseChoice(
      queryValue(source, "classification"),
      runClassificationValues,
    ) as RunClassificationValue | "all",
    from: parseDate(queryValue(source, "from")),
    to: parseDate(queryValue(source, "to"), true),
    sort: queryValue(source, "sort") === "oldest" ? "oldest" : "newest",
    cursor: queryValue(source, "cursor"),
    pageSize: parsePageSize(queryValue(source, "pageSize")),
  };
}

function incidentWhere(filters: IncidentFilters, includeCursor: boolean) {
  const conditions = [];
  if (filters.q) {
    const pattern = `%${filters.q}%`;
    conditions.push(sql`(
      cast(${incidents.id} as text) ilike ${pattern}
      or ${incidents.title} ilike ${pattern}
      or ${incidents.summary} ilike ${pattern}
      or cast(${incidents.state} as text) ilike ${pattern}
      or cast(${incidents.classification} as text) ilike ${pattern}
    )`);
  }
  if (filters.state !== "all") conditions.push(eq(incidents.state, filters.state));
  if (filters.classification !== "all") {
    conditions.push(eq(incidents.classification, filters.classification));
  }
  if (filters.from) conditions.push(gte(incidents.detectedAt, filters.from));
  if (filters.to) conditions.push(lte(incidents.detectedAt, filters.to));

  if (includeCursor) {
    const cursor = decodeCursor(filters.cursor);
    const cursorDate = parseCursorDate(cursor?.value);
    const cursorId = typeof cursor?.id === "string" ? cursor.id : null;
    if (
      cursor?.sort === filters.sort &&
      cursorDate &&
      cursorId
    ) {
      conditions.push(
        filters.sort === "oldest"
          ? or(
              gt(incidents.detectedAt, cursorDate),
              and(eq(incidents.detectedAt, cursorDate), gt(incidents.id, cursorId)),
            )
          : or(
              lt(incidents.detectedAt, cursorDate),
              and(eq(incidents.detectedAt, cursorDate), lt(incidents.id, cursorId)),
            ),
      );
    }
  }
  return and(...conditions);
}

export async function queryIncidents(filters: IncidentFilters) {
  const baseWhere = incidentWhere(filters, false);
  const where = incidentWhere(filters, true);
  const [rows, totalRows] = await Promise.all([
    db
      .select()
      .from(incidents)
      .where(where)
      .orderBy(
        filters.sort === "oldest" ? asc(incidents.detectedAt) : desc(incidents.detectedAt),
        filters.sort === "oldest" ? asc(incidents.id) : desc(incidents.id),
      )
      .limit(filters.pageSize + 1),
    db.select({ total: count() }).from(incidents).where(baseWhere),
  ]);
  const hasNext = rows.length > filters.pageSize;
  const visibleRows = rows.slice(0, filters.pageSize);
  const last = visibleRows.at(-1);
  return {
    rows: visibleRows,
    total: Number(totalRows[0]?.total ?? 0),
    hasNext,
    nextCursor:
      hasNext && last
        ? encodeCursor({ value: last.detectedAt.toISOString(), id: last.id }, filters.sort)
        : null,
  };
}

export type EquipmentFilters = {
  q: string;
  status: string;
  station: string;
  cursor: string;
  pageSize: number;
};

export function parseEquipmentFilters(source: QuerySource): EquipmentFilters {
  return {
    q: safeSearch(queryValue(source, "q")),
    status: queryValue(source, "status") || "all",
    station: queryValue(source, "station") || "all",
    cursor: queryValue(source, "cursor"),
    pageSize: parsePageSize(queryValue(source, "pageSize")),
  };
}

function equipmentWhere(filters: EquipmentFilters, snapshotId: string, includeCursor: boolean) {
  const conditions = [eq(observations.collectionRunId, snapshotId)];
  if (filters.q) {
    const pattern = `%${filters.q}%`;
    conditions.push(
      sql`(
        ${stations.displayName} ilike ${pattern}
        or ${equipment.displayName} ilike ${pattern}
        or ${equipment.sourceKey} ilike ${pattern}
      )` as never,
    );
  }
  if (filters.status !== "all") {
    conditions.push(sql`${observations.equipmentStatus} = ${filters.status}` as never);
  }
  if (filters.station !== "all") conditions.push(eq(stations.slug, filters.station) as never);

  if (includeCursor) {
    const cursor = decodeCursor(filters.cursor);
    const order = typeof cursor?.order === "number" ? cursor.order : null;
    const name = typeof cursor?.name === "string" ? cursor.name : null;
    const id = typeof cursor?.id === "string" ? cursor.id : null;
    if (order !== null && name && id) {
      conditions.push(
        or(
          gt(stations.corridorOrder, order),
          and(eq(stations.corridorOrder, order), gt(equipment.displayName, name)),
          and(
            eq(stations.corridorOrder, order),
            eq(equipment.displayName, name),
            gt(equipment.id, id),
          ),
        ) as never,
      );
    }
  }
  return and(...conditions);
}

export async function queryEquipment(filters: EquipmentFilters) {
  const [snapshot] = await db
    .select()
    .from(trustedSnapshots)
    .orderBy(desc(trustedSnapshots.acceptedAt))
    .limit(1);
  if (!snapshot) {
    return { snapshot: null, rows: [], total: 0, hasNext: false, nextCursor: null };
  }
  const select = {
    equipmentId: equipment.id,
    stationId: stations.id,
    stationSlug: stations.slug,
    stationName: stations.displayName,
    corridorOrder: stations.corridorOrder,
    elevatorName: equipment.displayName,
    sourceKey: equipment.sourceKey,
    equipmentStatus: observations.equipmentStatus,
    reportedStationAccessibility: observations.reportedStationAccessibility,
    sourceValidAt: observations.sourceValidAt,
    sourceLastChangedAt: observations.sourceLastChangedAt,
    observedAt: observations.observedAt,
  };
  const [rows, totalRows] = await Promise.all([
    db
      .select(select)
      .from(observations)
      .innerJoin(equipment, eq(observations.equipmentId, equipment.id))
      .innerJoin(stations, eq(observations.stationId, stations.id))
      .where(equipmentWhere(filters, snapshot.collectionRunId, true))
      .orderBy(asc(stations.corridorOrder), asc(equipment.displayName), asc(equipment.id))
      .limit(filters.pageSize + 1),
    db
      .select({ total: count() })
      .from(observations)
      .innerJoin(equipment, eq(observations.equipmentId, equipment.id))
      .innerJoin(stations, eq(observations.stationId, stations.id))
      .where(equipmentWhere(filters, snapshot.collectionRunId, false)),
  ]);
  const hasNext = rows.length > filters.pageSize;
  const visibleRows = rows.slice(0, filters.pageSize);
  const last = visibleRows.at(-1);
  return {
    snapshot,
    rows: visibleRows,
    total: Number(totalRows[0]?.total ?? 0),
    hasNext,
    nextCursor:
      hasNext && last
        ? encodeCursor(
            { order: last.corridorOrder, name: last.elevatorName, id: last.equipmentId },
            "station",
          )
        : null,
  };
}

export type AuditFilters = {
  q: string;
  action: string;
  outcome: string;
  from: Date | null;
  to: Date | null;
  sort: RunSort;
  cursor: string;
  pageSize: number;
};

export function parseAuditFilters(source: QuerySource): AuditFilters {
  return {
    q: safeSearch(queryValue(source, "q")),
    action: queryValue(source, "action") || "all",
    outcome: queryValue(source, "outcome") || "all",
    from: parseDate(queryValue(source, "from")),
    to: parseDate(queryValue(source, "to"), true),
    sort: queryValue(source, "sort") === "oldest" ? "oldest" : "newest",
    cursor: queryValue(source, "cursor"),
    pageSize: parsePageSize(queryValue(source, "pageSize")),
  };
}

function auditWhere(filters: AuditFilters, includeCursor: boolean) {
  const conditions = [];
  if (filters.q) {
    const pattern = `%${filters.q}%`;
    conditions.push(sql`(
      cast(${operatorActions.id} as text) ilike ${pattern}
      or ${operatorActions.action} ilike ${pattern}
      or ${operatorActions.targetId} ilike ${pattern}
      or ${operatorActions.outcome} ilike ${pattern}
      or ${operatorActions.actorUserId} ilike ${pattern}
      or ${user.name} ilike ${pattern}
    )`);
  }
  if (filters.action !== "all") conditions.push(eq(operatorActions.action, filters.action));
  if (filters.outcome !== "all") conditions.push(eq(operatorActions.outcome, filters.outcome));
  if (filters.from) conditions.push(gte(operatorActions.createdAt, filters.from));
  if (filters.to) conditions.push(lte(operatorActions.createdAt, filters.to));

  if (includeCursor) {
    const cursor = decodeCursor(filters.cursor);
    const cursorDate = parseCursorDate(cursor?.value);
    const cursorId = typeof cursor?.id === "string" ? cursor.id : null;
    if (
      cursor?.sort === filters.sort &&
      cursorDate &&
      cursorId
    ) {
      conditions.push(
        filters.sort === "oldest"
          ? or(
              gt(operatorActions.createdAt, cursorDate),
              and(eq(operatorActions.createdAt, cursorDate), gt(operatorActions.id, cursorId)),
            )
          : or(
              lt(operatorActions.createdAt, cursorDate),
              and(eq(operatorActions.createdAt, cursorDate), lt(operatorActions.id, cursorId)),
            ),
      );
    }
  }
  return and(...conditions);
}

const AUDIT_METADATA_BLOCKED = /(prompt|token|secret|password|authorization|body|payload|envelope)/i;

export function sanitizedMetadata(metadata: Record<string, unknown> | null | undefined) {
  if (!metadata) return {};
  return Object.fromEntries(
    Object.entries(metadata).filter(
      ([key, value]) =>
        !AUDIT_METADATA_BLOCKED.test(key) &&
        (["string", "number", "boolean"].includes(typeof value) || value === null),
    ),
  );
}

export async function queryAudit(filters: AuditFilters) {
  const baseWhere = auditWhere(filters, false);
  const where = auditWhere(filters, true);
  const [rows, totalRows] = await Promise.all([
    db
      .select({
        id: operatorActions.id,
        actorUserId: operatorActions.actorUserId,
        actorName: user.name,
        action: operatorActions.action,
        targetType: operatorActions.targetType,
        targetId: operatorActions.targetId,
        idempotencyKey: operatorActions.idempotencyKey,
        requestHash: operatorActions.requestHash,
        outcome: operatorActions.outcome,
        metadata: operatorActions.metadata,
        createdAt: operatorActions.createdAt,
      })
      .from(operatorActions)
      .leftJoin(user, eq(operatorActions.actorUserId, user.id))
      .where(where)
      .orderBy(
        filters.sort === "oldest" ? asc(operatorActions.createdAt) : desc(operatorActions.createdAt),
        filters.sort === "oldest" ? asc(operatorActions.id) : desc(operatorActions.id),
      )
      .limit(filters.pageSize + 1),
    db
      .select({ total: count() })
      .from(operatorActions)
      .leftJoin(user, eq(operatorActions.actorUserId, user.id))
      .where(baseWhere),
  ]);
  const hasNext = rows.length > filters.pageSize;
  const visibleRows = rows.slice(0, filters.pageSize);
  const last = visibleRows.at(-1);
  return {
    rows: visibleRows,
    total: Number(totalRows[0]?.total ?? 0),
    hasNext,
    nextCursor:
      hasNext && last
        ? encodeCursor({ value: last.createdAt.toISOString(), id: last.id }, filters.sort)
        : null,
  };
}

export async function getOperationsSnapshot(now = new Date()) {
  const startedAt = performance.now();
  const [[latestRun], [latestTrusted], activeJobs, [activeIncidentCount], [heartbeat], recentRuns, checks] =
    await Promise.all([
      db.select().from(collectionRuns).orderBy(desc(collectionRuns.createdAt)).limit(1),
      db.select().from(trustedSnapshots).orderBy(desc(trustedSnapshots.acceptedAt)).limit(1),
      db
        .select({ id: jobs.id, type: jobs.type, status: jobs.status, scheduledFor: jobs.scheduledFor })
        .from(jobs)
        .where(sql`${jobs.status} in ('queued', 'running')`)
        .orderBy(asc(jobs.scheduledFor))
        .limit(100),
      db
        .select({ total: count() })
        .from(incidents)
        .where(
          sql`${incidents.state} in ('detected', 'acknowledged', 'heal_requested', 'preview_received', 'preview_rejected', 'awaiting_review', 'awaiting_approval', 'approved', 'verification_failed')`,
        ),
      db.select().from(workerHeartbeats).orderBy(desc(workerHeartbeats.lastSeenAt)).limit(1),
      db.select().from(collectionRuns).orderBy(desc(collectionRuns.createdAt)).limit(100),
      db.select().from(componentChecks).orderBy(desc(componentChecks.checkedAt)).limit(100),
    ]);
  const databaseLatencyMs = Math.max(0, Math.round(performance.now() - startedAt));
  const latestChecks = new Map<string, (typeof checks)[number]>();
  for (const check of checks) {
    if (!latestChecks.has(check.component)) latestChecks.set(check.component, check);
  }

  const workerAgeSeconds = heartbeat
    ? Math.max(0, Math.floor((now.getTime() - heartbeat.lastSeenAt.getTime()) / 1_000))
    : null;
  const workerStatus: ComponentStatusValue =
    workerAgeSeconds !== null && workerAgeSeconds <= WORKER_FRESHNESS_SECONDS
      ? "operational"
      : heartbeat
        ? "outage"
        : "unknown";

  const newerUpdateHeld = Boolean(
    latestRun &&
      latestTrusted &&
      latestRun.id !== latestTrusted.collectionRunId &&
      latestRun.createdAt > latestTrusted.acceptedAt &&
      latestRun.status !== "accepted",
  );
  const trustAgeSeconds = latestTrusted
    ? Math.max(0, Math.floor((now.getTime() - latestTrusted.sourceValidAt.getTime()) / 1_000))
    : null;
  const trustState = !latestTrusted
    ? "unavailable"
    : trustAgeSeconds !== null && trustAgeSeconds <= TRUST_FRESHNESS_SECONDS && !newerUpdateHeld
      ? "current"
      : "held_stale";

  const completedRuns = recentRuns.filter((run) => ["accepted", "rejected", "failed"].includes(run.status));
  const acceptedRuns = completedRuns.filter((run) => run.status === "accepted");
  const durations = completedRuns
    .filter((run) => run.startedAt && run.finishedAt)
    .map((run) => run.finishedAt!.getTime() - run.startedAt!.getTime());
  const activeJobTypes = Object.entries(
    activeJobs.reduce<Record<string, number>>((result, job) => {
      result[job.type] = (result[job.type] ?? 0) + 1;
      return result;
    }, {}),
  ).sort(([, left], [, right]) => right - left);

  function component(
    key: string,
    name: string,
    fallbackStatus: ComponentStatusValue,
    fallbackDetail: string,
    fallbackCheckedAt = now,
    fallbackLatencyMs: number | null = null,
  ) {
    const check = latestChecks.get(key);
    return {
      key,
      name,
      status: (check?.status ?? fallbackStatus) as ComponentStatusValue,
      detail: check?.message ?? fallbackDetail,
      checkedAt: check?.checkedAt ?? fallbackCheckedAt,
      latencyMs: check?.latencyMs ?? fallbackLatencyMs,
    };
  }

  const collectorFallback: ComponentStatusValue =
    latestRun?.status === "accepted"
      ? "operational"
      : latestRun?.status === "failed"
        ? "outage"
        : latestRun
          ? "degraded"
          : "unknown";
  const components = [
    component("web", "Web application", "operational", "This protected console served the request.", now, databaseLatencyMs),
    component("database", "PostgreSQL", "operational", "Database queries completed.", now, databaseLatencyMs),
    component(
      "bright_data",
      "Bright Data collector",
      collectorFallback,
      latestRun ? `Latest check: ${latestRun.status}.` : "No collection has completed yet.",
      latestRun?.finishedAt ?? now,
    ),
    component(
      "validator",
      "Data validator",
      latestRun?.status === "accepted" ? "operational" : latestRun ? "degraded" : "unknown",
      latestRun ? "Latest source contract decision is shown in History." : "No validation has completed yet.",
      latestRun?.finishedAt ?? now,
    ),
    component("worker", "Collection worker", workerStatus, heartbeat ? "Heartbeat received from the worker." : "No worker heartbeat has been recorded.", heartbeat?.lastSeenAt ?? now),
    component("fireworks", "Fireworks advisory", "unknown", "Advisory review runs only after deterministic checks pass."),
  ];

  return {
    now,
    latestRun: latestRun ?? null,
    latestTrusted: latestTrusted ?? null,
    trust: {
      state: trustState as "current" | "held_stale" | "unavailable",
      ageSeconds: trustAgeSeconds,
      newerUpdateHeld,
      sourceValidAt: latestTrusted?.sourceValidAt ?? null,
      acceptedAt: latestTrusted?.acceptedAt ?? null,
    },
    queue: {
      depth: activeJobs.length,
      activeJobTypes,
      oldestScheduledFor: activeJobs[0]?.scheduledFor ?? null,
      collectionActive: activeJobs.some((job) => job.type === "collect_sfmta_elevators") ||
        latestRun?.status === "collecting" || latestRun?.status === "validating",
    },
    incidents: { active: Number(activeIncidentCount?.total ?? 0) },
    worker: {
      status: workerStatus,
      workerId: heartbeat?.workerId ?? null,
      processVersion: heartbeat?.processVersion ?? null,
      lastSeenAt: heartbeat?.lastSeenAt ?? null,
      ageSeconds: workerAgeSeconds,
    },
    components,
    metrics: {
      recentCompleted: completedRuns.length,
      recentAccepted: acceptedRuns.length,
      recentAcceptanceRate: completedRuns.length
        ? Math.round((acceptedRuns.length / completedRuns.length) * 100)
        : null,
      averageDurationMs: durations.length
        ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length)
        : null,
      lastAcceptedAt: recentRuns.find((run) => run.status === "accepted")?.finishedAt ?? null,
      lastRejectedAt: recentRuns.find((run) => run.status === "rejected")?.finishedAt ?? null,
      lastFailedAt: recentRuns.find((run) => run.status === "failed")?.finishedAt ?? null,
    },
    databaseLatencyMs,
  };
}

export async function getRunEvidence(runId: string) {
  const [[run], [raw], [counts], observationsForRun, equipmentEvents, stationEvents] = await Promise.all([
    db.select().from(collectionRuns).where(eq(collectionRuns.id, runId)).limit(1),
    db
      .select({
        payloadHash: rawPayloads.payloadHash,
        byteLength: rawPayloads.byteLength,
        expiresAt: rawPayloads.expiresAt,
        retained: sql<boolean>`${rawPayloads.body} is not null`,
      })
      .from(rawPayloads)
      .where(eq(rawPayloads.collectionRunId, runId))
      .limit(1),
    db.select({ count: count() }).from(observations).where(eq(observations.collectionRunId, runId)),
    db
      .select({
        equipmentId: equipment.id,
        stationName: stations.displayName,
        stationStatus: observations.reportedStationAccessibility,
        elevatorName: equipment.displayName,
        equipmentStatus: observations.equipmentStatus,
        sourceValidAt: observations.sourceValidAt,
        sourceLastChangedAt: observations.sourceLastChangedAt,
        observedAt: observations.observedAt,
      })
      .from(observations)
      .innerJoin(equipment, eq(observations.equipmentId, equipment.id))
      .innerJoin(stations, eq(observations.stationId, stations.id))
      .where(eq(observations.collectionRunId, runId))
      .orderBy(asc(stations.corridorOrder), asc(equipment.displayName)),
    db.select().from(equipmentStatusEvents).where(eq(equipmentStatusEvents.collectionRunId, runId)),
    db.select().from(stationStatusEvents).where(eq(stationStatusEvents.collectionRunId, runId)),
  ]);
  return {
    run: run ?? null,
    raw: raw ?? null,
    observationCount: Number(counts?.count ?? 0),
    observations: observationsForRun,
    equipmentEvents,
    stationEvents,
  };
}

export async function getEquipmentEvidence(equipmentId: string) {
  const [[item], history, events] = await Promise.all([
    db
      .select({
        equipmentId: equipment.id,
        sourceKey: equipment.sourceKey,
        name: equipment.displayName,
        stationId: stations.id,
        stationName: stations.displayName,
        stationSlug: stations.slug,
      })
      .from(equipment)
      .innerJoin(stations, eq(equipment.stationId, stations.id))
      .where(eq(equipment.id, equipmentId))
      .limit(1),
    db
      .select({
        runId: observations.collectionRunId,
        status: observations.equipmentStatus,
        stationStatus: observations.reportedStationAccessibility,
        sourceValidAt: observations.sourceValidAt,
        sourceLastChangedAt: observations.sourceLastChangedAt,
        observedAt: observations.observedAt,
      })
      .from(observations)
      .where(eq(observations.equipmentId, equipmentId))
      .orderBy(desc(observations.observedAt))
      .limit(100),
    db
      .select()
      .from(equipmentStatusEvents)
      .where(eq(equipmentStatusEvents.equipmentId, equipmentId))
      .orderBy(desc(equipmentStatusEvents.observedAt))
      .limit(100),
  ]);
  return { item: item ?? null, history, events };
}

function runExportRow(run: (Awaited<ReturnType<typeof queryRuns>>["rows"])[number]) {
  return {
    id: run.id,
    createdAt: run.createdAt.toISOString(),
    trigger: run.trigger,
    status: run.status,
    classification: run.classification,
    sourceValidAt: run.sourceValidAt?.toISOString() ?? null,
    collectedAt: run.collectedAt?.toISOString() ?? null,
    acceptedAt: run.acceptedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    duration: formatDuration(run.startedAt, run.finishedAt),
    rowCount: run.rowCount,
    stationCount: run.stationCount,
    errorCode: run.errorCode,
  };
}

export async function exportRuns(filters: RunFilters) {
  const result = await queryRuns({ ...filters, cursor: "", pageSize: EXPORT_LIMIT });
  return { rows: result.rows.map(runExportRow), total: result.total, truncated: result.hasNext };
}

function incidentExportRow(incident: (Awaited<ReturnType<typeof queryIncidents>>["rows"])[number]) {
  return {
    id: incident.id,
    detectedAt: incident.detectedAt.toISOString(),
    acknowledgedAt: incident.acknowledgedAt?.toISOString() ?? null,
    resolvedAt: incident.resolvedAt?.toISOString() ?? null,
    state: incident.state,
    classification: incident.classification,
    title: incident.title,
    summary: incident.summary,
    collectionRunId: incident.collectionRunId,
  };
}

export async function exportIncidents(filters: IncidentFilters) {
  const result = await queryIncidents({ ...filters, cursor: "", pageSize: EXPORT_LIMIT });
  return {
    rows: result.rows.map(incidentExportRow),
    total: result.total,
    truncated: result.hasNext,
  };
}

export async function exportEquipment(filters: EquipmentFilters) {
  const result = await queryEquipment({ ...filters, cursor: "", pageSize: EXPORT_LIMIT });
  return {
    rows: result.rows.map((row) => ({
      station: row.stationName,
      elevator: row.elevatorName,
      equipmentStatus: row.equipmentStatus,
      stationAccessibility: row.reportedStationAccessibility,
      sourceValidAt: row.sourceValidAt.toISOString(),
      sourceLastChangedAt: row.sourceLastChangedAt?.toISOString() ?? null,
      observedAt: row.observedAt.toISOString(),
    })),
    total: result.total,
    truncated: result.hasNext,
  };
}

export async function exportAudit(filters: AuditFilters) {
  const result = await queryAudit({ ...filters, cursor: "", pageSize: EXPORT_LIMIT });
  return {
    rows: result.rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt.toISOString(),
      actor: row.actorName ?? row.actorUserId,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      outcome: row.outcome,
      requestHash: row.requestHash,
      metadata: sanitizedMetadata(row.metadata),
    })),
    total: result.total,
    truncated: result.hasNext,
  };
}

const CSV_FORMULA_PREFIX = /^[=+@]/;

function csvSafeText(value: unknown) {
  const raw = value === null || value === undefined ? "" : String(value);
  const normalized = raw
    .replaceAll(String.fromCharCode(13), " ")
    .replaceAll(String.fromCharCode(10), " ");
  const trimmed = normalized.trimStart();
  const startsWithControl =
    raw.startsWith(String.fromCharCode(9)) ||
    raw.startsWith(String.fromCharCode(10)) ||
    raw.startsWith(String.fromCharCode(13));
  const isNegativeNumber =
    trimmed.startsWith("-") && Number.isFinite(Number(trimmed));
  const startsWithFormula =
    CSV_FORMULA_PREFIX.test(trimmed) ||
    (trimmed.startsWith("-") && !isNegativeNumber);
  return (startsWithControl || startsWithFormula ? "'" : "") + normalized;
}

export function csvValue(value: unknown) {
  const text = csvSafeText(value);
  return '"' + text.replaceAll('"', '""') + '"';
}

export function toCsv(rows: ReadonlyArray<Record<string, unknown>>) {
  const first = rows[0];
  if (!first) return "";
  const columns = Object.keys(first);
  return [
    columns.map(csvValue).join(","),
    ...rows.map((row) => columns.map((column) => csvValue(row[column])).join(",")),
  ].join("\n");
}

export { EXPORT_LIMIT };
