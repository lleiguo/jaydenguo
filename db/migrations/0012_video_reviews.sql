CREATE TABLE "video_review_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"round" text NOT NULL,
	"model" text NOT NULL,
	"model_version" text NOT NULL,
	"prompt_version" text NOT NULL,
	"labels" jsonb,
	"output" jsonb NOT NULL,
	"scores" jsonb,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd" numeric(10, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "video_review_rounds_round_chk" CHECK ("video_review_rounds"."round" in ('review', 'critique', 'rebuttal', 'final_score', 'combine')),
	CONSTRAINT "video_review_rounds_model_chk" CHECK ("video_review_rounds"."model" in ('gemini', 'claude'))
);
--> statement-breakpoint
CREATE TABLE "video_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sport" text NOT NULL,
	"url" text,
	"provider" text NOT NULL,
	"note" text,
	"filmed_on" date NOT NULL,
	"segment_start" real,
	"segment_end" real,
	"status" text DEFAULT 'queued' NOT NULL,
	"mode" text DEFAULT 'debate' NOT NULL,
	"progress" text,
	"error_message" text,
	"picker_session_id" text,
	"picker_uri" text,
	"media_item_id" text,
	"media_name" text,
	"duration_sec" real,
	"prompt_version" text,
	"verdict" jsonb,
	"combined_review" jsonb,
	"parent_vote" text,
	"voted_at" timestamp with time zone,
	"cost_usd" numeric(10, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "video_reviews_sport_chk" CHECK ("video_reviews"."sport" in ('tennis', 'swimming', 'soccer', 'hockey', 'other')),
	CONSTRAINT "video_reviews_provider_chk" CHECK ("video_reviews"."provider" in ('drive', 'photos', 'youtube', 'other')),
	CONSTRAINT "video_reviews_status_chk" CHECK ("video_reviews"."status" in ('queued', 'picking', 'analysing', 'done', 'failed', 'saved')),
	CONSTRAINT "video_reviews_mode_chk" CHECK ("video_reviews"."mode" in ('debate', 'gemini', 'claude')),
	CONSTRAINT "video_reviews_vote_chk" CHECK ("video_reviews"."parent_vote" is null or "video_reviews"."parent_vote" in ('gemini', 'claude')),
	CONSTRAINT "video_reviews_segment_chk" CHECK ("video_reviews"."segment_start" is null or "video_reviews"."segment_end" is null or "video_reviews"."segment_end" > "video_reviews"."segment_start")
);
--> statement-breakpoint
ALTER TABLE "video_review_rounds" ADD CONSTRAINT "video_review_rounds_review_id_video_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."video_reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "video_review_rounds_review_idx" ON "video_review_rounds" USING btree ("review_id","created_at");--> statement-breakpoint
CREATE INDEX "video_reviews_sport_created_idx" ON "video_reviews" USING btree ("sport","created_at");