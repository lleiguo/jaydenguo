CREATE TABLE "tennis_entry_list" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"names" text[] NOT NULL,
	"tournament_player_ids" text[] NOT NULL,
	"status" text,
	"reserve_position" integer,
	CONSTRAINT "tennis_entry_list_status_chk" CHECK ("tennis_entry_list"."status" in ('main_draw', 'reserve', 'excluded'))
);
--> statement-breakpoint
ALTER TABLE "tennis_entry_list" ADD CONSTRAINT "tennis_entry_list_entry_id_tennis_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."tennis_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tennis_entry_list_entry_pos_uq" ON "tennis_entry_list" USING btree ("entry_id","position");