CREATE TABLE "tennis_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"tournament_external_id" text NOT NULL,
	"tournament_name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"venue" text,
	"city" text,
	"region" text,
	"entry_deadline" date,
	"event_no" text NOT NULL,
	"event_name" text NOT NULL,
	"drive_minutes" integer,
	"drive_estimated" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'found' NOT NULL,
	"reserve_position" integer,
	"note" text,
	"tournament_player_id" text,
	"tournament_url" text NOT NULL,
	"entry_url" text,
	"entered_at" timestamp with time zone,
	"list_checked_at" timestamp with time zone,
	"draw_seen_at" timestamp with time zone,
	"draw_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tennis_entries_status_chk" CHECK ("tennis_entries"."status" in ('found', 'entered', 'payment_needed', 'main_draw', 'reserve', 'withdrawn', 'skipped')),
	CONSTRAINT "tennis_entries_dates_chk" CHECK ("tennis_entries"."end_date" >= "tennis_entries"."start_date")
);
--> statement-breakpoint
ALTER TABLE "tennis_entries" ADD CONSTRAINT "tennis_entries_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tennis_entries_source_event_uq" ON "tennis_entries" USING btree ("source_id","tournament_external_id","event_no");--> statement-breakpoint
CREATE INDEX "tennis_entries_start_idx" ON "tennis_entries" USING btree ("start_date");