CREATE TABLE "assistant_memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"text" text NOT NULL,
	"keywords" text[] DEFAULT '{}' NOT NULL,
	"about" uuid[] DEFAULT '{}' NOT NULL,
	"via" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone,
	"forgotten_at" timestamp with time zone,
	CONSTRAINT "assistant_memories_via_chk" CHECK ("assistant_memories"."via" in ('voice', 'chat', 'settings')),
	CONSTRAINT "assistant_memories_text_chk" CHECK (char_length("assistant_memories"."text") between 1 and 300)
);
--> statement-breakpoint
CREATE TABLE "assistant_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"heard" text,
	"answer" text,
	"outcome" text NOT NULL,
	"language" text,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" text,
	"model_version" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"audio_seconds" real,
	"speech_chars" integer DEFAULT 0 NOT NULL,
	"searches" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(10, 4) DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"text_cleared_at" timestamp with time zone,
	CONSTRAINT "assistant_turns_mode_chk" CHECK ("assistant_turns"."mode" in ('voice', 'text')),
	CONSTRAINT "assistant_turns_outcome_chk" CHECK ("assistant_turns"."outcome" in ('answer', 'bark', 'limit', 'error'))
);
--> statement-breakpoint
ALTER TABLE "assistant_memories" ADD CONSTRAINT "assistant_memories_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_memories" ADD CONSTRAINT "assistant_memories_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_turns" ADD CONSTRAINT "assistant_turns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_memories_forgotten_idx" ON "assistant_memories" USING btree ("forgotten_at");--> statement-breakpoint
CREATE INDEX "assistant_turns_conversation_idx" ON "assistant_turns" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "assistant_turns_created_idx" ON "assistant_turns" USING btree ("created_at");