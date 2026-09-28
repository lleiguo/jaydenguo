CREATE TABLE "calendar_copy_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"calendar_id" text NOT NULL,
	"google_event_id" text NOT NULL,
	"hash" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calendar_copy_events" ADD CONSTRAINT "calendar_copy_events_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;