CREATE TYPE "public"."component_status" AS ENUM('operational', 'degraded', 'outage', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."data_trust_state" AS ENUM('current', 'held_stale', 'source_unavailable', 'extraction_failed', 'awaiting_review');--> statement-breakpoint
CREATE TYPE "public"."equipment_status" AS ENUM('in_service', 'out_of_service', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."incident_state" AS ENUM('detected', 'acknowledged', 'heal_requested', 'preview_received', 'preview_rejected', 'awaiting_review', 'awaiting_approval', 'approved', 'rejected', 'verified', 'verification_failed');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."run_classification" AS ENUM('healthy_no_change', 'semantic_service_change', 'probable_layout_drift', 'source_unavailable', 'source_stale', 'ambiguous_contract_failure');--> statement-breakpoint
CREATE TYPE "public"."collection_run_status" AS ENUM('queued', 'collecting', 'validating', 'accepted', 'rejected', 'failed');--> statement-breakpoint
CREATE TYPE "public"."station_accessibility_status" AS ENUM('accessible', 'limited', 'unavailable', 'unknown');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"impersonated_by" text
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"role" text DEFAULT 'admin' NOT NULL,
	"banned" boolean DEFAULT false NOT NULL,
	"ban_reason" text,
	"ban_expires" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "access_path_requirements" (
	"access_path_id" uuid NOT NULL,
	"equipment_id" uuid NOT NULL,
	"dependency_group" integer DEFAULT 1 NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	CONSTRAINT "access_path_requirements_access_path_id_equipment_id_pk" PRIMARY KEY("access_path_id","equipment_id")
);
--> statement-breakpoint
CREATE TABLE "access_paths" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"label" text NOT NULL,
	"origin_node" text NOT NULL,
	"destination_node" text NOT NULL,
	"direction" text,
	"active" boolean DEFAULT true NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collection_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_id" text,
	"collector_id" text NOT NULL,
	"trigger" text NOT NULL,
	"status" "collection_run_status" DEFAULT 'queued' NOT NULL,
	"classification" "run_classification",
	"source_valid_at" timestamp with time zone,
	"collected_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"row_count" integer,
	"station_count" integer,
	"structural_fingerprint" text,
	"contract_version" text NOT NULL,
	"contract_report" jsonb,
	"reason_codes" jsonb,
	"error_code" text,
	"error_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "component_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"component" text NOT NULL,
	"status" "component_status" NOT NULL,
	"latency_ms" integer,
	"message" text,
	"metadata" jsonb,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"source_key" text NOT NULL,
	"source_name" text NOT NULL,
	"display_name" text NOT NULL,
	"equipment_type" text DEFAULT 'elevator' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipment_status_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"equipment_id" uuid NOT NULL,
	"collection_run_id" uuid NOT NULL,
	"from_status" "equipment_status" NOT NULL,
	"to_status" "equipment_status" NOT NULL,
	"effective_at" timestamp with time zone,
	"observed_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incident_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"incident_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"from_state" "incident_state",
	"to_state" "incident_state" NOT NULL,
	"actor_user_id" text,
	"details" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_run_id" uuid,
	"state" "incident_state" DEFAULT 'detected' NOT NULL,
	"classification" "run_classification" NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"fingerprint" text NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"payload" jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"incident_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"reasoning_effort" text NOT NULL,
	"prompt_version" text NOT NULL,
	"input_hash" text NOT NULL,
	"recommendation" text,
	"confidence" integer,
	"report" jsonb,
	"valid" boolean DEFAULT false NOT NULL,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_run_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"equipment_id" uuid NOT NULL,
	"equipment_status" "equipment_status" NOT NULL,
	"reported_station_accessibility" "station_accessibility_status" NOT NULL,
	"source_valid_at" timestamp with time zone NOT NULL,
	"source_last_changed_at" timestamp with time zone,
	"observed_at" timestamp with time zone NOT NULL,
	"raw_fields" jsonb NOT NULL,
	"normalized_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"outcome" text NOT NULL,
	"metadata" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_payloads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_run_id" uuid NOT NULL,
	"payload_hash" text NOT NULL,
	"media_type" text NOT NULL,
	"body" jsonb,
	"byte_length" bigint NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "route_recalculations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_run_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"affected_station_ids" jsonb NOT NULL,
	"affected_route_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "station_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_station_id" uuid NOT NULL,
	"to_station_id" uuid NOT NULL,
	"label" text NOT NULL,
	"step_free" boolean DEFAULT false NOT NULL,
	"version" integer NOT NULL,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "station_status_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"collection_run_id" uuid NOT NULL,
	"from_status" "station_accessibility_status" NOT NULL,
	"to_status" "station_accessibility_status" NOT NULL,
	"effective_at" timestamp with time zone,
	"accepted_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"source_name" text NOT NULL,
	"display_name" text NOT NULL,
	"corridor_order" integer NOT NULL,
	"reported_accessibility" "station_accessibility_status" DEFAULT 'unknown' NOT NULL,
	"computed_accessibility" "station_accessibility_status" DEFAULT 'unknown' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trusted_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_run_id" uuid NOT NULL,
	"trust_state" "data_trust_state" NOT NULL,
	"structural_fingerprint" text NOT NULL,
	"source_valid_at" timestamp with time zone NOT NULL,
	"collected_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"summary" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worker_heartbeats" (
	"worker_id" text PRIMARY KEY NOT NULL,
	"process_version" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"metadata" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_path_requirements" ADD CONSTRAINT "access_path_requirements_access_path_id_access_paths_id_fk" FOREIGN KEY ("access_path_id") REFERENCES "public"."access_paths"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_path_requirements" ADD CONSTRAINT "access_path_requirements_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_paths" ADD CONSTRAINT "access_paths_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_paths" ADD CONSTRAINT "access_paths_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_status_events" ADD CONSTRAINT "equipment_status_events_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_status_events" ADD CONSTRAINT "equipment_status_events_collection_run_id_collection_runs_id_fk" FOREIGN KEY ("collection_run_id") REFERENCES "public"."collection_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_events" ADD CONSTRAINT "incident_events_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_events" ADD CONSTRAINT "incident_events_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_collection_run_id_collection_runs_id_fk" FOREIGN KEY ("collection_run_id") REFERENCES "public"."collection_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "llm_reviews" ADD CONSTRAINT "llm_reviews_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_collection_run_id_collection_runs_id_fk" FOREIGN KEY ("collection_run_id") REFERENCES "public"."collection_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_equipment_id_equipment_id_fk" FOREIGN KEY ("equipment_id") REFERENCES "public"."equipment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_actions" ADD CONSTRAINT "operator_actions_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_payloads" ADD CONSTRAINT "raw_payloads_collection_run_id_collection_runs_id_fk" FOREIGN KEY ("collection_run_id") REFERENCES "public"."collection_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "route_recalculations" ADD CONSTRAINT "route_recalculations_collection_run_id_collection_runs_id_fk" FOREIGN KEY ("collection_run_id") REFERENCES "public"."collection_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "station_links" ADD CONSTRAINT "station_links_from_station_id_stations_id_fk" FOREIGN KEY ("from_station_id") REFERENCES "public"."stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "station_links" ADD CONSTRAINT "station_links_to_station_id_stations_id_fk" FOREIGN KEY ("to_station_id") REFERENCES "public"."stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "station_status_events" ADD CONSTRAINT "station_status_events_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "station_status_events" ADD CONSTRAINT "station_status_events_collection_run_id_collection_runs_id_fk" FOREIGN KEY ("collection_run_id") REFERENCES "public"."collection_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trusted_snapshots" ADD CONSTRAINT "trusted_snapshots_collection_run_id_collection_runs_id_fk" FOREIGN KEY ("collection_run_id") REFERENCES "public"."collection_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_provider_account_uidx" ON "account" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "session_token_uidx" ON "session" USING btree ("token");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_expires_at_idx" ON "session" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_uidx" ON "user" USING btree ("email");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "access_path_requirements_equipment_idx" ON "access_path_requirements" USING btree ("equipment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "access_paths_station_version_label_uidx" ON "access_paths" USING btree ("station_id","version","label");--> statement-breakpoint
CREATE UNIQUE INDEX "collection_runs_collection_id_uidx" ON "collection_runs" USING btree ("collection_id");--> statement-breakpoint
CREATE INDEX "collection_runs_created_at_idx" ON "collection_runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "collection_runs_classification_idx" ON "collection_runs" USING btree ("classification");--> statement-breakpoint
CREATE INDEX "component_checks_component_checked_idx" ON "component_checks" USING btree ("component","checked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_source_key_uidx" ON "equipment" USING btree ("source_key");--> statement-breakpoint
CREATE INDEX "equipment_station_id_idx" ON "equipment" USING btree ("station_id");--> statement-breakpoint
CREATE INDEX "equipment_status_events_equipment_idx" ON "equipment_status_events" USING btree ("equipment_id","observed_at");--> statement-breakpoint
CREATE INDEX "incident_events_incident_idx" ON "incident_events" USING btree ("incident_id");--> statement-breakpoint
CREATE INDEX "incidents_state_detected_idx" ON "incidents" USING btree ("state","detected_at");--> statement-breakpoint
CREATE INDEX "incidents_fingerprint_idx" ON "incidents" USING btree ("fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_idempotency_key_uidx" ON "jobs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "jobs_claim_idx" ON "jobs" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE INDEX "llm_reviews_incident_idx" ON "llm_reviews" USING btree ("incident_id");--> statement-breakpoint
CREATE UNIQUE INDEX "observations_run_equipment_uidx" ON "observations" USING btree ("collection_run_id","equipment_id");--> statement-breakpoint
CREATE INDEX "observations_equipment_observed_idx" ON "observations" USING btree ("equipment_id","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "operator_actions_idempotency_uidx" ON "operator_actions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "operator_actions_actor_created_idx" ON "operator_actions" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_payloads_run_uidx" ON "raw_payloads" USING btree ("collection_run_id");--> statement-breakpoint
CREATE INDEX "raw_payloads_expires_at_idx" ON "raw_payloads" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "route_recalculations_run_idx" ON "route_recalculations" USING btree ("collection_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "station_links_pair_version_uidx" ON "station_links" USING btree ("from_station_id","to_station_id","version");--> statement-breakpoint
CREATE INDEX "station_status_events_station_idx" ON "station_status_events" USING btree ("station_id","accepted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stations_slug_uidx" ON "stations" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "stations_source_name_uidx" ON "stations" USING btree ("source_name");--> statement-breakpoint
CREATE UNIQUE INDEX "stations_corridor_order_uidx" ON "stations" USING btree ("corridor_order");--> statement-breakpoint
CREATE UNIQUE INDEX "trusted_snapshots_run_uidx" ON "trusted_snapshots" USING btree ("collection_run_id");--> statement-breakpoint
CREATE INDEX "trusted_snapshots_accepted_at_idx" ON "trusted_snapshots" USING btree ("accepted_at");