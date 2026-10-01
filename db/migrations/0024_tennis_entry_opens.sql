ALTER TABLE "tennis_entries" DROP CONSTRAINT "tennis_entries_status_chk";--> statement-breakpoint
ALTER TABLE "tennis_entries" ADD COLUMN "entry_opens" date;--> statement-breakpoint
ALTER TABLE "tennis_entries" ADD CONSTRAINT "tennis_entries_status_chk" CHECK ("tennis_entries"."status" in ('found', 'entered', 'payment_needed', 'main_draw', 'reserve', 'withdrawn', 'skipped', 'not_open'));