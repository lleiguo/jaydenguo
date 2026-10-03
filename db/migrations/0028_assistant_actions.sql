CREATE TABLE "assistant_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"turn_id" uuid,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"event_id" uuid,
	"source_id" uuid,
	"google_calendar_id" text,
	"google_event_id" text,
	"suggestion_id" uuid,
	"before" jsonb,
	"tries" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"done_at" timestamp with time zone,
	"undone_at" timestamp with time zone,
	CONSTRAINT "assistant_actions_kind_chk" CHECK ("assistant_actions"."kind" in ('add_event', 'apply_suggestion')),
	CONSTRAINT "assistant_actions_state_chk" CHECK ("assistant_actions"."state" in ('pending', 'done', 'failed', 'undone'))
);
--> statement-breakpoint
ALTER TABLE "assistant_actions" ADD CONSTRAINT "assistant_actions_turn_id_assistant_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."assistant_turns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_actions" ADD CONSTRAINT "assistant_actions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_actions" ADD CONSTRAINT "assistant_actions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_actions" ADD CONSTRAINT "assistant_actions_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_actions_turn_idx" ON "assistant_actions" USING btree ("turn_id");--> statement-breakpoint
CREATE INDEX "assistant_actions_state_idx" ON "assistant_actions" USING btree ("state","created_at");