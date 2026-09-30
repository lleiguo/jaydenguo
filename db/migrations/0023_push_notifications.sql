CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" text NOT NULL,
	"token" text NOT NULL,
	"environment" text NOT NULL,
	"topic" text NOT NULL,
	"kinds" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devices_session_id_unique" UNIQUE("session_id"),
	CONSTRAINT "devices_token_unique" UNIQUE("token"),
	CONSTRAINT "devices_environment_chk" CHECK ("devices"."environment" in ('sandbox', 'production'))
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"dedup_key" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"target" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_dedup_key_unique" UNIQUE("dedup_key"),
	CONSTRAINT "notifications_kind_chk" CHECK ("notifications"."kind" in ('clash', 'draw', 'entry_action', 'entry_change', 'video', 'sync_failed', 'suggestion'))
);
--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_created_idx" ON "notifications" USING btree ("created_at");