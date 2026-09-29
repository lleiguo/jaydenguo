ALTER TABLE "event_overrides" DROP CONSTRAINT "event_overrides_attendance_chk";--> statement-breakpoint
ALTER TABLE "events" DROP CONSTRAINT "events_attendance_chk";--> statement-breakpoint
ALTER TABLE "event_overrides" ADD CONSTRAINT "event_overrides_attendance_chk" CHECK ("event_overrides"."attendance" in ('required', 'optional'));--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_attendance_chk" CHECK ("events"."attendance" in ('required', 'optional'));