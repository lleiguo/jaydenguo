CREATE TABLE "tennis_explanations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inputs_hash" text NOT NULL,
	"inputs" jsonb NOT NULL,
	"prompt_version" text NOT NULL,
	"model" text NOT NULL,
	"text" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "tennis_explanations_hash_uq" ON "tennis_explanations" USING btree ("inputs_hash");