CREATE SCHEMA "pulse";
--> statement-breakpoint
CREATE TABLE "pulse"."change_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"product_observation_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pulse"."collection_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collector_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"row_count" integer,
	"page_fingerprint" text,
	"report" jsonb,
	"error_code" text,
	"error_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pulse"."collectors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"zone" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pulse"."flavour_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"flavour_id" uuid NOT NULL,
	"product_observation_id" uuid NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"normalized" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pulse"."flavours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pulse"."heal_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collector_id" uuid NOT NULL,
	"prompt" text NOT NULL,
	"preview" jsonb NOT NULL,
	"approved_at" timestamp with time zone,
	"approved_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pulse"."incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_run_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incidents_status_ck" CHECK ("pulse"."incidents"."status" IN ('open', 'resolved'))
);
--> statement-breakpoint
CREATE TABLE "pulse"."leaderboard_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"rank" integer NOT NULL,
	"metric_key" text NOT NULL,
	"metric_value" double precision NOT NULL,
	"eligible" boolean DEFAULT true NOT NULL,
	"eligibility_flags" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pulse"."leaderboard_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rebuilt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"summary" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pulse"."product_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"alias" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pulse"."product_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"page_fingerprint" text NOT NULL,
	"status" text DEFAULT 'candidate' NOT NULL,
	"normalized" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "product_observations_status_ck" CHECK ("pulse"."product_observations"."status" IN ('candidate', 'trusted', 'quarantined', 'rejected', 'superseded'))
);
--> statement-breakpoint
CREATE TABLE "pulse"."products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"category_label" text,
	"active" boolean DEFAULT true NOT NULL,
	"current_trusted_observation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pulse"."raw_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"collection_run_id" uuid NOT NULL,
	"collector_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"media_type" text NOT NULL,
	"page_fingerprint" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pulse"."sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"homepage_url" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pulse"."variant_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"variant_id" uuid NOT NULL,
	"product_observation_id" uuid NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"normalized" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pulse"."variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"region" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pulse"."change_events" ADD CONSTRAINT "change_events_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "pulse"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pulse"."change_events" ADD CONSTRAINT "change_events_product_observation_id_product_observations_id_fk" FOREIGN KEY ("product_observation_id") REFERENCES "pulse"."product_observations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pulse"."collection_runs" ADD CONSTRAINT "collection_runs_collector_id_collectors_id_fk" FOREIGN KEY ("collector_id") REFERENCES "pulse"."collectors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pulse"."collectors" ADD CONSTRAINT "collectors_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "pulse"."sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pulse"."flavour_observations" ADD CONSTRAINT "flavour_observations_flavour_id_flavours_id_fk" FOREIGN KEY ("flavour_id") REFERENCES "pulse"."flavours"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pulse"."flavour_observations" ADD CONSTRAINT "flavour_observations_product_observation_id_product_observations_id_fk" FOREIGN KEY ("product_observation_id") REFERENCES "pulse"."product_observations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pulse"."flavours" ADD CONSTRAINT "flavours_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "pulse"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pulse"."heal_sessions" ADD CONSTRAINT "heal_sessions_collector_id_collectors_id_fk" FOREIGN KEY ("collector_id") REFERENCES "pulse"."collectors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pulse"."incidents" ADD CONSTRAINT "incidents_collection_run_id_collection_runs_id_fk" FOREIGN KEY ("collection_run_id") REFERENCES "pulse"."collection_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pulse"."leaderboard_entries" ADD CONSTRAINT "leaderboard_entries_snapshot_id_leaderboard_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "pulse"."leaderboard_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pulse"."leaderboard_entries" ADD CONSTRAINT "leaderboard_entries_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "pulse"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pulse"."product_aliases" ADD CONSTRAINT "product_aliases_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "pulse"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pulse"."product_observations" ADD CONSTRAINT "product_observations_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "pulse"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pulse"."product_observations" ADD CONSTRAINT "product_observations_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "pulse"."sources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pulse"."products" ADD CONSTRAINT "products_current_trusted_observation_id_product_observations_id_fk" FOREIGN KEY ("current_trusted_observation_id") REFERENCES "pulse"."product_observations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pulse"."raw_records" ADD CONSTRAINT "raw_records_collection_run_id_collection_runs_id_fk" FOREIGN KEY ("collection_run_id") REFERENCES "pulse"."collection_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pulse"."raw_records" ADD CONSTRAINT "raw_records_collector_id_collectors_id_fk" FOREIGN KEY ("collector_id") REFERENCES "pulse"."collectors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pulse"."variant_observations" ADD CONSTRAINT "variant_observations_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "pulse"."variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pulse"."variant_observations" ADD CONSTRAINT "variant_observations_product_observation_id_product_observations_id_fk" FOREIGN KEY ("product_observation_id") REFERENCES "pulse"."product_observations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pulse"."variants" ADD CONSTRAINT "variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "pulse"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "change_events_product_occurred_idx" ON "pulse"."change_events" USING btree ("product_id","occurred_at");--> statement-breakpoint
