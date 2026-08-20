import { sql as drizzleSql } from "drizzle-orm";

import type {
  DueSchedule,
  SavedCommuteSchedule,
  Weekday,
} from "@/domain/notifications/due-schedules";
import { findDueSchedules } from "@/domain/notifications/due-schedules";
import {
  SEND_LEASE_MS,
  type NotificationClaimResult,
  type NotificationDeliveryStore,
  type NotificationFailureDecision,
  type NotificationSendClaim,
  type NotificationSendReadiness,
  type NotificationScheduleSource,
} from "@/domain/notifications/outbox";
import { db as applicationDatabase } from "@/server/db/client";

type Database = typeof applicationDatabase;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type SqlRow = Record<string, unknown>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const ERROR_CODES = new Set([
  "timeout",
  "rate_limited",
  "quota_exhausted",
  "provider_error",
  "message_error",
  "recipient_unavailable",
]);
const OUTBOX_STATUSES = new Set([
  "pending",
  "sending",
  "sent",
  "failed",
  "suppressed",
]);
const PROVIDER_ID_PATTERN = /^[A-Za-z0-9_-]{1,160}$/u;
const APPROVED_LEADS = new Set([15, 30, 45, 60]);
const DAY_NAMES = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;

function object(value: unknown): SqlRow | null {
  return value && typeof value === "object" ? (value as SqlRow) : null;
}

function safeDate(value: unknown): Date | null {
  const date =
    value instanceof Date ? new Date(value) : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date : null;
}

function safeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : null;
}

function validUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function validServiceDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const date = new Date(value + "T00:00:00.000Z");
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

function validDue(input: unknown): input is DueSchedule {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return false;
  }
  const candidate = input as DueSchedule;
  return (
    validUuid(candidate.scheduleId) &&
    validServiceDate(candidate.serviceDate) &&
    candidate.idempotencyKey ===
      "commute/" + candidate.scheduleId + "/" + candidate.serviceDate &&
    candidate.dueAt instanceof Date &&
    Number.isFinite(candidate.dueAt.getTime()) &&
    candidate.departureAt instanceof Date &&
    Number.isFinite(candidate.departureAt.getTime()) &&
    APPROVED_LEADS.has(candidate.leadMinutes) &&
    candidate.dueAt.getTime() + candidate.leadMinutes * 60_000 ===
      candidate.departureAt.getTime()
  );
}

function periodStarts(serviceDate: string) {
  if (!validServiceDate(serviceDate)) return null;
  return {
    day: serviceDate,
    month: serviceDate.slice(0, 7) + "-01",
  };
}

async function databaseNow(transaction: Transaction): Promise<Date> {
  const rows = await transaction.execute(
    drizzleSql`select clock_timestamp() as now`,
  );
  const now = safeDate(object(rows[0])?.now);
  if (!now) throw new Error("notification database clock unavailable");
  return now;
}

type OutboxRow = {
  id: string;
  scheduleId: string;
  serviceDate: string;
  departureAt: Date;
  idempotencyKey: string;
  status: string;
  attemptCount: number;
  nextAttemptAt: Date | null;
  updatedAt: Date;
};

function outboxRow(value: unknown): OutboxRow | null {
  const source = object(value);
  if (!source) return null;
  const attemptCount = safeInteger(source.attemptCount);
  const departureAt = safeDate(source.departureAt);
  const updatedAt = safeDate(source.updatedAt);
  const nextAttemptAt =
    source.nextAttemptAt === null || source.nextAttemptAt === undefined
      ? null
      : safeDate(source.nextAttemptAt);
  const status = typeof source.status === "string" ? source.status : null;
  if (
    !validUuid(source.id) ||
    !validUuid(source.scheduleId) ||
    !validServiceDate(source.serviceDate) ||
    typeof source.idempotencyKey !== "string" ||
    source.idempotencyKey !==
      "commute/" + source.scheduleId + "/" + source.serviceDate ||
    !status ||
    !OUTBOX_STATUSES.has(status) ||
    !departureAt ||
    attemptCount === null ||
    attemptCount < 0 ||
    !updatedAt ||
    (source.nextAttemptAt !== null &&
      source.nextAttemptAt !== undefined &&
      !nextAttemptAt) ||
    (status === "pending" && attemptCount !== 0) ||
    (status === "sending" && attemptCount < 1) ||
    (status !== "failed" && nextAttemptAt !== null)
  ) {
    return null;
  }
  return {
    id: source.id,
    scheduleId: source.scheduleId,
    serviceDate: source.serviceDate,
    departureAt,
    idempotencyKey: source.idempotencyKey,
    status,
    attemptCount,
    nextAttemptAt,
    updatedAt,
  };
}

