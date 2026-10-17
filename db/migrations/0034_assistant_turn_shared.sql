ALTER TABLE "assistant_turns" ADD COLUMN "shared_kind" text;--> statement-breakpoint
ALTER TABLE "assistant_turns" ADD COLUMN "shared_count" integer;--> statement-breakpoint
ALTER TABLE "assistant_turns" ADD CONSTRAINT "assistant_turns_shared_chk" CHECK ("assistant_turns"."shared_kind" in ('images', 'pasted'));