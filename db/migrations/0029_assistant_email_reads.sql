CREATE TABLE "assistant_email_reads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"turn_id" uuid,
	"user_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"about" text NOT NULL,
	"from_hint" text,
	"days" integer NOT NULL,
	"language" text,
	"state" text DEFAULT 'pending' NOT NULL,
	"followup_turn_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "assistant_email_reads_state_chk" CHECK ("assistant_email_reads"."state" in ('pending', 'done', 'failed')),
	CONSTRAINT "assistant_email_reads_days_chk" CHECK ("assistant_email_reads"."days" between 1 and 30)
);
--> statement-breakpoint
ALTER TABLE "assistant_turns" DROP CONSTRAINT "assistant_turns_mode_chk";--> statement-breakpoint
ALTER TABLE "assistant_email_reads" ADD CONSTRAINT "assistant_email_reads_turn_id_assistant_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."assistant_turns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_email_reads" ADD CONSTRAINT "assistant_email_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_email_reads" ADD CONSTRAINT "assistant_email_reads_followup_turn_id_assistant_turns_id_fk" FOREIGN KEY ("followup_turn_id") REFERENCES "public"."assistant_turns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_email_reads_user_idx" ON "assistant_email_reads" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "assistant_email_reads_turn_idx" ON "assistant_email_reads" USING btree ("turn_id");--> statement-breakpoint
ALTER TABLE "assistant_turns" ADD CONSTRAINT "assistant_turns_mode_chk" CHECK ("assistant_turns"."mode" in ('voice', 'text', 'followup'));