async function lockedOutbox(
  transaction: Transaction,
  outboxId: string,
): Promise<OutboxRow | null> {
  const rows = await transaction.execute(
    drizzleSql`
      select
        id::text as id,
        schedule_id::text as "scheduleId",
        service_date::text as "serviceDate",
        departure_at as "departureAt",
        idempotency_key as "idempotencyKey",
        status,
        attempt_count as "attemptCount",
        next_attempt_at as "nextAttemptAt",
        updated_at as "updatedAt"
      from notification_outbox
      where id = ${outboxId}
      for update
    `,
  );
  return outboxRow(rows[0]);
}

async function lockBudget(
  transaction: Transaction,
  period: "day" | "month",
  periodStart: string,
) {
  await transaction.execute(
    drizzleSql`
      insert into email_budget_ledger (period, period_start)
      values (${period}, ${periodStart})
      on conflict (period, period_start) do nothing
    `,
  );
  const rows = await transaction.execute(
    drizzleSql`
      select
        reserved_count as "reservedCount",
        sent_count as "sentCount"
      from email_budget_ledger
      where period = ${period} and period_start = ${periodStart}
      for update
    `,
  );
  const row = object(rows[0]);
  const reservedCount = safeInteger(row?.reservedCount);
  const sentCount = safeInteger(row?.sentCount);
  if (
    reservedCount === null ||
    sentCount === null ||
    reservedCount < 0 ||
    sentCount < 0
  ) {
    throw new Error("notification budget ledger unavailable");
  }
  return { reservedCount, sentCount };
}

async function reservedOtherCount(
  transaction: Transaction,
  period: "day" | "month",
  periodStart: string,
  outboxId: string,
) {
  const rows = await transaction.execute(
    period === "day"
      ? drizzleSql`
          select count(*)::int as count
          from notification_outbox
          where service_date = ${periodStart}
            and id <> ${outboxId}
            and attempt_count > 0
            and (
              status = ${"sending"} or
              (status = ${"failed"} and next_attempt_at is not null)
            )
        `
      : drizzleSql`
          select count(*)::int as count
          from notification_outbox
          where service_date >= ${periodStart}::date
            and service_date < (${periodStart}::date + ${"1 month"}::interval)
            and id <> ${outboxId}
            and attempt_count > 0
            and (
              status = ${"sending"} or
              (status = ${"failed"} and next_attempt_at is not null)
            )
        `,
  );
  const count = safeInteger(object(rows[0])?.count);
  if (count === null || count < 0) {
    throw new Error("notification reservation ownership unavailable");
  }
  return count;
}

async function settleBudgetReservation(
  transaction: Transaction,
  serviceDate: string,
  outboxId: string,
  outcome: "release" | "sent",
) {
  const periods = periodStarts(serviceDate);
  if (!periods) throw new Error("notification service date invalid");
  const day = await lockBudget(transaction, "day", periods.day);
  const month = await lockBudget(transaction, "month", periods.month);
  const dayOtherCount = await reservedOtherCount(
    transaction,
    "day",
    periods.day,
    outboxId,
  );
  const monthOtherCount = await reservedOtherCount(
    transaction,
    "month",
    periods.month,
    outboxId,
  );
  if (
    day.reservedCount <= dayOtherCount ||
    month.reservedCount <= monthOtherCount
  ) {
    throw new Error("notification reservation ownership unavailable");
  }
  const sentDelta = outcome === "sent" ? 1 : 0;
  const dayUpdated = await transaction.execute(
    drizzleSql`
      update email_budget_ledger
      set reserved_count = reserved_count - 1,
          sent_count = sent_count + ${sentDelta},
          updated_at = clock_timestamp()
      where period = 'day' and period_start = ${periods.day}
        and reserved_count > 0
      returning id
    `,
  );
  const monthUpdated = await transaction.execute(
    drizzleSql`
      update email_budget_ledger
      set reserved_count = reserved_count - 1,
          sent_count = sent_count + ${sentDelta},
          updated_at = clock_timestamp()
      where period = 'month' and period_start = ${periods.month}
        and reserved_count > 0
      returning id
    `,
  );
  if (dayUpdated.length !== 1 || monthUpdated.length !== 1) {
    throw new Error("notification reservation settlement failed");
  }
}

