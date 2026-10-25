// Today's mail (intent 0025, MD, MT, MSEC): a summary of each email the
// email source read, and the to-dos found in it. The email's text is never
// stored (0001 §7.2, MSEC-1); summaries go after 14 days and to-dos after
// 30 (MSEC-3).
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sources } from "./core";
import { emailSuggestions } from "./email";

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const MAIL_TOPICS = [
  "school",
  "tennis",
  "swimming",
  "soccer",
  "activities",
  "household",
  "other",
] as const;

export const mailItems = pgTable(
  "mail_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    gmailMessageId: text("gmail_message_id").notNull(),
    messageUrl: text("message_url").notNull(),
    receivedAt: ts("received_at").notNull(),
    // The home-time-zone date it belongs to (MD-5).
    day: date("day").notNull(),
    senderName: text("sender_name").notNull(),
    senderAddress: text("sender_address").notNull(),
    subject: text("subject").notNull(),
    // Null when it wasn't summarized: over the day's limit or the month's
    // cap (MD-7, MSEC-5); `skipped` says which.
    summary: text("summary"),
    skipped: text("skipped"),
    language: text("language"),
    // Automated mail with nothing new, folded under "Also came in" (MD-4).
    routine: boolean("routine").notNull().default(false),
    // A newsletter's picked items and the rest (MN-1), or null.
    newsletter: jsonb("newsletter").$type<{ picked: string[]; others: string[] } | null>(),
    // Person IDs; empty is the family (MG-1).
    people: uuid("people")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    topic: text("topic").notNull().default("other"),
    // The suggestion the email source made from the same message (MT-3).
    suggestionId: uuid("suggestion_id").references(() => emailSuggestions.id, { onDelete: "set null" }),
    // The parents who have seen it (MD-6), by user ID.
    readBy: uuid("read_by")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    model: text("model"),
    costUsd: numeric("cost_usd", { precision: 10, scale: 4, mode: "number" }),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("mail_items_source_message_uq").on(t.sourceId, t.gmailMessageId),
    index("mail_items_day_idx").on(t.day),
    check(
      "mail_items_topic_chk",
      sql`${t.topic} in ('school', 'tennis', 'swimming', 'soccer', 'activities', 'household', 'other')`,
    ),
    check("mail_items_skipped_chk", sql`${t.skipped} is null or ${t.skipped} in ('limit', 'cap', 'failed')`),
  ],
);

export const mailTodos = pgTable(
  "mail_todos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // A to-do can outlive its email's summary (30 days against 14), so it
    // keeps the subject and link itself.
    itemId: uuid("item_id").references(() => mailItems.id, { onDelete: "set null" }),
    subject: text("subject").notNull(),
    messageUrl: text("message_url").notNull(),
    text: text("text").notNull(),
    dueOn: date("due_on"),
    people: uuid("people")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    doneAt: ts("done_at"),
    doneBy: text("done_by"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("mail_todos_open_idx").on(t.doneAt, t.dueOn)],
);
