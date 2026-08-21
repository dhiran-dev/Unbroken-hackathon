import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { user } from "./auth";

/**
 * Frozen mirror of the applied DB contract (disposition RETAIN). The domain
 * module `@/domain/commute/schedule` was removed with the L1 cleanup batch, so
 * the day union is inlined here verbatim to keep the migration-history mirror
 * compiling without resurrecting the deleted runtime.
 */
type CommuteDay =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export const commuteSchedules = pgTable(
  "commute_schedules",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    slot: text("slot").notNull(),
    originPlaceId: text("origin_place_id").notNull(),
    destinationPlaceId: text("destination_place_id").notNull(),
    days: jsonb("days").$type<readonly CommuteDay[]>().notNull(),
    departureTime: text("departure_time").notNull(),
    timezone: text("timezone").default("America/Los_Angeles").notNull(),
    leadMinutes: integer("lead_minutes").default(30).notNull(),
    paused: boolean("paused").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("commute_schedules_user_slot_uidx").on(
      table.userId,
      table.slot,
    ),
    index("commute_schedules_user_id_idx").on(table.userId),
    check(
      "commute_schedules_slot_ck",
      sql`${table.slot} IN ('first', 'return')`,
    ),
    check(
      "commute_schedules_timezone_ck",
      sql`${table.timezone} = 'America/Los_Angeles'`,
    ),
    check(
      "commute_schedules_lead_minutes_ck",
      sql`${table.leadMinutes} IN (15, 30, 45, 60)`,
    ),
    check(
      "commute_schedules_departure_time_ck",
      sql`${table.departureTime} ~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$'`,
    ),
    check(
      "commute_schedules_days_ck",
      sql`jsonb_typeof(${table.days}) = 'array' AND jsonb_array_length(${table.days}) BETWEEN 1 AND 7`,
    ),
    check(
      "commute_schedules_catalog_places_ck",
      sql`${table.originPlaceId} !~ '(^|:)current_location($|:)' AND ${table.destinationPlaceId} !~ '(^|:)current_location($|:)'`,
    ),
  ],
);

export const journeyPlanSnapshots = pgTable(
  "journey_plan_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scheduleId: uuid("schedule_id")
      .notNull()
      .references(() => commuteSchedules.id, { onDelete: "cascade" }),
    serviceDate: date("service_date").notNull(),
    status: text("status").notNull(),
    fingerprint: text("fingerprint").notNull(),
    plan: jsonb("plan").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("journey_plan_snapshots_schedule_date_uidx").on(
      table.scheduleId,
      table.serviceDate,
    ),
    index("journey_plan_snapshots_captured_at_idx").on(table.capturedAt),
    check(
      "journey_plan_snapshots_status_ck",
      sql`${table.status} IN ('confirmed', 'check_details', 'unavailable', 'updates_unavailable')`,
    ),
  ],
);

export const notificationOutbox = pgTable(
  "notification_outbox",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    scheduleId: uuid("schedule_id")
      .notNull()
      .references(() => commuteSchedules.id, { onDelete: "cascade" }),
    serviceDate: date("service_date").notNull(),
    journeySnapshotId: uuid("journey_snapshot_id").references(
      () => journeyPlanSnapshots.id,
      { onDelete: "set null" },
    ),
    departureAt: timestamp("departure_at", { withTimezone: true }).notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").default("pending").notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    preparedAt: timestamp("prepared_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("notification_outbox_schedule_date_uidx").on(
      table.scheduleId,
      table.serviceDate,
    ),
    uniqueIndex("notification_outbox_idempotency_key_uidx").on(
      table.idempotencyKey,
    ),
    index("notification_outbox_due_idx").on(table.status, table.nextAttemptAt),
    check(
      "notification_outbox_status_ck",
      sql`${table.status} IN ('pending', 'sending', 'sent', 'failed', 'suppressed')`,
    ),
    check(
      "notification_outbox_attempt_count_ck",
      sql`${table.attemptCount} >= 0`,
    ),
  ],
);

export const emailDeliveries = pgTable(
  "email_deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    outboxId: uuid("outbox_id")
      .notNull()
      .references(() => notificationOutbox.id, { onDelete: "cascade" }),
    providerMessageId: text("provider_message_id"),
    status: text("status").notNull(),
    attemptNumber: integer("attempt_number").notNull(),
    errorCode: text("error_code"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("email_deliveries_outbox_id_idx").on(table.outboxId),
    uniqueIndex("email_deliveries_outbox_attempt_uidx").on(
      table.outboxId,
      table.attemptNumber,
    ),
    check(
      "email_deliveries_attempt_number_ck",
      sql`${table.attemptNumber} > 0`,
    ),
  ],
);

export const emailBudgetLedger = pgTable(
  "email_budget_ledger",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    period: text("period").notNull(),
    periodStart: date("period_start").notNull(),
    reservedCount: integer("reserved_count").default(0).notNull(),
    sentCount: integer("sent_count").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("email_budget_ledger_period_start_uidx").on(
      table.period,
      table.periodStart,
    ),
    check(
      "email_budget_ledger_period_ck",
      sql`${table.period} IN ('day', 'month')`,
    ),
    check(
      "email_budget_ledger_counts_ck",
      sql`${table.reservedCount} >= 0 AND ${table.sentCount} >= 0`,
    ),
  ],
);
