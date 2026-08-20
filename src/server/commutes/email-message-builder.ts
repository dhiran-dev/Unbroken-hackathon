import { sql as drizzleSql } from "drizzle-orm";

import { sha256Json } from "@/domain/collection/identity";
import { formatDepartureTime } from "@/domain/commute/account-page";
import {
  COMMUTE_DAYS,
  isCommuteSlot,
  type CommuteDay,
  type CommuteSlot,
} from "@/domain/commute/schedule";
import type { SavedCommute } from "@/domain/commute/service";
import {
  normalizeJourneyPlan,
  type SafeJourneyPlan,
} from "@/domain/journey/citywide-journey-form";
import type { JourneyPlan, JourneyPlanner } from "@/domain/journey/journey";
import {
  compareJourneyChanges,
  type JourneyPlanSafeSnapshot,
} from "@/domain/notifications/journey-changes";
import type { NotificationMessageBuilder } from "@/domain/notifications/outbox";
import type { PlaceChoice, TransitCatalog } from "@/domain/transit/catalog";
import {
  buildCommuteEmail,
  type CommuteEmail,
  type CommuteEmailInput,
} from "@/emails/commute-email";
import { formatPacific } from "@/lib/format";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
const PLACE_ID_PATTERN =
  /^(?:stop|station|landmark):[^\s<>\u0000-\u001f\u007f]{1,160}$/u;
const PACIFIC_TIME_ZONE = "America/Los_Angeles";
const INTERNAL_WORDS =
  /\b(?:fingerprint|reason|provider|outbox|queue|worker|collector|gtfs|otp|graphql|schema|protobuf|job|token|secret|operational)\b/iu;

export type CommuteEmailOutboxContext = {
  outboxId: string;
  scheduleId: string;
  serviceDate: string;
  departureAt: Date;
  outboxStatus: "sending";
  schedule: SavedCommute;
  previousSnapshot: JourneyPlanSafeSnapshot | null;
};

export type PersistedCommuteJourneySnapshot = {
  outboxId: string;
  scheduleId: string;
  serviceDate: string;
  plan: SafeJourneyPlan;
  planHash: string;
  expectedScheduleUpdatedAt: string;
  expectedDepartureAt: string;
  capturedAt: Date;
};

export type CommuteEmailMessageContextStore = {
  read(outboxId: string): Promise<CommuteEmailOutboxContext | null>;
  persistCurrentSnapshot(input: PersistedCommuteJourneySnapshot): Promise<void>;
};

