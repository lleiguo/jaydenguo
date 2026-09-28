// Suggestions from coach and club emails (plan M5.8, spec EML-1..3, §7.2).
// Raw emails are never stored: `email_messages` only records which
// messages were read (so each is read once) and `email_suggestions` keeps
// the extracted fields and a short quote.
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sources } from "./core";
import { events } from "./events";

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const emailMessages = pgTable(
  "email_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id),
    gmailMessageId: text("gmail_message_id").notNull(),
    receivedAt: ts("received_at").notNull(),
    // Shown with the suggestions; the body is not kept.
    fromAddress: text("from_address").notNull(),
    subject: text("subject").notNull(),
    suggestions: integer("suggestions").notNull().default(0),
    model: text("model"),
    // What reading this email cost, estimated from tokens (COST-4).
    costUsd: numeric("cost_usd", { precision: 10, scale: 4, mode: "number" }),
    promptVersion: text("prompt_version"),
    readAt: ts("read_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("email_messages_source_message_uq").on(t.sourceId, t.gmailMessageId)],
);

export const emailSuggestions = pgTable(
  "email_suggestions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id),
    messageId: uuid("message_id")
      .notNull()
      .references(() => emailMessages.id),
    gmailMessageId: text("gmail_message_id").notNull(),
    messageUrl: text("message_url").notNull(),
    kind: text("kind").notNull(),
    // For a change or cancellation: the calendar event it's about.
    targetEventId: uuid("target_event_id").references(() => events.id, { onDelete: "set null" }),
    // Title, date, times, location, category, notes (EML-2).
    extracted: jsonb("extracted").notNull(),
    // Per field: high, medium or low.
    confidence: jsonb("confidence").notNull(),
    quote: text("quote").notNull(),
    status: text("status").notNull().default("pending"),
    // The event an approved "new" suggestion created.
    eventId: uuid("event_id").references(() => events.id, { onDelete: "set null" }),
    decidedAt: ts("decided_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("email_suggestions_status_idx").on(t.status, t.createdAt),
    check("email_suggestions_kind_chk", sql`${t.kind} in ('new', 'change', 'cancel')`),
    check("email_suggestions_status_chk", sql`${t.status} in ('pending', 'approved', 'rejected')`),
  ],
);
