CREATE TABLE "email_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"gmail_message_id" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"from_address" text NOT NULL,
	"subject" text NOT NULL,
	"suggestions" integer DEFAULT 0 NOT NULL,
	"model" text,
	"prompt_version" text,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"gmail_message_id" text NOT NULL,
	"message_url" text NOT NULL,
	"kind" text NOT NULL,
	"target_event_id" uuid,
	"extracted" jsonb NOT NULL,
	"confidence" jsonb NOT NULL,
	"quote" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"event_id" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_suggestions_kind_chk" CHECK ("email_suggestions"."kind" in ('new', 'change', 'cancel')),
	CONSTRAINT "email_suggestions_status_chk" CHECK ("email_suggestions"."status" in ('pending', 'approved', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "email_messages" ADD CONSTRAINT "email_messages_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_suggestions" ADD CONSTRAINT "email_suggestions_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_suggestions" ADD CONSTRAINT "email_suggestions_message_id_email_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."email_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_suggestions" ADD CONSTRAINT "email_suggestions_target_event_id_events_id_fk" FOREIGN KEY ("target_event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_suggestions" ADD CONSTRAINT "email_suggestions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_messages_source_message_uq" ON "email_messages" USING btree ("source_id","gmail_message_id");--> statement-breakpoint
CREATE INDEX "email_suggestions_status_idx" ON "email_suggestions" USING btree ("status","created_at");