export type CommuteEmailMessageBuilderDependencies = {
  context: CommuteEmailMessageContextStore;
  catalog: Pick<TransitCatalog, "getPlace">;
  planner: Pick<JourneyPlanner, "plan">;
  renderEmail?: (input: CommuteEmailInput) => CommuteEmail;
  clock?: () => Date;
  appOrigin: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function validDateText(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const date = new Date(value + "T00:00:00.000Z");
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

const pacificFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: PACIFIC_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  weekday: "long",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function pacificParts(value: Date) {
  const parts = Object.fromEntries(
    pacificFormatter
      .formatToParts(value)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    date: parts.year + "-" + parts.month + "-" + parts.day,
    weekday: parts.weekday?.toLowerCase() as CommuteDay,
    time: parts.hour + ":" + parts.minute,
  };
}

function validSchedule(value: unknown): value is SavedCommute {
  if (!isRecord(value)) return false;
  const days = value.days;
  return (
    validUuid(value.id) &&
    isCommuteSlot(value.slot) &&
    typeof value.originPlaceId === "string" &&
    PLACE_ID_PATTERN.test(value.originPlaceId) &&
    typeof value.destinationPlaceId === "string" &&
    PLACE_ID_PATTERN.test(value.destinationPlaceId) &&
    value.originPlaceId !== value.destinationPlaceId &&
    Array.isArray(days) &&
    days.length > 0 &&
    new Set(days).size === days.length &&
    days.every((day) => COMMUTE_DAYS.includes(day as CommuteDay)) &&
    typeof value.departureTime === "string" &&
    TIME_PATTERN.test(value.departureTime) &&
    value.timezone === PACIFIC_TIME_ZONE &&
    Number.isSafeInteger(value.reminderMinutes) &&
    [15, 30, 45, 60].includes(value.reminderMinutes as number) &&
    typeof value.paused === "boolean" &&
    typeof value.createdAt === "string" &&
    Number.isFinite(new Date(value.createdAt).getTime()) &&
    typeof value.updatedAt === "string" &&
    Number.isFinite(new Date(value.updatedAt).getTime())
  );
}

function normalizePreviousSnapshot(
  value: unknown,
): JourneyPlanSafeSnapshot | null {
  if (!isRecord(value) || !("plan" in value)) return null;
  const plan = normalizeJourneyPlan(value.plan);
  if (!plan) return null;
  return {
    plan,
    fingerprint: null,
  };
}

function validContext(value: unknown): value is CommuteEmailOutboxContext {
  if (!isRecord(value)) return false;
  const previousSnapshot = value.previousSnapshot;
  const validPrevious =
    previousSnapshot === null ||
    previousSnapshot === undefined ||
    normalizePreviousSnapshot(previousSnapshot) !== null;
  return (
    validPrevious &&
    validUuid(value.outboxId) &&
    validUuid(value.scheduleId) &&
    validDateText(value.serviceDate) &&
    value.departureAt instanceof Date &&
    Number.isFinite(value.departureAt.getTime()) &&
    value.outboxStatus === "sending" &&
    validSchedule(value.schedule) &&
    !value.schedule.paused &&
    value.schedule.id === value.scheduleId &&
    departureMatchesSchedule(
      value.schedule,
      value.serviceDate,
      value.departureAt,
    )
  );
}

function departureMatchesSchedule(
  schedule: SavedCommute,
  serviceDate: string,
  departureAt: Date,
) {
  const parts = pacificParts(departureAt);
  return (
    parts.date === serviceDate &&
    schedule.days.includes(parts.weekday) &&
    parts.time === schedule.departureTime
  );
}

function place(value: unknown, expectedId: string): value is PlaceChoice {
  return (
    isRecord(value) &&
    value.id === expectedId &&
    (value.type === "stop" ||
      value.type === "station" ||
      value.type === "landmark") &&
    typeof value.name === "string" &&
    value.name.trim().length > 0
  );
}

function planHash(plan: SafeJourneyPlan) {
  return sha256Json(plan);
}

function validMessage(value: unknown): value is CommuteEmail {
  if (!isRecord(value)) return false;
  return (
    typeof value.subject === "string" &&
    value.subject.length > 0 &&
    value.subject.length <= 160 &&
    value.subject === value.subject.trim() &&
    !/[<>\u0000-\u001f\u007f]/u.test(value.subject) &&
    typeof value.html === "string" &&
    value.html.length > 0 &&
    value.html.length <= 200_000 &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value.html) &&
    typeof value.text === "string" &&
    value.text.length > 0 &&
    value.text.length <= 50_000 &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value.text) &&
    !INTERNAL_WORDS.test(value.subject) &&
    !INTERNAL_WORDS.test(value.html) &&
    !INTERNAL_WORDS.test(value.text)
  );
}

function approvedAppOrigin(value: string) {
  try {
    const origin = new URL(value);
    if (
      origin.protocol !== "https:" ||
      !origin.hostname ||
      origin.pathname !== "/" ||
      origin.username ||
      origin.password ||
      origin.search ||
      origin.hash
    ) {
      return null;
    }
    return origin.origin;
  } catch {
    return null;
  }
}

function manageUrl(appOrigin: string) {
  return new URL("/rider/trips", appOrigin).toString();
}

