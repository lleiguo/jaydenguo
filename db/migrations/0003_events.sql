CREATE TABLE "change_log" (
	"seq" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"ref_id" uuid
);
--> statement-breakpoint
CREATE TABLE "conflicts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_a" uuid NOT NULL,
	"event_b" uuid NOT NULL,
	"resolution" text DEFAULT 'accepted' NOT NULL,
	"resolved_by" text NOT NULL,
	"resolved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"undone_at" timestamp with time zone,
	CONSTRAINT "conflicts_order_chk" CHECK ("conflicts"."event_a" < "conflicts"."event_b")
);
--> statement-breakpoint
CREATE TABLE "event_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"new_start_utc" timestamp with time zone,
	"new_end_utc" timestamp with time zone,
	"skip" boolean DEFAULT false NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_snapshot" jsonb,
	"source_changed_at" timestamp with time zone,
	"cleared_at" timestamp with time zone,
	"cleared_by" text
);
--> statement-breakpoint
CREATE TABLE "event_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"changed_by" text NOT NULL,
	"action" text NOT NULL,
	"sync_run_id" uuid,
	"before" jsonb,
	"after" jsonb
);
--> statement-breakpoint
CREATE TABLE "event_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"notes" text,
	"location_name" text,
	"location_id" uuid,
	"attendance" text DEFAULT 'required' NOT NULL,
	"all_day" boolean DEFAULT false NOT NULL,
	"start_date" date NOT NULL,
	"until_date" date,
	"start_time" text NOT NULL,
	"duration_min" integer NOT NULL,
	"time_zone" text NOT NULL,
	"interval_weeks" integer DEFAULT 1 NOT NULL,
	"weekdays" integer[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "event_series_interval_chk" CHECK ("event_series"."interval_weeks" between 1 and 52),
	CONSTRAINT "event_series_duration_chk" CHECK ("event_series"."duration_min" between 1 and 10080)
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid,
	"external_id" text,
	"series_id" uuid,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"notes" text,
	"location_name" text,
	"location_id" uuid,
	"start_utc" timestamp with time zone NOT NULL,
	"end_utc" timestamp with time zone NOT NULL,
	"all_day" boolean DEFAULT false NOT NULL,
	"attendance" text DEFAULT 'required' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"source_url" text,
	"source_hash" text,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "events_category_chk" CHECK ("events"."category" in ('tennis', 'swimming', 'soccer', 'hockey', 'math', 'chinese', 'fitness', 'school_class', 'school_closure', 'other')),
	CONSTRAINT "events_attendance_chk" CHECK ("events"."attendance" in ('required', 'optional', 'parent_only')),
	CONSTRAINT "events_status_chk" CHECK ("events"."status" in ('active', 'cancelled')),
	CONSTRAINT "events_time_chk" CHECK ("events"."end_utc" >= "events"."start_utc")
);
--> statement-breakpoint
CREATE TABLE "location_buffers" (
	"from_id" uuid NOT NULL,
	"to_id" uuid NOT NULL,
	"minutes" integer NOT NULL,
	CONSTRAINT "location_buffers_from_id_to_id_pk" PRIMARY KEY("from_id","to_id"),
	CONSTRAINT "location_buffers_order_chk" CHECK ("location_buffers"."from_id" < "location_buffers"."to_id"),
	CONSTRAINT "location_buffers_minutes_chk" CHECK ("location_buffers"."minutes" between 0 and 600)
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"match" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "locations_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "last_success_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "consecutive_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "conflicts" ADD CONSTRAINT "conflicts_event_a_events_id_fk" FOREIGN KEY ("event_a") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflicts" ADD CONSTRAINT "conflicts_event_b_events_id_fk" FOREIGN KEY ("event_b") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_overrides" ADD CONSTRAINT "event_overrides_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_revisions" ADD CONSTRAINT "event_revisions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_revisions" ADD CONSTRAINT "event_revisions_sync_run_id_sync_runs_id_fk" FOREIGN KEY ("sync_run_id") REFERENCES "public"."sync_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_series" ADD CONSTRAINT "event_series_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_series_id_event_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."event_series"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_buffers" ADD CONSTRAINT "location_buffers_from_id_locations_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_buffers" ADD CONSTRAINT "location_buffers_to_id_locations_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conflicts_active_uq" ON "conflicts" USING btree ("event_a","event_b") WHERE "conflicts"."undone_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "event_overrides_active_uq" ON "event_overrides" USING btree ("event_id") WHERE "event_overrides"."cleared_at" is null;--> statement-breakpoint
CREATE INDEX "event_revisions_event_idx" ON "event_revisions" USING btree ("event_id","changed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "events_source_external_uq" ON "events" USING btree ("source_id","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "events_series_external_uq" ON "events" USING btree ("series_id","external_id");--> statement-breakpoint
CREATE INDEX "events_range_idx" ON "events" USING btree ("start_utc","end_utc");