CREATE TABLE "mail_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"gmail_message_id" text NOT NULL,
	"message_url" text NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"day" date NOT NULL,
	"sender_name" text NOT NULL,
	"sender_address" text NOT NULL,
	"subject" text NOT NULL,
	"summary" text,
	"skipped" text,
	"language" text,
	"routine" boolean DEFAULT false NOT NULL,
	"newsletter" jsonb,
	"people" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"topic" text DEFAULT 'other' NOT NULL,
	"suggestion_id" uuid,
	"read_by" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"model" text,
	"cost_usd" numeric(10, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_items_topic_chk" CHECK ("mail_items"."topic" in ('school', 'tennis', 'swimming', 'soccer', 'activities', 'household', 'other')),
	CONSTRAINT "mail_items_skipped_chk" CHECK ("mail_items"."skipped" is null or "mail_items"."skipped" in ('limit', 'cap', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "mail_todos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid,
	"subject" text NOT NULL,
	"message_url" text NOT NULL,
	"text" text NOT NULL,
	"due_on" date,
	"people" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"done_at" timestamp with time zone,
	"done_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_kind_chk";--> statement-breakpoint
ALTER TABLE "mail_items" ADD CONSTRAINT "mail_items_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_items" ADD CONSTRAINT "mail_items_suggestion_id_email_suggestions_id_fk" FOREIGN KEY ("suggestion_id") REFERENCES "public"."email_suggestions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_todos" ADD CONSTRAINT "mail_todos_item_id_mail_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."mail_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mail_items_source_message_uq" ON "mail_items" USING btree ("source_id","gmail_message_id");--> statement-breakpoint
CREATE INDEX "mail_items_day_idx" ON "mail_items" USING btree ("day");--> statement-breakpoint
CREATE INDEX "mail_todos_open_idx" ON "mail_todos" USING btree ("done_at","due_on");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kind_chk" CHECK ("notifications"."kind" in ('clash', 'draw', 'entry_action', 'entry_change', 'video', 'sync_failed', 'suggestion', 'cookie', 'tennis_result', 'swim', 'mail'));