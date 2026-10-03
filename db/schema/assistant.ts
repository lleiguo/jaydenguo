// Cookie, the family assistant (intent 0007, spec §4.4). A turn is one
// question and its answer; a memory is one fact she was told to remember.
// Audio is never stored (CSEC-2).
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { ASSISTANT_MODES, ASSISTANT_OUTCOMES, MEMORY_VIAS } from "../../src/domain/assistant";
import { ACTION_KINDS, ACTION_STATES } from "../../src/domain/assistant-changes";
import { sources, users } from "./core";
import { events } from "./events";

const ts = (name: string) => timestamp(name, { withTimezone: true });
const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(", "));

export const assistantTurns = pgTable(
  "assistant_turns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Follow-ups share a conversation (MEM-8).
    conversationId: uuid("conversation_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    mode: text("mode").notNull(),
    // The question as typed or heard, and her answer. Both are cleared by
    // "Clear history" and after 90 days (MEM-9); the numbers stay.
    heard: text("heard"),
    answer: text("answer"),
    outcome: text("outcome").notNull(),
    language: text("language"),
    // Where the answer came from: [{ kind, label, url? }] (CHR-4).
    sources: jsonb("sources").notNull().default([]),
    // Which tools ran: [{ name, ms, chars }]. Never their contents (CSEC-7).
    tools: jsonb("tools").notNull().default([]),
    model: text("model"),
    modelVersion: text("model_version"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    audioSeconds: real("audio_seconds"),
    speechChars: integer("speech_chars").notNull().default(0),
    searches: integer("searches").notNull().default(0),
    // Estimated from tokens and list prices (LIM-6).
    costUsd: numeric("cost_usd", { precision: 10, scale: 4, mode: "number" }).notNull().default(0),
    createdAt: ts("created_at").notNull().defaultNow(),
    textClearedAt: ts("text_cleared_at"),
  },
  (t) => [
    index("assistant_turns_conversation_idx").on(t.conversationId, t.createdAt),
    index("assistant_turns_created_idx").on(t.createdAt),
    check("assistant_turns_mode_chk", sql`${t.mode} in (${inList(ASSISTANT_MODES)})`),
    check("assistant_turns_outcome_chk", sql`${t.outcome} in (${inList(ASSISTANT_OUTCOMES)})`),
  ],
);

// One memory for the whole family (MEM-7).
export const assistantMemories = pgTable(
  "assistant_memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    text: text("text").notNull(),
    // Search words in both languages, written when the fact is saved (MEM-3).
    keywords: text("keywords").array().notNull().default([]),
    // Who the fact is about: `people.id`s; empty for the family.
    about: uuid("about").array().notNull().default([]),
    via: text("via").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id),
    updatedAt: ts("updated_at"),
    // Forgotten facts can be restored for 30 days (MEM-4).
    forgottenAt: ts("forgotten_at"),
  },
  (t) => [
    index("assistant_memories_forgotten_idx").on(t.forgottenAt),
    check("assistant_memories_via_chk", sql`${t.via} in (${inList(MEMORY_VIAS)})`),
    check("assistant_memories_text_chk", sql`char_length(${t.text}) between 1 and 300`),
  ],
);

// What Cookie changed when a parent asked her to (intent 0008, ACT-2): an
// event she added, or an email suggestion she applied. An added event is
// in the hub at once and is written to the household Google Calendar by
// the worker; this row is how the worker knows, and what Undo reverses.
export const assistantActions = pgTable(
  "assistant_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Set when the question's turn is saved; an answer's actions share it.
    turnId: uuid("turn_id").references(() => assistantTurns.id, { onDelete: "set null" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    kind: text("kind").notNull(),
    state: text("state").notNull().default("pending"),
    eventId: uuid("event_id").references(() => events.id, { onDelete: "set null" }),
    // The household source whose Google calendar the event is written to.
    sourceId: uuid("source_id").references(() => sources.id, { onDelete: "set null" }),
    // Filled by the worker once Google has the event. Only an event whose
    // ID is here may ever be deleted from Google (GCW-2).
    googleCalendarId: text("google_calendar_id"),
    googleEventId: text("google_event_id"),
    // An applied email suggestion, and what its event looked like before.
    suggestionId: uuid("suggestion_id"),
    before: jsonb("before"),
    tries: integer("tries").notNull().default(0),
    createdAt: ts("created_at").notNull().defaultNow(),
    doneAt: ts("done_at"),
    undoneAt: ts("undone_at"),
  },
  (t) => [
    index("assistant_actions_turn_idx").on(t.turnId),
    index("assistant_actions_state_idx").on(t.state, t.createdAt),
    check("assistant_actions_kind_chk", sql`${t.kind} in (${inList(ACTION_KINDS)})`),
    check("assistant_actions_state_chk", sql`${t.state} in (${inList(ACTION_STATES)})`),
  ],
);

// An email Cookie was asked to read (intent 0009, §3.3): what to look for,
// and how it went. The worker reads the mail and writes the summary as a
// follow-up turn. Never the email's text, subject or sender (ERSEC-1).
export const EMAIL_READ_STATES = ["pending", "done", "failed"] as const;
export const assistantEmailReads = pgTable(
  "assistant_email_reads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // The question's turn, once saved; the follow-up goes in its conversation.
    turnId: uuid("turn_id").references(() => assistantTurns.id, { onDelete: "set null" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    conversationId: uuid("conversation_id").notNull(),
    // What the parent asked for, in their words.
    about: text("about").notNull(),
    fromHint: text("from_hint"),
    days: integer("days").notNull(),
    language: text("language"),
    state: text("state").notNull().default("pending"),
    followupTurnId: uuid("followup_turn_id").references(() => assistantTurns.id, { onDelete: "set null" }),
    createdAt: ts("created_at").notNull().defaultNow(),
    finishedAt: ts("finished_at"),
  },
  (t) => [
    index("assistant_email_reads_user_idx").on(t.userId, t.createdAt),
    index("assistant_email_reads_turn_idx").on(t.turnId),
    check("assistant_email_reads_state_chk", sql`${t.state} in (${inList(EMAIL_READ_STATES)})`),
    check("assistant_email_reads_days_chk", sql`${t.days} between 1 and 30`),
  ],
);
