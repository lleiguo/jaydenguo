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
import { users } from "./core";

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