export function createCommuteEmailMessageBuilder(
  dependencies: CommuteEmailMessageBuilderDependencies,
): NotificationMessageBuilder {
  const render = dependencies.renderEmail ?? buildCommuteEmail;
  const clock = dependencies.clock ?? (() => new Date());

  return async function buildMessage(outboxId) {
    if (!validUuid(outboxId)) throw new Error("COMMUTE_MESSAGE_OUTBOX_INVALID");
    const appOrigin = approvedAppOrigin(dependencies.appOrigin);
    if (!appOrigin) throw new Error("COMMUTE_MESSAGE_ORIGIN_INVALID");

    let capturedAt: Date;
    try {
      capturedAt = clock();
    } catch {
      throw new Error("COMMUTE_MESSAGE_CLOCK_INVALID");
    }
    if (
      !(capturedAt instanceof Date) ||
      !Number.isFinite(capturedAt.getTime())
    ) {
      throw new Error("COMMUTE_MESSAGE_CLOCK_INVALID");
    }

    const context = await dependencies.context.read(outboxId);
    if (
      !validContext(context) ||
      context.outboxId !== outboxId ||
      context.departureAt.getTime() <= capturedAt.getTime()
    ) {
      throw new Error("COMMUTE_MESSAGE_CONTEXT_INVALID");
    }

    const [origin, destination] = await Promise.all([
      dependencies.catalog.getPlace({
        placeId: context.schedule.originPlaceId,
      }),
      dependencies.catalog.getPlace({
        placeId: context.schedule.destinationPlaceId,
      }),
    ]);
    if (
      !place(origin, context.schedule.originPlaceId) ||
      !place(destination, context.schedule.destinationPlaceId)
    ) {
      throw new Error("COMMUTE_MESSAGE_PLACE_INVALID");
    }

    const departureAt = context.departureAt.toISOString();
    const planned: JourneyPlan = await dependencies.planner.plan({
      origin: { type: "catalog", placeId: origin.id },
      destination: { type: "catalog", placeId: destination.id },
      departureAt,
    });
    const plan = normalizeJourneyPlan(planned);
    if (!plan || plan.departureAt !== departureAt) {
      throw new Error("COMMUTE_MESSAGE_PLAN_INVALID");
    }

    const currentSnapshot: JourneyPlanSafeSnapshot = {
      plan,
      fingerprint: null,
    };
    const previousSnapshot = normalizePreviousSnapshot(
      context.previousSnapshot,
    );
    const input: CommuteEmailInput = {
      schedule: {
        originLabel: origin.name,
        destinationLabel: destination.name,
        departureLabel: formatDepartureTime(context.schedule.departureTime),
        arrivalLabel: formatPacific(new Date(plan.arrivalAt)),
      },
      plan,
      changes: compareJourneyChanges({
        current: currentSnapshot,
        previous: previousSnapshot,
      }),
      manageUrl: manageUrl(appOrigin),
      appOrigin,
    };
    const message = render(input);
    if (!validMessage(message)) throw new Error("COMMUTE_EMAIL_INVALID");
    await dependencies.context.persistCurrentSnapshot({
      outboxId: context.outboxId,
      scheduleId: context.scheduleId,
      serviceDate: context.serviceDate,
      plan,
      planHash: planHash(plan),
      expectedScheduleUpdatedAt: context.schedule.updatedAt,
      expectedDepartureAt: context.departureAt.toISOString(),
      capturedAt,
    });
    return message;
  };
}

type Database = typeof import("@/server/db/client").db;

function asDate(value: unknown): Date | null {
  const date =
    value instanceof Date
      ? new Date(value.getTime())
      : typeof value === "string"
        ? new Date(value)
        : null;
  return date && Number.isFinite(date.getTime()) ? date : null;
}

