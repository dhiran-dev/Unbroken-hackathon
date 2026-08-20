ALTER TABLE "user" ALTER COLUMN "role" SET DEFAULT 'rider';--> statement-breakpoint
CREATE TABLE "rider_profiles" (
  "user_id" text PRIMARY KEY NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "signup_capacity" (
  "id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
  "max_accounts" integer DEFAULT 40 NOT NULL,
  "active_accounts" integer DEFAULT 0 NOT NULL,
  "reserved_accounts" integer DEFAULT 0 NOT NULL,
  "admission_state" text DEFAULT 'open' NOT NULL,
  "email_circuit_state" text DEFAULT 'closed' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "signup_capacity_singleton_ck" CHECK ("id" = 1),
  CONSTRAINT "signup_capacity_fixed_cap_ck" CHECK ("max_accounts" = 40),
  CONSTRAINT "signup_capacity_nonnegative_counts_ck" CHECK ("active_accounts" >= 0 AND "reserved_accounts" >= 0),
  CONSTRAINT "signup_capacity_within_cap_ck" CHECK ("active_accounts" + "reserved_accounts" <= "max_accounts"),
  CONSTRAINT "signup_capacity_admission_state_ck" CHECK ("admission_state" IN ('open', 'paused')),
  CONSTRAINT "signup_capacity_email_circuit_state_ck" CHECK ("email_circuit_state" IN ('closed', 'open', 'paused'))
);--> statement-breakpoint
INSERT INTO "signup_capacity" ("id", "max_accounts", "active_accounts", "reserved_accounts", "admission_state", "email_circuit_state")
VALUES (1, 40, 0, 0, 'open', 'closed');--> statement-breakpoint
CREATE TABLE "signup_reservations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "capacity_id" integer DEFAULT 1 NOT NULL REFERENCES "signup_capacity"("id") ON DELETE RESTRICT,
  "email" text NOT NULL,
  "user_id" text REFERENCES "user"("id") ON DELETE SET NULL,
  "status" text DEFAULT 'reserved' NOT NULL,
  "expires_at" timestamp with time zone DEFAULT (now() + INTERVAL '10 minutes') NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "signup_reservations_status_ck" CHECK ("status" IN ('reserved', 'activated', 'released', 'expired'))
);--> statement-breakpoint
CREATE INDEX "signup_reservations_capacity_idx" ON "signup_reservations" USING btree ("capacity_id");--> statement-breakpoint
CREATE INDEX "signup_reservations_email_idx" ON "signup_reservations" USING btree ("email");--> statement-breakpoint
CREATE INDEX "signup_reservations_user_id_idx" ON "signup_reservations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "signup_reservations_expiry_idx" ON "signup_reservations" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "signup_reservations_status_expiry_idx" ON "signup_reservations" USING btree ("status", "expires_at");