async function circuitIsPaused(transaction: Transaction) {
  const rows = await transaction.execute(
    drizzleSql`
      select email_circuit_state as state
      from signup_capacity
      where id = 1
      for share
    `,
  );
  const state = object(rows[0])?.state;
  return state !== "closed";
}

async function pauseEmailCircuit(transaction: Transaction) {
  const rows = await transaction.execute(
    drizzleSql`
      update signup_capacity
      set email_circuit_state = ${"paused"}, updated_at = clock_timestamp()
      where id = 1
      returning id
    `,
  );
  if (rows.length !== 1) {
    throw new Error("notification email circuit unavailable");
  }
}

function validErrorCode(value: unknown): value is string {
  return typeof value === "string" && ERROR_CODES.has(value);
}
function validProviderMessageId(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === "string" && PROVIDER_ID_PATTERN.test(value))
  );
}

function validFailureDecision(
  value: unknown,
): value is NotificationFailureDecision {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const decision = value as Record<string, unknown>;
  const status = decision.status;
  const nextAttemptAt = decision.nextAttemptAt;
  const validNext =
    nextAttemptAt === null ||
    (nextAttemptAt instanceof Date && Number.isFinite(nextAttemptAt.getTime()));
  return (
    (status === "retry_scheduled" ||
      status === "failed" ||
      status === "suppressed") &&
    validErrorCode(decision.errorCode) &&
    typeof decision.pauseCircuit === "boolean" &&
    validNext &&
    (status === "retry_scheduled"
      ? nextAttemptAt instanceof Date
      : nextAttemptAt === null)
  );
}

function claimMatchesRow(claim: NotificationSendClaim, row: OutboxRow) {
  return (
    claim.outboxId === row.id &&
    claim.scheduleId === row.scheduleId &&
    claim.serviceDate === row.serviceDate &&
    claim.idempotencyKey === row.idempotencyKey &&
    claim.departureAt instanceof Date &&
    claim.departureAt.getTime() === row.departureAt.getTime() &&
    claim.attemptNumber === row.attemptCount
  );
}

function validClaimInput(input: {
  outboxId: string;
  now: Date;
  dailyBudget: number;
  monthlyBudget: number;
  maxAttempts: number;
  leaseMs: number;
}) {
  return (
    validUuid(input.outboxId) &&
    input.now instanceof Date &&
    Number.isFinite(input.now.getTime()) &&
    Number.isSafeInteger(input.dailyBudget) &&
    input.dailyBudget > 0 &&
    Number.isSafeInteger(input.monthlyBudget) &&
    input.monthlyBudget > 0 &&
    Number.isSafeInteger(input.maxAttempts) &&
    input.maxAttempts > 0 &&
    Number.isSafeInteger(input.leaseMs) &&
    input.leaseMs > 0
  );
}

export class PostgresNotificationOutboxStore implements NotificationDeliveryStore {
  constructor(private readonly database: Database = applicationDatabase) {}

