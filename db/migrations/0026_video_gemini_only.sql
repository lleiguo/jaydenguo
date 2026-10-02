ALTER TABLE "video_reviews" DROP CONSTRAINT "video_reviews_mode_chk";--> statement-breakpoint
ALTER TABLE "video_reviews" DROP CONSTRAINT "video_reviews_vote_chk";--> statement-breakpoint
ALTER TABLE "video_review_rounds" DROP COLUMN "labels";--> statement-breakpoint
ALTER TABLE "video_review_rounds" DROP COLUMN "scores";--> statement-breakpoint
ALTER TABLE "video_reviews" DROP COLUMN "mode";--> statement-breakpoint
ALTER TABLE "video_reviews" DROP COLUMN "verdict";--> statement-breakpoint
ALTER TABLE "video_reviews" DROP COLUMN "parent_vote";--> statement-breakpoint
ALTER TABLE "video_reviews" DROP COLUMN "voted_at";