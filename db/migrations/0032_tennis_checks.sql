CREATE TABLE "tennis_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"result" jsonb,
	"error" text,
	CONSTRAINT "tennis_checks_status_chk" CHECK ("tennis_checks"."status" in ('running', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE INDEX "tennis_checks_started_idx" ON "tennis_checks" USING btree ("started_at");