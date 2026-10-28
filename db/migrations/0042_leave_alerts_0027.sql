CREATE TABLE "device_locations" (
	"device_id" uuid PRIMARY KEY NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"accuracy_m" integer,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leave_alerts" (
	"device_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"start_utc" timestamp with time zone NOT NULL,
	"routed_at" timestamp with time zone,
	"drive_minutes" integer,
	"failures" integer DEFAULT 0 NOT NULL,
	"origin_lat" double precision,
	"origin_lng" double precision,
	"leave_by" timestamp with time zone,
	"sent" text[] DEFAULT '{}'::text[] NOT NULL,
	CONSTRAINT "leave_alerts_device_id_event_id_pk" PRIMARY KEY("device_id","event_id")
);
--> statement-breakpoint
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_kind_chk";--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "leave_people" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "device_locations" ADD CONSTRAINT "device_locations_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_alerts" ADD CONSTRAINT "leave_alerts_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_alerts" ADD CONSTRAINT "leave_alerts_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leave_alerts_start_idx" ON "leave_alerts" USING btree ("start_utc");--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kind_chk" CHECK ("notifications"."kind" in ('clash', 'draw', 'entry_action', 'entry_change', 'video', 'sync_failed', 'suggestion', 'cookie', 'tennis_result', 'swim', 'mail', 'leave'));