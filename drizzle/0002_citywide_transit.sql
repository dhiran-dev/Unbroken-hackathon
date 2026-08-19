CREATE TYPE "public"."realtime_feed_type" AS ENUM('trip_updates', 'vehicles', 'alerts');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('accessibility_advisories', 'stop_relocations', 'stop_accessibility');--> statement-breakpoint
CREATE TYPE "public"."source_snapshot_status" AS ENUM('current', 'rejected', 'unavailable');--> statement-breakpoint
CREATE TYPE "public"."transit_snapshot_status" AS ENUM('staged', 'active', 'rejected', 'superseded');--> statement-breakpoint
CREATE TABLE "accessibility_advisories" (
	"snapshot_id" uuid NOT NULL,
	"advisory_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"affected_stop_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"affected_route_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"public_url" text NOT NULL,
	CONSTRAINT "accessibility_advisories_snapshot_id_advisory_id_pk" PRIMARY KEY("snapshot_id","advisory_id")
);
--> statement-breakpoint
CREATE TABLE "realtime_alerts" (
	"snapshot_id" uuid NOT NULL,
	"entity_id" text NOT NULL,
	"cause" text,
	"effect" text,
	"header" text NOT NULL,
	"description" text,
	"url" text,
	"active_periods" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"informed_entities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "realtime_alerts_snapshot_id_entity_id_pk" PRIMARY KEY("snapshot_id","entity_id")
);
--> statement-breakpoint
CREATE TABLE "realtime_feed_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transit_snapshot_id" uuid,
	"feed_type" realtime_feed_type NOT NULL,
	"payload_hash" text NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"source_updated_at" timestamp with time zone,
	"valid" boolean NOT NULL,
	"validation_report" jsonb NOT NULL,
	"entity_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "realtime_trip_updates" (
	"snapshot_id" uuid NOT NULL,
	"update_id" text NOT NULL,
	"entity_id" text NOT NULL,
	"trip_id" text NOT NULL,
	"route_id" text,
	"schedule_relationship" text NOT NULL,
	"stop_id" text,
	"stop_sequence" integer,
	"arrival_delay_seconds" integer,
	"departure_delay_seconds" integer,
	"arrival_at" timestamp with time zone,
	"departure_at" timestamp with time zone,
	CONSTRAINT "realtime_trip_updates_snapshot_id_update_id_pk" PRIMARY KEY("snapshot_id","update_id")
);
--> statement-breakpoint
CREATE TABLE "realtime_vehicle_positions" (
	"snapshot_id" uuid NOT NULL,
	"entity_id" text NOT NULL,
	"vehicle_id" text,
	"label" text,
	"trip_id" text,
	"route_id" text,
	"stop_id" text,
	"current_stop_sequence" integer,
	"current_status" text,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"bearing" double precision,
	"speed_meters_per_second" double precision,
	"observed_at" timestamp with time zone,
	CONSTRAINT "realtime_vehicle_positions_snapshot_id_entity_id_pk" PRIMARY KEY("snapshot_id","entity_id")
);
--> statement-breakpoint
CREATE TABLE "source_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "source_kind" NOT NULL,
	"collector_id" text NOT NULL,
	"source_url" text NOT NULL,
	"payload_hash" text NOT NULL,
	"structural_fingerprint" text,
	"checked_at" timestamp with time zone NOT NULL,
	"source_updated_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"status" "source_snapshot_status" NOT NULL,
	"validation_report" jsonb NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stop_accessibility_guides" (
	"snapshot_id" uuid NOT NULL,
	"guide_id" text NOT NULL,
	"stop_id" text,
	"station_name" text NOT NULL,
	"route_names" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"guidance" text NOT NULL,
	"accessibility_state" text NOT NULL,
	"reviewed" boolean DEFAULT false NOT NULL,
	"public_url" text NOT NULL,
	CONSTRAINT "stop_accessibility_guides_snapshot_id_guide_id_pk" PRIMARY KEY("snapshot_id","guide_id")
);
--> statement-breakpoint
CREATE TABLE "stop_relocations" (
	"snapshot_id" uuid NOT NULL,
	"row_id" text NOT NULL,
	"stop_id" text NOT NULL,
	"stop_name" text NOT NULL,
	"applicant" text,
	"route_names" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"from_description" text,
	"to_description" text NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"public_url" text NOT NULL,
	CONSTRAINT "stop_relocations_snapshot_id_row_id_pk" PRIMARY KEY("snapshot_id","row_id")
);
--> statement-breakpoint
CREATE TABLE "transit_feed_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"feed_hash" text NOT NULL,
	"source_url" text NOT NULL,
	"source_etag" text,
	"source_last_modified" text,
	"checked_at" timestamp with time zone NOT NULL,
	"source_updated_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"status" "transit_snapshot_status" DEFAULT 'staged' NOT NULL,
	"validation_report" jsonb NOT NULL,
	"file_manifest" jsonb NOT NULL,
	"coverage" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transit_landmarks" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"aliases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stop_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"evidence_url" text,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transit_routes" (
	"snapshot_id" uuid NOT NULL,
	"route_id" text NOT NULL,
	"agency_id" text,
	"short_name" text,
	"long_name" text,
	"description" text,
	"route_type" integer NOT NULL,
	"url" text,
	"color" text,
	"text_color" text,
	"sort_order" integer,
	CONSTRAINT "transit_routes_snapshot_id_route_id_pk" PRIMARY KEY("snapshot_id","route_id")
);
--> statement-breakpoint
CREATE TABLE "transit_services" (
	"snapshot_id" uuid NOT NULL,
	"service_id" text NOT NULL,
	"monday" boolean DEFAULT false NOT NULL,
	"tuesday" boolean DEFAULT false NOT NULL,
	"wednesday" boolean DEFAULT false NOT NULL,
	"thursday" boolean DEFAULT false NOT NULL,
	"friday" boolean DEFAULT false NOT NULL,
	"saturday" boolean DEFAULT false NOT NULL,
	"sunday" boolean DEFAULT false NOT NULL,
	"starts_on" date,
	"ends_on" date,
	"exceptions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "transit_services_snapshot_id_service_id_pk" PRIMARY KEY("snapshot_id","service_id")
);
--> statement-breakpoint
CREATE TABLE "transit_stop_times" (
	"snapshot_id" uuid NOT NULL,
	"trip_id" text NOT NULL,
	"stop_sequence" integer NOT NULL,
	"stop_id" text NOT NULL,
	"arrival_seconds" integer,
	"departure_seconds" integer,
	"stop_headsign" text,
	"pickup_type" integer DEFAULT 0 NOT NULL,
	"drop_off_type" integer DEFAULT 0 NOT NULL,
	"shape_distance_traveled" double precision,
	"timepoint" integer,
	CONSTRAINT "transit_stop_times_snapshot_id_trip_id_stop_sequence_pk" PRIMARY KEY("snapshot_id","trip_id","stop_sequence")
);
--> statement-breakpoint
CREATE TABLE "transit_stops" (
	"snapshot_id" uuid NOT NULL,
	"stop_id" text NOT NULL,
	"stop_code" text,
	"stop_name" text NOT NULL,
	"stop_description" text,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"location_type" integer DEFAULT 0 NOT NULL,
	"parent_station_id" text,
	"wheelchair_boarding" integer DEFAULT 0 NOT NULL,
	"platform_code" text,
	"zone_id" text,
	CONSTRAINT "transit_stops_snapshot_id_stop_id_pk" PRIMARY KEY("snapshot_id","stop_id")
);
--> statement-breakpoint
CREATE TABLE "transit_trips" (
	"snapshot_id" uuid NOT NULL,
	"trip_id" text NOT NULL,
	"route_id" text NOT NULL,
	"service_id" text NOT NULL,
	"headsign" text,
	"short_name" text,
	"direction_id" integer,
	"block_id" text,
	"shape_id" text,
	"wheelchair_accessible" integer DEFAULT 0 NOT NULL,
	"bikes_allowed" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "transit_trips_snapshot_id_trip_id_pk" PRIMARY KEY("snapshot_id","trip_id")
);
--> statement-breakpoint
ALTER TABLE "accessibility_advisories" ADD CONSTRAINT "accessibility_advisories_snapshot_id_source_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."source_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "realtime_alerts" ADD CONSTRAINT "realtime_alerts_snapshot_id_realtime_feed_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."realtime_feed_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "realtime_feed_snapshots" ADD CONSTRAINT "realtime_feed_snapshots_transit_snapshot_id_transit_feed_snapshots_id_fk" FOREIGN KEY ("transit_snapshot_id") REFERENCES "public"."transit_feed_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "realtime_trip_updates" ADD CONSTRAINT "realtime_trip_updates_snapshot_id_realtime_feed_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."realtime_feed_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "realtime_vehicle_positions" ADD CONSTRAINT "realtime_vehicle_positions_snapshot_id_realtime_feed_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."realtime_feed_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stop_accessibility_guides" ADD CONSTRAINT "stop_accessibility_guides_snapshot_id_source_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."source_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stop_relocations" ADD CONSTRAINT "stop_relocations_snapshot_id_source_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."source_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transit_routes" ADD CONSTRAINT "transit_routes_snapshot_id_transit_feed_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."transit_feed_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transit_services" ADD CONSTRAINT "transit_services_snapshot_id_transit_feed_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."transit_feed_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transit_stop_times" ADD CONSTRAINT "transit_stop_times_snapshot_id_transit_feed_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."transit_feed_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transit_stop_times" ADD CONSTRAINT "transit_stop_times_trip_fk" FOREIGN KEY ("snapshot_id","trip_id") REFERENCES "public"."transit_trips"("snapshot_id","trip_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transit_stop_times" ADD CONSTRAINT "transit_stop_times_stop_fk" FOREIGN KEY ("snapshot_id","stop_id") REFERENCES "public"."transit_stops"("snapshot_id","stop_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transit_stops" ADD CONSTRAINT "transit_stops_snapshot_id_transit_feed_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."transit_feed_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transit_stops" ADD CONSTRAINT "transit_stops_parent_fk" FOREIGN KEY ("snapshot_id","parent_station_id") REFERENCES "public"."transit_stops"("snapshot_id","stop_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transit_trips" ADD CONSTRAINT "transit_trips_snapshot_id_transit_feed_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."transit_feed_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transit_trips" ADD CONSTRAINT "transit_trips_route_fk" FOREIGN KEY ("snapshot_id","route_id") REFERENCES "public"."transit_routes"("snapshot_id","route_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transit_trips" ADD CONSTRAINT "transit_trips_service_fk" FOREIGN KEY ("snapshot_id","service_id") REFERENCES "public"."transit_services"("snapshot_id","service_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accessibility_advisories_time_idx" ON "accessibility_advisories" USING btree ("starts_at","ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "realtime_feed_snapshots_type_hash_uidx" ON "realtime_feed_snapshots" USING btree ("feed_type","payload_hash");--> statement-breakpoint
CREATE INDEX "realtime_feed_snapshots_latest_idx" ON "realtime_feed_snapshots" USING btree ("feed_type","checked_at");--> statement-breakpoint
CREATE INDEX "realtime_trip_updates_trip_idx" ON "realtime_trip_updates" USING btree ("trip_id");--> statement-breakpoint
CREATE INDEX "realtime_trip_updates_route_idx" ON "realtime_trip_updates" USING btree ("route_id");--> statement-breakpoint
CREATE INDEX "realtime_vehicle_positions_route_idx" ON "realtime_vehicle_positions" USING btree ("route_id");--> statement-breakpoint
CREATE UNIQUE INDEX "source_snapshots_kind_hash_uidx" ON "source_snapshots" USING btree ("kind","payload_hash");--> statement-breakpoint
CREATE INDEX "source_snapshots_latest_idx" ON "source_snapshots" USING btree ("kind","checked_at");--> statement-breakpoint
CREATE INDEX "stop_accessibility_guides_stop_idx" ON "stop_accessibility_guides" USING btree ("stop_id");--> statement-breakpoint
CREATE INDEX "stop_relocations_stop_idx" ON "stop_relocations" USING btree ("stop_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transit_feed_snapshots_hash_uidx" ON "transit_feed_snapshots" USING btree ("feed_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "transit_feed_snapshots_one_active_uidx" ON "transit_feed_snapshots" USING btree ("status") WHERE "transit_feed_snapshots"."status" = 'active';--> statement-breakpoint
CREATE INDEX "transit_feed_snapshots_checked_at_idx" ON "transit_feed_snapshots" USING btree ("checked_at");--> statement-breakpoint
CREATE INDEX "transit_landmarks_name_idx" ON "transit_landmarks" USING btree ("name");--> statement-breakpoint
CREATE INDEX "transit_routes_short_name_idx" ON "transit_routes" USING btree ("short_name");--> statement-breakpoint
CREATE INDEX "transit_stop_times_stop_idx" ON "transit_stop_times" USING btree ("snapshot_id","stop_id");--> statement-breakpoint
CREATE INDEX "transit_stop_times_trip_idx" ON "transit_stop_times" USING btree ("snapshot_id","trip_id");--> statement-breakpoint
CREATE INDEX "transit_stops_name_idx" ON "transit_stops" USING btree ("stop_name");--> statement-breakpoint
CREATE INDEX "transit_stops_code_idx" ON "transit_stops" USING btree ("stop_code");--> statement-breakpoint
CREATE INDEX "transit_stops_parent_idx" ON "transit_stops" USING btree ("snapshot_id","parent_station_id");--> statement-breakpoint
CREATE INDEX "transit_trips_route_idx" ON "transit_trips" USING btree ("snapshot_id","route_id");--> statement-breakpoint
CREATE INDEX "transit_trips_service_idx" ON "transit_trips" USING btree ("snapshot_id","service_id");
--> statement-breakpoint
CREATE TABLE "transit_shapes" (
	"snapshot_id" uuid NOT NULL,
	"shape_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"distance_traveled" double precision,
	CONSTRAINT "transit_shapes_snapshot_id_shape_id_sequence_pk" PRIMARY KEY("snapshot_id","shape_id","sequence")
);
--> statement-breakpoint
ALTER TABLE "transit_shapes" ADD CONSTRAINT "transit_shapes_snapshot_id_transit_feed_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."transit_feed_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transit_shapes_shape_idx" ON "transit_shapes" USING btree ("snapshot_id","shape_id");