  async prepare(input: DueSchedule) {
    if (!validDue(input)) throw new Error("notification due item invalid");
    return this.database.transaction(async (transaction) => {
      const now = await databaseNow(transaction);
      if (now < input.dueAt) {
        throw new Error("notification due window has not opened");
      }
      if (now >= input.departureAt) {
        throw new Error("notification departure has passed");
      }
      const activeSchedule = await transaction.execute(
        drizzleSql`
          select
            id::text as id,
            paused,
            days,
            departure_time as "departureTime",
            timezone,
            lead_minutes as "leadMinutes"
          from commute_schedules
          where id = ${input.scheduleId}
            and paused = false
            and timezone = 'America/Los_Angeles'
          for update
        `,
      );
      if (activeSchedule.length !== 1) {
        throw new Error("notification schedule is not active");
      }
      const scheduleRow = object(activeSchedule[0]);
      const days = scheduleDays(scheduleRow?.days);
      const leadMinutes = safeInteger(scheduleRow?.leadMinutes);
      if (
        !validUuid(scheduleRow?.id) ||
        scheduleRow.paused !== false ||
        scheduleRow.timezone !== "America/Los_Angeles" ||
        !days ||
        typeof scheduleRow.departureTime !== "string" ||
        !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(scheduleRow.departureTime) ||
        leadMinutes === null ||
        !APPROVED_LEADS.has(leadMinutes)
      ) {
        throw new Error("notification schedule contract unavailable");
      }
      const currentDue = findDueSchedules({
        schedules: [
          {
            id: scheduleRow.id,
            active: true,
            weekdays: days,
            departureTime: scheduleRow.departureTime,
            reminderLeadMinutes: leadMinutes as 15 | 30 | 45 | 60,
          },
        ],
        now: new Date(input.dueAt.getTime() + 1),
      }).find(
        (candidate) =>
          candidate.idempotencyKey === input.idempotencyKey &&
          candidate.serviceDate === input.serviceDate,
      );
      if (
        !currentDue ||
        currentDue.dueAt.getTime() !== input.dueAt.getTime() ||
        currentDue.departureAt.getTime() !== input.departureAt.getTime()
      ) {
        throw new Error("notification schedule changed");
      }
      const inserted = await transaction.execute(
        drizzleSql`
          insert into notification_outbox (
            schedule_id,
            service_date,
            departure_at,
            idempotency_key,
            status,
            attempt_count,
            next_attempt_at,
            prepared_at,
            created_at,
            updated_at
          ) values (
            ${input.scheduleId},
            ${input.serviceDate},
            ${input.departureAt},
            ${input.idempotencyKey},
            'pending',
            0,
            ${input.dueAt},
            ${now},
            ${now},
            ${now}
          )
          on conflict do nothing
          returning id::text as id
        `,
      );
      const insertedId = object(inserted[0])?.id;
      if (validUuid(insertedId)) {
        return { status: "prepared" as const, outboxId: insertedId };
      }
      const existing = await transaction.execute(
        drizzleSql`
          select id::text as id, idempotency_key as "idempotencyKey"
          from notification_outbox
          where schedule_id = ${input.scheduleId}
            and service_date = ${input.serviceDate}
          for share
        `,
      );
      const existingRow = object(existing[0]);
      if (
        validUuid(existingRow?.id) &&
        existingRow?.idempotencyKey === input.idempotencyKey
      ) {
        return { status: "duplicate" as const, outboxId: existingRow.id };
      }
      throw new Error("notification outbox conflict unavailable");
    });
  }