CREATE INDEX "collection_runs_collector_started_idx" ON "pulse"."collection_runs" USING btree ("collector_id","started_at");--> statement-breakpoint
CREATE INDEX "collection_runs_status_idx" ON "pulse"."collection_runs" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "collectors_external_id_uidx" ON "pulse"."collectors" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "collectors_source_idx" ON "pulse"."collectors" USING btree ("source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "flavour_observations_observation_flavour_uidx" ON "pulse"."flavour_observations" USING btree ("product_observation_id","flavour_id");--> statement-breakpoint
CREATE INDEX "flavour_observations_flavour_idx" ON "pulse"."flavour_observations" USING btree ("flavour_id");--> statement-breakpoint
CREATE UNIQUE INDEX "flavours_product_slug_uidx" ON "pulse"."flavours" USING btree ("product_id","slug");--> statement-breakpoint
CREATE INDEX "flavours_product_idx" ON "pulse"."flavours" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "heal_sessions_collector_idx" ON "pulse"."heal_sessions" USING btree ("collector_id");--> statement-breakpoint
CREATE INDEX "incidents_status_detected_idx" ON "pulse"."incidents" USING btree ("status","detected_at");--> statement-breakpoint
CREATE UNIQUE INDEX "leaderboard_entries_snapshot_product_uidx" ON "pulse"."leaderboard_entries" USING btree ("snapshot_id","product_id");--> statement-breakpoint
CREATE INDEX "leaderboard_entries_snapshot_rank_idx" ON "pulse"."leaderboard_entries" USING btree ("snapshot_id","rank");--> statement-breakpoint
CREATE INDEX "leaderboard_snapshots_rebuilt_at_idx" ON "pulse"."leaderboard_snapshots" USING btree ("rebuilt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "product_aliases_product_alias_uidx" ON "pulse"."product_aliases" USING btree ("product_id","alias");--> statement-breakpoint
CREATE INDEX "product_aliases_alias_idx" ON "pulse"."product_aliases" USING btree ("alias");--> statement-breakpoint
CREATE UNIQUE INDEX "product_observations_source_slug_observed_uidx" ON "pulse"."product_observations" USING btree ("source_id","slug","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "product_observations_source_fingerprint_uidx" ON "pulse"."product_observations" USING btree ("source_id","page_fingerprint");--> statement-breakpoint
CREATE INDEX "product_observations_product_observed_idx" ON "pulse"."product_observations" USING btree ("product_id","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "products_slug_uidx" ON "pulse"."products" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "products_name_idx" ON "pulse"."products" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_records_run_fingerprint_uidx" ON "pulse"."raw_records" USING btree ("collection_run_id","page_fingerprint");--> statement-breakpoint
CREATE INDEX "raw_records_fingerprint_idx" ON "pulse"."raw_records" USING btree ("page_fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "sources_slug_uidx" ON "pulse"."sources" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "variant_observations_observation_variant_uidx" ON "pulse"."variant_observations" USING btree ("product_observation_id","variant_id");--> statement-breakpoint
CREATE INDEX "variant_observations_variant_idx" ON "pulse"."variant_observations" USING btree ("variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "variants_product_slug_uidx" ON "pulse"."variants" USING btree ("product_id","slug");--> statement-breakpoint
CREATE INDEX "variants_product_idx" ON "pulse"."variants" USING btree ("product_id");