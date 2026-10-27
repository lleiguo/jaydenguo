CREATE TABLE "video_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_id" uuid NOT NULL,
	"question" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"answer" jsonb,
	"error_message" text,
	"cost_usd" numeric(10, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "video_questions_status_chk" CHECK ("video_questions"."status" in ('queued', 'answering', 'done', 'failed')),
	CONSTRAINT "video_questions_question_chk" CHECK (length("video_questions"."question") between 1 and 500)
);
--> statement-breakpoint
ALTER TABLE "video_review_rounds" DROP CONSTRAINT "video_review_rounds_round_chk";--> statement-breakpoint
ALTER TABLE "video_questions" ADD CONSTRAINT "video_questions_review_id_video_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."video_reviews"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "video_questions_review_idx" ON "video_questions" USING btree ("review_id","created_at");--> statement-breakpoint
ALTER TABLE "video_review_rounds" ADD CONSTRAINT "video_review_rounds_round_chk" CHECK ("video_review_rounds"."round" in ('detect', 'review', 'critique', 'rebuttal', 'final_score', 'combine', 'question', 'transcribe'));