  async listDueOutboxIds(now: Date, limit = 80): Promise<readonly string[]> {
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) return [];
    const boundedLimit =
      Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 80) : 80;
    const rows = await this.database.execute(
      drizzleSql`
        select id::text as id
        from notification_outbox
        where departure_at > clock_timestamp()
          and (
            (status = ${"pending"} and next_attempt_at <= clock_timestamp()) or
            (status = ${"failed"} and next_attempt_at is not null
              and next_attempt_at <= clock_timestamp()) or
            (status = ${"sending"}
              and updated_at <= clock_timestamp()
                - make_interval(secs => ${SEND_LEASE_MS / 1_000}))
          )
        order by next_attempt_at asc, id asc
        limit ${boundedLimit}
      `,
    );
    const ids: string[] = [];
    const seen = new Set<string>();
    for (const value of rows) {
      const id = object(value)?.id;
      if (!validUuid(id) || seen.has(id)) {
        throw new Error("notification due outbox unavailable");
      }
      seen.add(id);
      ids.push(id);
    }
    return ids;
  }

  async claim(input: {
    outboxId: string;
    now: Date;
    dailyBudget: number;
    monthlyBudget: number;
    maxAttempts: number;
    leaseMs: number;
  }): Promise<NotificationClaimResult> {
    if (!validUuid(input.outboxId)) return { status: "not_found" };
    if (!validClaimInput(input)) return { status: "failed" };
    return this.database.transaction(async (transaction) => {
      const now = await databaseNow(transaction);
      const row = await lockedOutbox(transaction, input.outboxId);
      if (!row) return { status: "not_found" as const };
      if (row.status === "sent") return { status: "already_sent" as const };
      if (row.status === "suppressed") return { status: "suppressed" as const };
      if (row.status === "failed" && row.nextAttemptAt === null) {
        return { status: "failed" as const };
      }
      if (now >= row.departureAt) {
        if (row.attemptCount > 0) {
          await settleBudgetReservation(
            transaction,
            row.serviceDate,
            row.id,
            "release",
          );
        }
        await transaction.execute(
          drizzleSql`
            update notification_outbox
            set status = 'suppressed', next_attempt_at = null,
                updated_at = clock_timestamp()
            where id = ${row.id}
          `,
        );
        return { status: "suppressed" as const };
      }
      if (
        row.status === "sending" &&
        now.getTime() - row.updatedAt.getTime() < input.leaseMs
      ) {
        return { status: "in_flight" as const };
      }
      if (row.nextAttemptAt && row.nextAttemptAt > now) {
        return { status: "retry_not_due" as const };
      }
      if (row.attemptCount >= input.maxAttempts) {
        if (row.attemptCount > 0) {
          await settleBudgetReservation(
            transaction,
            row.serviceDate,
            row.id,
            "release",
          );
        }
        await transaction.execute(
          drizzleSql`
            update notification_outbox
            set status = 'failed', next_attempt_at = null,
                updated_at = clock_timestamp()
            where id = ${row.id}
          `,
        );
        return { status: "failed" as const };
      }
      if (await circuitIsPaused(transaction)) {
        return { status: "circuit_paused" as const };
      }
      const periods = periodStarts(row.serviceDate);
      if (!periods) return { status: "failed" as const };
      if (row.attemptCount === 0) {
        const day = await lockBudget(transaction, "day", periods.day);
        const month = await lockBudget(transaction, "month", periods.month);
        if (
          day.reservedCount + day.sentCount >= input.dailyBudget ||
          month.reservedCount + month.sentCount >= input.monthlyBudget
        ) {
          await pauseEmailCircuit(transaction);
          return { status: "budget_exhausted" as const };
        }
        await transaction.execute(
          drizzleSql`
            update email_budget_ledger
            set reserved_count = reserved_count + 1,
                updated_at = clock_timestamp()
            where period = 'day' and period_start = ${periods.day}
          `,
        );
        await transaction.execute(
          drizzleSql`
            update email_budget_ledger
            set reserved_count = reserved_count + 1,
                updated_at = clock_timestamp()
            where period = 'month' and period_start = ${periods.month}
          `,
        );
      }
      const attemptNumber = row.attemptCount + 1;
      await transaction.execute(
        drizzleSql`
          update notification_outbox
          set status = 'sending',
              attempt_count = ${attemptNumber},
              next_attempt_at = null,
              updated_at = clock_timestamp()
          where id = ${row.id}
        `,
      );
      return {
        status: "claimed" as const,
        claim: {
          outboxId: row.id,
          scheduleId: row.scheduleId,
          serviceDate: row.serviceDate,
          departureAt: row.departureAt,
          idempotencyKey: row.idempotencyKey,
          attemptNumber,
        },
      };
    });
  }

  async confirmSendReady(input: {
    claim: NotificationSendClaim;
  }): Promise<NotificationSendReadiness> {
    if (!validUuid(input.claim.outboxId)) return { status: "ignored" };
    return this.database.transaction(async (transaction) => {
      const now = await databaseNow(transaction);
      const row = await lockedOutbox(transaction, input.claim.outboxId);
      if (
        !row ||
        row.status !== "sending" ||
        row.attemptCount < 1 ||
        !claimMatchesRow(input.claim, row)
      ) {
        return { status: "ignored" as const };
      }
      if (now < row.departureAt) return { status: "ready" as const };

      await settleBudgetReservation(
        transaction,
        row.serviceDate,
        row.id,
        "release",
      );
      const updated = await transaction.execute(
        drizzleSql`
          update notification_outbox
          set status = 'suppressed', next_attempt_at = null,
              updated_at = clock_timestamp()
          where id = ${row.id}
            and status = 'sending'
            and attempt_count = ${input.claim.attemptNumber}
          returning id
        `,
      );
      if (updated.length !== 1) {
        throw new Error("notification send readiness transition failed");
      }
      return { status: "suppressed" as const };
    });
  }

  async markSent(input: {
    claim: NotificationSendClaim;
    providerMessageId: string | null;
  }) {
    if (
      !validUuid(input.claim.outboxId) ||
      !validProviderMessageId(input.providerMessageId)
    ) {
      return { status: "ignored" as const };
    }
    return this.database.transaction(async (transaction) => {
      const now = await databaseNow(transaction);
      const row = await lockedOutbox(transaction, input.claim.outboxId);
      if (!row) return { status: "ignored" as const };
      if (row.status === "sent") return { status: "already_sent" as const };
      if (row.status !== "sending" || !claimMatchesRow(input.claim, row)) {
        return { status: "ignored" as const };
      }
      await settleBudgetReservation(
        transaction,
        row.serviceDate,
        row.id,
        "sent",
      );
      await transaction.execute(
        drizzleSql`
          insert into email_deliveries (
            outbox_id, provider_message_id, status, attempt_number, delivered_at
          ) values (
            ${row.id}, ${input.providerMessageId}, 'sent',
            ${input.claim.attemptNumber}, ${now}
          )
          on conflict (outbox_id, attempt_number) do nothing
        `,
      );
      await transaction.execute(
        drizzleSql`
          update notification_outbox
          set status = 'sent', sent_at = ${now}, next_attempt_at = null,
              last_error_code = null, updated_at = ${now}
          where id = ${row.id}
        `,
      );
      return { status: "sent" as const };
    });
  }

  async markFailure(input: {
    claim: NotificationSendClaim;
    decision: NotificationFailureDecision;
  }) {
    if (
      !validUuid(input.claim.outboxId) ||
      !validFailureDecision(input.decision)
    ) {
      return { status: "ignored" as const };
    }
    return this.database.transaction(async (transaction) => {
      const now = await databaseNow(transaction);
      const row = await lockedOutbox(transaction, input.claim.outboxId);
      if (!row || row.status !== "sending") {
        return { status: "ignored" as const };
      }
      if (!claimMatchesRow(input.claim, row)) {
        return { status: "ignored" as const };
      }
      if (input.decision.pauseCircuit) {
        await pauseEmailCircuit(transaction);
      }
      const canRetry =
        input.decision.status === "retry_scheduled" &&
        input.decision.nextAttemptAt instanceof Date &&
        Number.isFinite(input.decision.nextAttemptAt.getTime()) &&
        now < input.decision.nextAttemptAt &&
        input.decision.nextAttemptAt < row.departureAt;
      const terminalStatus = now >= row.departureAt ? "suppressed" : "failed";
      const status = canRetry ? "failed" : terminalStatus;
      const nextAttemptAt = canRetry ? input.decision.nextAttemptAt : null;
      if (!canRetry)
        await settleBudgetReservation(
          transaction,
          row.serviceDate,
          row.id,
          "release",
        );
      await transaction.execute(
        drizzleSql`
          insert into email_deliveries (
            outbox_id, provider_message_id, status, attempt_number, error_code
          ) values (
            ${row.id}, null, 'failed', ${input.claim.attemptNumber},
            ${input.decision.errorCode}
          )
          on conflict (outbox_id, attempt_number) do nothing
        `,
      );
      await transaction.execute(
        drizzleSql`
          update notification_outbox
          set status = ${status}, next_attempt_at = ${nextAttemptAt},
              last_error_code = ${input.decision.errorCode},
              updated_at = clock_timestamp()
          where id = ${row.id}
        `,
      );
      if (canRetry && nextAttemptAt) {
        return { status: "retry_scheduled" as const, nextAttemptAt };
      }
      return { status: status as "failed" | "suppressed" };
    });
  }
}