function contextFromRow(value: unknown): CommuteEmailOutboxContext | null {
  if (!isRecord(value)) return null;
  const departureAt = asDate(value.departureAt);
  const createdAt = asDate(value.createdAt);
  const updatedAt = asDate(value.updatedAt);
  if (!departureAt || !createdAt || !updatedAt) return null;
  const schedule: SavedCommute = {
    id: String(value.scheduleId ?? ""),
    slot: value.slot as CommuteSlot,
    originPlaceId: String(value.originPlaceId ?? ""),
    destinationPlaceId: String(value.destinationPlaceId ?? ""),
    days: Array.isArray(value.days) ? (value.days as CommuteDay[]) : [],
    departureTime: String(value.departureTime ?? ""),
    timezone: value.timezone as "America/Los_Angeles",
    reminderMinutes: Number(value.reminderMinutes) as 15 | 30 | 45 | 60,
    paused: value.paused === true,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  };
  const previousPlan =
    value.previousPlan === null || value.previousPlan === undefined
      ? null
      : normalizeJourneyPlan(value.previousPlan);
  if (
    value.previousPlan !== null &&
    value.previousPlan !== undefined &&
    !previousPlan
  ) {
    return null;
  }
  const context: CommuteEmailOutboxContext = {
    outboxId: String(value.outboxId ?? ""),
    scheduleId: String(value.scheduleId ?? ""),
    serviceDate: String(value.serviceDate ?? ""),
    departureAt,
    outboxStatus: value.outboxStatus as "sending",
    schedule,
    previousSnapshot: previousPlan
      ? { plan: previousPlan, fingerprint: null }
      : null,
  };
  return validContext(context) ? context : null;
}

/**
 * Owner-free production context adapter. It selects only the outbox, saved
 * schedule, and linked journey snapshot needed to render; recipient fields
 * and provider delivery rows never cross this seam.
 */
export class PostgresCommuteEmailMessageContextStore implements CommuteEmailMessageContextStore {
  constructor(private readonly database?: Database) {}

  private async getDatabase(): Promise<Database> {
    if (this.database) return this.database;
    const { db } = await import("@/server/db/client");
    return db;
  }

  async read(outboxId: string): Promise<CommuteEmailOutboxContext | null> {
    if (!validUuid(outboxId)) return null;
    const database = await this.getDatabase();
    const rows = await database.execute(
      drizzleSql`
        select
          outbox.id::text as "outboxId",
          outbox.schedule_id::text as "scheduleId",
          outbox.service_date::text as "serviceDate",
          outbox.departure_at as "departureAt",
          outbox.status as "outboxStatus",
          schedule.slot as slot,
          schedule.origin_place_id as "originPlaceId",
          schedule.destination_place_id as "destinationPlaceId",
          schedule.days as days,
          schedule.departure_time as "departureTime",
          schedule.timezone as timezone,
          schedule.lead_minutes as "reminderMinutes",
          schedule.paused as paused,
          schedule.created_at as "createdAt",
          schedule.updated_at as "updatedAt",
          previous.plan as "previousPlan"
        from notification_outbox as outbox
        inner join commute_schedules as schedule
          on schedule.id = outbox.schedule_id
        left join lateral (
          select snapshot.plan as plan
          from notification_outbox as previous_outbox
          inner join journey_plan_snapshots as snapshot
            on snapshot.id = previous_outbox.journey_snapshot_id
           and snapshot.schedule_id = previous_outbox.schedule_id
           and snapshot.service_date = previous_outbox.service_date
          where previous_outbox.schedule_id = outbox.schedule_id
            and previous_outbox.service_date < outbox.service_date
            and previous_outbox.status = 'sent'
          order by previous_outbox.service_date desc, snapshot.captured_at desc, snapshot.id asc
          limit 1
        ) as previous on true
        where outbox.id = ${outboxId}
          and outbox.status = 'sending'
          and outbox.departure_at > clock_timestamp()
          and schedule.paused = false
        limit 1
      `,
    );
    return contextFromRow(rows[0]);
  }

