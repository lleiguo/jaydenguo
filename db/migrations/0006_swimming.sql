CREATE TABLE "swim_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meet_id" uuid NOT NULL,
	"distance" integer NOT NULL,
	"stroke" text NOT NULL,
	"course" text NOT NULL,
	"seed_time_ms" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "swim_entries_stroke_chk" CHECK ("swim_entries"."stroke" in ('free', 'back', 'breast', 'fly', 'im')),
	CONSTRAINT "swim_entries_course_chk" CHECK ("swim_entries"."course" in ('SCM', 'LCM', 'SCY')),
	CONSTRAINT "swim_entries_status_chk" CHECK ("swim_entries"."status" in ('active', 'withdrawn'))
);
--> statement-breakpoint
CREATE TABLE "swim_meets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid,
	"external_id" text,
	"name" text NOT NULL,
	"course" text,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"venue" text,
	"city" text,
	"signup" text,
	"source_url" text,
	"source_hash" text,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "swim_meets_course_chk" CHECK ("swim_meets"."course" is null or "swim_meets"."course" in ('SCM', 'LCM', 'SCY')),
	CONSTRAINT "swim_meets_status_chk" CHECK ("swim_meets"."status" in ('active', 'cancelled')),
	CONSTRAINT "swim_meets_dates_chk" CHECK ("swim_meets"."end_date" >= "swim_meets"."start_date"),
	CONSTRAINT "swim_meets_signup_chk" CHECK ("swim_meets"."signup" is null or "swim_meets"."signup" in ('yes', 'no'))
);
--> statement-breakpoint
CREATE TABLE "swim_result_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"result_id" uuid NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"changed_by" text NOT NULL,
	"action" text NOT NULL,
	"sync_run_id" uuid,
	"before" jsonb,
	"after" jsonb
);
--> statement-breakpoint
CREATE TABLE "swim_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid,
	"external_id" text,
	"meet_id" uuid,
	"swim_date" date NOT NULL,
	"distance" integer NOT NULL,
	"stroke" text NOT NULL,
	"course" text NOT NULL,
	"time_ms" integer,
	"place" integer,
	"heat" integer,
	"lane" integer,
	"stage" text,
	"dq_reason" text,
	"splits" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"origin" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"source_values" jsonb,
	"source_hash" text,
	"corrected_at" timestamp with time zone,
	"corrected_by" text,
	"source_disagrees" boolean DEFAULT false NOT NULL,
	"notes" text,
	"deleted_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "swim_results_stroke_chk" CHECK ("swim_results"."stroke" in ('free', 'back', 'breast', 'fly', 'im')),
	CONSTRAINT "swim_results_course_chk" CHECK ("swim_results"."course" in ('SCM', 'LCM', 'SCY')),
	CONSTRAINT "swim_results_distance_chk" CHECK ("swim_results"."distance" between 25 and 1650),
	CONSTRAINT "swim_results_time_chk" CHECK ("swim_results"."time_ms" is null or "swim_results"."time_ms" > 0),
	CONSTRAINT "swim_results_origin_chk" CHECK ("swim_results"."origin" in ('source', 'manual')),
	CONSTRAINT "swim_results_status_chk" CHECK ("swim_results"."status" in ('active', 'cancelled'))
);
--> statement-breakpoint
ALTER TABLE "swim_entries" ADD CONSTRAINT "swim_entries_meet_id_swim_meets_id_fk" FOREIGN KEY ("meet_id") REFERENCES "public"."swim_meets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swim_meets" ADD CONSTRAINT "swim_meets_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swim_result_revisions" ADD CONSTRAINT "swim_result_revisions_result_id_swim_results_id_fk" FOREIGN KEY ("result_id") REFERENCES "public"."swim_results"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swim_result_revisions" ADD CONSTRAINT "swim_result_revisions_sync_run_id_sync_runs_id_fk" FOREIGN KEY ("sync_run_id") REFERENCES "public"."sync_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swim_results" ADD CONSTRAINT "swim_results_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swim_results" ADD CONSTRAINT "swim_results_meet_id_swim_meets_id_fk" FOREIGN KEY ("meet_id") REFERENCES "public"."swim_meets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "swim_entries_event_uq" ON "swim_entries" USING btree ("meet_id","distance","stroke","course");--> statement-breakpoint
CREATE UNIQUE INDEX "swim_meets_source_external_uq" ON "swim_meets" USING btree ("source_id","external_id");--> statement-breakpoint
CREATE INDEX "swim_meets_start_idx" ON "swim_meets" USING btree ("start_date");--> statement-breakpoint
CREATE INDEX "swim_result_revisions_result_idx" ON "swim_result_revisions" USING btree ("result_id","changed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "swim_results_source_external_uq" ON "swim_results" USING btree ("source_id","external_id");--> statement-breakpoint
CREATE INDEX "swim_results_event_idx" ON "swim_results" USING btree ("distance","stroke","course","swim_date");--> statement-breakpoint
CREATE INDEX "swim_results_meet_idx" ON "swim_results" USING btree ("meet_id");