CREATE TABLE "household_links" (
	"source_id" uuid NOT NULL,
	"hub_key" text NOT NULL,
	"google_event_id" text NOT NULL,
	"origin" text NOT NULL,
	"hash" text NOT NULL,
	"google_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "household_links_source_id_hub_key_pk" PRIMARY KEY("source_id","hub_key"),
	CONSTRAINT "household_links_source_id_google_event_id_unique" UNIQUE("source_id","google_event_id")
);
--> statement-breakpoint
ALTER TABLE "household_links" ADD CONSTRAINT "household_links_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE cascade ON UPDATE no action;