CREATE TABLE "commute_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"slot" text NOT NULL,
	"origin_place_id" text NOT NULL,
	"destination_place_id" text NOT NULL,
	"days" jsonb NOT NULL,
	"departure_time" text NOT NULL,
	"timezone" text DEFAULT 'America/Los_Angeles' NOT NULL,
	"lead_minutes" integer DEFAULT 30 NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commute_schedules_slot_ck" CHECK ("commute_schedules"."slot" IN ('first', 'return')),
	CONSTRAINT "commute_schedules_timezone_ck" CHECK ("commute_schedules"."timezone" = 'America/Los_Angeles'),
	CONSTRAINT "commute_schedules_lead_minutes_ck" CHECK ("commute_schedules"."lead_minutes" IN (15, 30, 45, 60)),
	CONSTRAINT "commute_schedules_departure_time_ck" CHECK ("commute_schedules"."departure_time" ~ '^(0[0-9]|1[0-9]|2[0-3]):[0-5][0-9]$'),
	CONSTRAINT "commute_schedules_days_ck" CHECK (jsonb_typeof("commute_schedules"."days") = 'array' AND jsonb_array_length("commute_schedules"."days") BETWEEN 1 AND 7),
	CONSTRAINT "commute_schedules_catalog_places_ck" CHECK ("commute_schedules"."origin_place_id" !~ '(^|:)current_location($|:)' AND "commute_schedules"."destination_place_id" !~ '(^|:)current_location($|:)')
);
--> statement-breakpoint
CREATE TABLE "email_budget_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period" text NOT NULL,
	"period_start" date NOT NULL,
	"reserved_count" integer DEFAULT 0 NOT NULL,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_budget_ledger_period_ck" CHECK ("email_budget_ledger"."period" IN ('day', 'month')),
	CONSTRAINT "email_budget_ledger_counts_ck" CHECK ("email_budget_ledger"."reserved_count" >= 0 AND "email_budget_ledger"."sent_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "email_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outbox_id" uuid NOT NULL,
	"provider_message_id" text,
	"status" text NOT NULL,
	"attempt_number" integer NOT NULL,
	"error_code" text,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_deliveries_attempt_number_ck" CHECK ("email_deliveries"."attempt_number" > 0)
);
--> statement-breakpoint
CREATE TABLE "journey_plan_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"service_date" date NOT NULL,
	"status" text NOT NULL,
	"fingerprint" text NOT NULL,
	"plan" jsonb NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journey_plan_snapshots_status_ck" CHECK ("journey_plan_snapshots"."status" IN ('confirmed', 'check_details', 'unavailable', 'updates_unavailable'))
);
--> statement-breakpoint
CREATE TABLE "notification_outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"service_date" date NOT NULL,
	"journey_snapshot_id" uuid,
	"departure_at" timestamp with time zone NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"prepared_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_outbox_status_ck" CHECK ("notification_outbox"."status" IN ('pending', 'sending', 'sent', 'failed', 'suppressed')),
	CONSTRAINT "notification_outbox_attempt_count_ck" CHECK ("notification_outbox"."attempt_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "commute_schedules" ADD CONSTRAINT "commute_schedules_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_outbox_id_notification_outbox_id_fk" FOREIGN KEY ("outbox_id") REFERENCES "public"."notification_outbox"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_plan_snapshots" ADD CONSTRAINT "journey_plan_snapshots_schedule_id_commute_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."commute_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_schedule_id_commute_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."commute_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_journey_snapshot_id_journey_plan_snapshots_id_fk" FOREIGN KEY ("journey_snapshot_id") REFERENCES "public"."journey_plan_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "commute_schedules_user_slot_uidx" ON "commute_schedules" USING btree ("user_id","slot");--> statement-breakpoint
CREATE INDEX "commute_schedules_user_id_idx" ON "commute_schedules" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_budget_ledger_period_start_uidx" ON "email_budget_ledger" USING btree ("period","period_start");--> statement-breakpoint
CREATE INDEX "email_deliveries_outbox_id_idx" ON "email_deliveries" USING btree ("outbox_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_deliveries_outbox_attempt_uidx" ON "email_deliveries" USING btree ("outbox_id","attempt_number");--> statement-breakpoint
CREATE UNIQUE INDEX "journey_plan_snapshots_schedule_date_uidx" ON "journey_plan_snapshots" USING btree ("schedule_id","service_date");--> statement-breakpoint
CREATE INDEX "journey_plan_snapshots_captured_at_idx" ON "journey_plan_snapshots" USING btree ("captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_outbox_schedule_date_uidx" ON "notification_outbox" USING btree ("schedule_id","service_date");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_outbox_idempotency_key_uidx" ON "notification_outbox" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "notification_outbox_due_idx" ON "notification_outbox" USING btree ("status","next_attempt_at");