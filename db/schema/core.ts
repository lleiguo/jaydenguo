// Core tables for M0 (spec §7.1). Later milestones add their own files here.
import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { credentials } from "./credentials";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sources = pgTable("sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Adapter kind, e.g. google_calendar, ical, tennis_tc, commit_swim.
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  // Maps source-side calendars/teams to categories (tennis, swimming, ...).
  categoryMapping: jsonb("category_mapping").notNull().default({}),
  enabled: boolean("enabled").notNull().default(true),
  // Cron expression in the home time zone; null means daily default.
  schedule: text("schedule"),
  // Sign-in or feed link this source uses. Several sources can share one
  // credential (one Google grant covers Calendar, Gmail, Classroom).
  credentialId: uuid("credential_id").references(() => credentials.id),
  // Adapter settings that aren't secret, e.g. which Google calendar.
  config: jsonb("config").notNull().default({}),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  // Three in a row sends the owner an email (SYNC-4).
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const syncRuns = pgTable(
  "sync_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id),
    trigger: text("trigger").notNull(),
    status: text("status").notNull().default("running"),
    added: integer("added").notNull().default(0),
    changed: integer("changed").notNull().default(0),
    cancelled: integer("cancelled").notNull().default(0),
    // Plain-language error for the owner; never contains secrets (CRED-5).
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("sync_runs_source_started_idx").on(t.sourceId, t.startedAt),
    check("sync_runs_trigger_chk", sql`${t.trigger} in ('scheduled', 'manual')`),
    check("sync_runs_status_chk", sql`${t.status} in ('running', 'succeeded', 'failed', 'skipped')`),
  ],
);

// Who did what, when. Never stores secret values (CRED-7).
export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    target: text("target"),
    details: jsonb("details"),
  },
  (t) => [index("audit_log_at_idx").on(t.at)],
);
