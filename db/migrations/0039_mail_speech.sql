CREATE TABLE "mail_speech" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"day" date NOT NULL,
	"part" text NOT NULL,
	"chars" integer NOT NULL,
	"cost_usd" numeric(10, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "mail_speech_created_idx" ON "mail_speech" USING btree ("created_at");