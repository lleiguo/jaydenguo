CREATE TABLE "daily_costs" (
	"day" date NOT NULL,
	"service" text NOT NULL,
	"cost" numeric(12, 4) NOT NULL,
	"currency" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_costs_day_service_pk" PRIMARY KEY("day","service")
);
--> statement-breakpoint
ALTER TABLE "email_messages" ADD COLUMN "cost_usd" numeric(10, 4);