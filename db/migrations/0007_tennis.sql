CREATE TABLE "tennis_draws" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"draw_no" text NOT NULL,
	"event_name" text,
	"draw_name" text,
	"kind" text DEFAULT 'other' NOT NULL,
	"size" integer,
	"position" integer,
	"seed" text,
	"next_match" jsonb,
	"source_url" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tennis_draws_kind_chk" CHECK ("tennis_draws"."kind" in ('bracket', 'other')),
	CONSTRAINT "tennis_draws_status_chk" CHECK ("tennis_draws"."status" in ('active', 'withdrawn'))
);
--> statement-breakpoint
CREATE TABLE "tennis_match_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"match_id" uuid NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"changed_by" text NOT NULL,
	"action" text NOT NULL,
	"sync_run_id" uuid,
	"before" jsonb,
	"after" jsonb
);
--> statement-breakpoint
CREATE TABLE "tennis_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid,
	"external_id" text,
	"tournament_id" uuid,
	"draw_no" text,
	"event_name" text,
	"round" text,
	"match_date" date NOT NULL,
	"scheduled_at" timestamp with time zone,
	"side1_player_id" uuid NOT NULL,
	"side1_partner_id" uuid,
	"side2_player_id" uuid NOT NULL,
	"side2_partner_id" uuid,
	"winner" smallint,
	"sets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"outcome" text NOT NULL,
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
	CONSTRAINT "tennis_matches_winner_chk" CHECK ("tennis_matches"."winner" is null or "tennis_matches"."winner" in (1, 2)),
	CONSTRAINT "tennis_matches_outcome_chk" CHECK ("tennis_matches"."outcome" in ('played', 'walkover', 'retired', 'scheduled')),
	CONSTRAINT "tennis_matches_origin_chk" CHECK ("tennis_matches"."origin" in ('source', 'manual')),
	CONSTRAINT "tennis_matches_status_chk" CHECK ("tennis_matches"."status" in ('active', 'cancelled')),
	CONSTRAINT "tennis_matches_sides_chk" CHECK ("tennis_matches"."side1_player_id" <> "tennis_matches"."side2_player_id")
);
--> statement-breakpoint
CREATE TABLE "tennis_players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid,
	"member_id" text,
	"name" text NOT NULL,
	"club" text,
	"profile_id" text,
	"is_self" boolean DEFAULT false NOT NULL,
	"profile_fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tennis_tournaments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid,
	"external_id" text,
	"name" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"venue" text,
	"city" text,
	"region" text,
	"entry_deadline" date,
	"categories" text[] DEFAULT '{}'::text[] NOT NULL,
	"entered" boolean DEFAULT false NOT NULL,
	"source_url" text,
	"source_hash" text,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tennis_tournaments_status_chk" CHECK ("tennis_tournaments"."status" in ('active', 'cancelled')),
	CONSTRAINT "tennis_tournaments_dates_chk" CHECK ("tennis_tournaments"."end_date" >= "tennis_tournaments"."start_date")
);
--> statement-breakpoint
ALTER TABLE "tennis_draws" ADD CONSTRAINT "tennis_draws_tournament_id_tennis_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tennis_tournaments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tennis_match_revisions" ADD CONSTRAINT "tennis_match_revisions_match_id_tennis_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."tennis_matches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tennis_match_revisions" ADD CONSTRAINT "tennis_match_revisions_sync_run_id_sync_runs_id_fk" FOREIGN KEY ("sync_run_id") REFERENCES "public"."sync_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tennis_matches" ADD CONSTRAINT "tennis_matches_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tennis_matches" ADD CONSTRAINT "tennis_matches_tournament_id_tennis_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tennis_tournaments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tennis_matches" ADD CONSTRAINT "tennis_matches_side1_player_id_tennis_players_id_fk" FOREIGN KEY ("side1_player_id") REFERENCES "public"."tennis_players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tennis_matches" ADD CONSTRAINT "tennis_matches_side1_partner_id_tennis_players_id_fk" FOREIGN KEY ("side1_partner_id") REFERENCES "public"."tennis_players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tennis_matches" ADD CONSTRAINT "tennis_matches_side2_player_id_tennis_players_id_fk" FOREIGN KEY ("side2_player_id") REFERENCES "public"."tennis_players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tennis_matches" ADD CONSTRAINT "tennis_matches_side2_partner_id_tennis_players_id_fk" FOREIGN KEY ("side2_partner_id") REFERENCES "public"."tennis_players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tennis_players" ADD CONSTRAINT "tennis_players_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tennis_tournaments" ADD CONSTRAINT "tennis_tournaments_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tennis_draws_tournament_draw_uq" ON "tennis_draws" USING btree ("tournament_id","draw_no");--> statement-breakpoint
CREATE INDEX "tennis_match_revisions_match_idx" ON "tennis_match_revisions" USING btree ("match_id","changed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tennis_matches_source_external_uq" ON "tennis_matches" USING btree ("source_id","external_id");--> statement-breakpoint
CREATE INDEX "tennis_matches_side1_idx" ON "tennis_matches" USING btree ("side1_player_id","match_date");--> statement-breakpoint
CREATE INDEX "tennis_matches_side2_idx" ON "tennis_matches" USING btree ("side2_player_id","match_date");--> statement-breakpoint
CREATE INDEX "tennis_matches_tournament_idx" ON "tennis_matches" USING btree ("tournament_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tennis_players_source_member_uq" ON "tennis_players" USING btree ("source_id","member_id");--> statement-breakpoint
CREATE INDEX "tennis_players_name_idx" ON "tennis_players" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "tennis_tournaments_source_external_uq" ON "tennis_tournaments" USING btree ("source_id","external_id");--> statement-breakpoint
CREATE INDEX "tennis_tournaments_start_idx" ON "tennis_tournaments" USING btree ("start_date");