  async persistCurrentSnapshot(
    input: PersistedCommuteJourneySnapshot,
  ): Promise<void> {
    const normalizedPlan = normalizeJourneyPlan(input.plan);
    const expectedScheduleUpdatedAt =
      typeof input.expectedScheduleUpdatedAt === "string"
        ? asDate(input.expectedScheduleUpdatedAt)
        : null;
    const expectedDepartureAt =
      typeof input.expectedDepartureAt === "string"
        ? asDate(input.expectedDepartureAt)
        : null;
    if (
      !validUuid(input.outboxId) ||
      !validUuid(input.scheduleId) ||
      !validDateText(input.serviceDate) ||
      !HASH_PATTERN.test(input.planHash) ||
      !normalizedPlan ||
      planHash(normalizedPlan) !== input.planHash ||
      !expectedScheduleUpdatedAt ||
      !expectedDepartureAt ||
      !(input.capturedAt instanceof Date) ||
      !Number.isFinite(input.capturedAt.getTime())
    ) {
      throw new Error("COMMUTE_MESSAGE_SNAPSHOT_INVALID");
    }
    const database = await this.getDatabase();
    await database.transaction(async (transaction) => {
      const currentRows = await transaction.execute(
        drizzleSql`
          select
            outbox.schedule_id::text as "scheduleId",
            outbox.service_date::text as "serviceDate",
            outbox.departure_at as "departureAt",
            outbox.status as "outboxStatus",
            schedule.updated_at as "scheduleUpdatedAt",
            schedule.paused as paused
          from notification_outbox as outbox
          inner join commute_schedules as schedule
            on schedule.id = outbox.schedule_id
          where outbox.id = ${input.outboxId}
            and outbox.status = 'sending'
            and outbox.departure_at > clock_timestamp()
            and schedule.paused = false
          for update of outbox, schedule
        `,
      );
      const current = isRecord(currentRows[0]) ? currentRows[0] : null;
      const currentDeparture = asDate(current?.departureAt);
      const currentRevision = asDate(current?.scheduleUpdatedAt);
      if (
        !current ||
        current.outboxStatus !== "sending" ||
        current.scheduleId !== input.scheduleId ||
        current.serviceDate !== input.serviceDate ||
        current.paused !== false ||
        !currentDeparture ||
        !currentRevision ||
        currentDeparture.getTime() !== expectedDepartureAt.getTime() ||
        currentRevision.getTime() !== expectedScheduleUpdatedAt.getTime()
      ) {
        throw new Error("COMMUTE_MESSAGE_CONTEXT_STALE");
      }
      const rows = await transaction.execute(
        drizzleSql`
          insert into journey_plan_snapshots (
            schedule_id,
            service_date,
            status,
            fingerprint,
            plan,
            captured_at
          ) values (
            ${input.scheduleId},
            ${input.serviceDate},
            ${normalizedPlan.status},
            ${input.planHash},
            ${JSON.stringify(normalizedPlan)}::jsonb,
            ${input.capturedAt}
          )
          on conflict (schedule_id, service_date)
          do update set
            status = excluded.status,
            fingerprint = excluded.fingerprint,
            plan = excluded.plan,
            captured_at = excluded.captured_at
          returning id::text as id
        `,
      );
      const snapshotId = isRecord(rows[0]) ? rows[0].id : null;
      if (!validUuid(snapshotId)) {
        throw new Error("COMMUTE_MESSAGE_SNAPSHOT_UNAVAILABLE");
      }
      const bound = await transaction.execute(
        drizzleSql`
          update notification_outbox
          set journey_snapshot_id = ${snapshotId},
              updated_at = clock_timestamp()
          where id = ${input.outboxId}
            and schedule_id = ${input.scheduleId}
            and service_date = ${input.serviceDate}
            and status = 'sending'
            and departure_at > clock_timestamp()
            and departure_at = ${expectedDepartureAt}
            and exists (
              select 1
              from commute_schedules as current_schedule
              where current_schedule.id = notification_outbox.schedule_id
                and current_schedule.paused = false
                and current_schedule.updated_at = ${currentRevision}
            )
          returning id
        `,
      );
      if (bound.length !== 1) {
        throw new Error("COMMUTE_MESSAGE_OUTBOX_UNAVAILABLE");
      }
    });
  }
}