function weekday(value: unknown): Weekday | null {
  if (typeof value !== "string") return null;
  const index = DAY_NAMES.indexOf(value as (typeof DAY_NAMES)[number]);
  return index < 0 ? null : ((index + 1) as Weekday);
}

function scheduleDays(value: unknown): Weekday[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 7) {
    return null;
  }
  const days = value.map(weekday);
  if (days.some((day) => day === null)) return null;
  const normalized = [...new Set(days as Weekday[])].sort((a, b) => a - b);
  return normalized.length === value.length ? normalized : null;
}

export class PostgresNotificationScheduleSource implements NotificationScheduleSource {
  constructor(private readonly database: Database = applicationDatabase) {}

  async listSchedules(): Promise<readonly SavedCommuteSchedule[]> {
    const rows = await this.database.execute(
      drizzleSql`
        select
          id::text as id,
          paused,
          days,
          departure_time as "departureTime",
          timezone,
          lead_minutes as "leadMinutes"
        from commute_schedules
        where paused = false
        order by id
      `,
    );
    const schedules: SavedCommuteSchedule[] = [];
    const seenIds = new Set<string>();
    for (const value of rows) {
      const row = object(value);
      const days = scheduleDays(row?.days);
      const leadMinutes = safeInteger(row?.leadMinutes);
      if (
        !validUuid(row?.id) ||
        seenIds.has(row.id) ||
        row?.paused !== false ||
        row?.timezone !== "America/Los_Angeles" ||
        !days ||
        typeof row?.departureTime !== "string" ||
        !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(row.departureTime) ||
        leadMinutes === null ||
        ![15, 30, 45, 60].includes(leadMinutes)
      ) {
        throw new Error("notification schedule source unavailable");
      }
      seenIds.add(row.id);
      schedules.push({
        id: row.id,
        active: true,
        weekdays: days,
        departureTime: row.departureTime,
        reminderLeadMinutes: leadMinutes as 15 | 30 | 45 | 60,
      });
    }
    return schedules;
  }
}
