CREATE TABLE "auth_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"purpose" text NOT NULL,
	"user_id" uuid NOT NULL,
	"challenge" text,
	"device_name" text,
	"return_to" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "auth_codes_purpose_chk" CHECK ("auth_codes"."purpose" in ('device', 'handoff')),
	CONSTRAINT "auth_codes_fields_chk" CHECK (("auth_codes"."purpose" = 'device' and "auth_codes"."challenge" is not null) or ("auth_codes"."purpose" = 'handoff' and "auth_codes"."return_to" is not null))
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "kind" text DEFAULT 'browser' NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "device_name" text;--> statement-breakpoint
ALTER TABLE "auth_codes" ADD CONSTRAINT "auth_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_codes_expires_idx" ON "auth_codes" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_session_kind_chk" CHECK ("sessions"."kind" in ('browser', 'device', 'handoff'));