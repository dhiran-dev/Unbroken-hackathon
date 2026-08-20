import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "drizzle/0004_commute_notifications.sql",
  "utf8",
);
const journal = JSON.parse(
  readFileSync("drizzle/meta/_journal.json", "utf8"),
) as { entries?: Array<{ idx?: number; tag?: string }> };
const snapshotPath = "drizzle/meta/0004_snapshot.json";
const snapshot = existsSync(snapshotPath)
  ? readFileSync(snapshotPath, "utf8")
  : "";

describe("commute migration seam", () => {
  it("registers the migration journal entry and authoritative snapshot", () => {
    expect(journal.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          idx: 4,
          tag: "0004_commute_notifications",
        }),
      ]),
    );
    expect(snapshot).toContain('"commute_schedules"');
    expect(snapshot).toContain('"notification_outbox"');
  });

  it("creates every commute and notification table with required columns", () => {
    for (const table of [
      "commute_schedules",
      "journey_plan_snapshots",
      "notification_outbox",
      "email_deliveries",
      "email_budget_ledger",
    ]) {
      expect(migration).toContain('CREATE TABLE "' + table + '"');
    }

    for (const column of [
      '"user_id" text NOT NULL',
      '"slot" text NOT NULL',
      '"days" jsonb NOT NULL',
      '"departure_time" text NOT NULL',
      "\"timezone\" text DEFAULT 'America/Los_Angeles' NOT NULL",
      '"lead_minutes" integer DEFAULT 30 NOT NULL',
      '"service_date" date NOT NULL',
      '"journey_snapshot_id" uuid',
      '"idempotency_key" text NOT NULL',
      '"attempt_count" integer DEFAULT 0 NOT NULL',
      '"attempt_number" integer NOT NULL',
      '"period_start" date NOT NULL',
      '"reserved_count" integer DEFAULT 0 NOT NULL',
      '"sent_count" integer DEFAULT 0 NOT NULL',
    ]) {
      expect(migration).toContain(column);
    }
  });

  it("preserves the fixed rider-facing schedule and delivery invariants", () => {
    for (const constraint of [
      "commute_schedules_slot_ck",
      "commute_schedules_timezone_ck",
      "commute_schedules_lead_minutes_ck",
      "commute_schedules_departure_time_ck",
      "commute_schedules_days_ck",
      "commute_schedules_catalog_places_ck",
      "journey_plan_snapshots_status_ck",
      "notification_outbox_status_ck",
      "notification_outbox_attempt_count_ck",
      "email_deliveries_attempt_number_ck",
      "email_budget_ledger_period_ck",
      "email_budget_ledger_counts_ck",
    ]) {
      expect(migration).toContain('CONSTRAINT "' + constraint + '"');
    }

    expect(migration).toContain(
      'CHECK ("commute_schedules"."origin_place_id" !~ \'(^|:)current_location($|:)\' AND "commute_schedules"."destination_place_id" !~ \'(^|:)current_location($|:)\')',
    );
    expect(migration).toContain(
      'CHECK ("commute_schedules"."departure_time" ~ \'^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$\')',
    );
  });

  it("keeps ownership, idempotency, and retry indexes explicit", () => {
    for (const index of [
      "commute_schedules_user_slot_uidx",
      "commute_schedules_user_id_idx",
      "journey_plan_snapshots_schedule_date_uidx",
      "journey_plan_snapshots_captured_at_idx",
      "notification_outbox_schedule_date_uidx",
      "notification_outbox_idempotency_key_uidx",
      "notification_outbox_due_idx",
      "email_deliveries_outbox_id_idx",
      "email_deliveries_outbox_attempt_uidx",
      "email_budget_ledger_period_start_uidx",
    ]) {
      expect(migration).toContain('"' + index + '"');
    }

    expect(migration).toContain(
      'REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action',
    );
    expect(migration).toContain(
      'REFERENCES "public"."commute_schedules"("id") ON DELETE cascade ON UPDATE no action',
    );
    expect(migration).toContain(
      'REFERENCES "public"."journey_plan_snapshots"("id") ON DELETE set null ON UPDATE no action',
    );
    expect(migration).toContain(
      'REFERENCES "public"."notification_outbox"("id") ON DELETE cascade ON UPDATE no action',
    );
  });
});
