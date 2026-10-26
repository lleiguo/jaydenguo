CREATE TABLE "mail_listen_cursors" (
	"conversation_id" uuid PRIMARY KEY NOT NULL,
	"day" date NOT NULL,
	"order" uuid[] NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
