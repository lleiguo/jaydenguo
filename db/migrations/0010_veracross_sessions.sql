CREATE TABLE "credential_sessions" (
	"credential_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"wrapped_dek" "bytea" NOT NULL,
	"key_version" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credential_sessions_credential_id_kind_pk" PRIMARY KEY("credential_id","kind"),
	CONSTRAINT "credential_sessions_kind_chk" CHECK ("credential_sessions"."kind" in ('browser', 'code'))
);
--> statement-breakpoint
ALTER TABLE "credential_sessions" ADD CONSTRAINT "credential_sessions_credential_id_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."credentials"("id") ON DELETE cascade ON UPDATE no action;