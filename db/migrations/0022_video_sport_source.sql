ALTER TABLE "video_review_rounds" DROP CONSTRAINT "video_review_rounds_round_chk";--> statement-breakpoint
ALTER TABLE "video_review_rounds" ADD COLUMN "superseded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "video_reviews" ADD COLUMN "sport_source" text DEFAULT 'chosen' NOT NULL;--> statement-breakpoint
ALTER TABLE "video_review_rounds" ADD CONSTRAINT "video_review_rounds_round_chk" CHECK ("video_review_rounds"."round" in ('detect', 'review', 'critique', 'rebuttal', 'final_score', 'combine'));--> statement-breakpoint
ALTER TABLE "video_reviews" ADD CONSTRAINT "video_reviews_sport_source_chk" CHECK ("video_reviews"."sport_source" in ('chosen', 'detecting', 'detected', 'unsure'));