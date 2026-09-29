CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "event_overrides" ADD COLUMN "owner_ids" uuid[];--> statement-breakpoint
ALTER TABLE "event_series" ADD COLUMN "owner_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "owner_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "people_primary_uq" ON "people" USING btree ("is_primary") WHERE "people"."is_primary";