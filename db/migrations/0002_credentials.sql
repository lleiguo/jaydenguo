CREATE TABLE "credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"provider" text NOT NULL,
	"label" text NOT NULL,
	"username" text,
	"scopes" text[],
	"ciphertext" "bytea" NOT NULL,
	"wrapped_dek" "bytea" NOT NULL,
	"key_version" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"last_test_at" timestamp with time zone,
	"last_test_ok" boolean,
	"last_error" text,
	CONSTRAINT "credentials_kind_chk" CHECK ("credentials"."kind" in ('oauth', 'password', 'secret_url')),
	CONSTRAINT "credentials_status_chk" CHECK ("credentials"."status" in ('active', 'removing'))
);
--> statement-breakpoint
CREATE TABLE "oauth_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"nonce" text NOT NULL,
	"code_verifier" text NOT NULL,
	"scopes" text[] NOT NULL,
	"return_to" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "credential_id" uuid;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "config" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "credentials_provider_idx" ON "credentials" USING btree ("provider");--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_credential_id_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."credentials"("id") ON DELETE no action ON UPDATE no action;