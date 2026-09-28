// Swimming (plan M2.2, spec §7.1, SWM-1..7). Like events, nothing here is
// hard-deleted: a meet or result that disappears from the source is marked
// `cancelled`, a manual delete sets `deleted_at`, and every change to a
// result is written to `swim_result_revisions`. PBs aren't stored; they're
// computed from the results (src/domain/swim.ts), so a correction can never
// leave a stale PB flag behind.
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { COURSES, STROKES } from "../../src/domain/swim-constants";
import { sources, syncRuns } from "./core";

const ts = (name: string) => timestamp(name, { withTimezone: true });
const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(", "));

export const swimMeets = pgTable(
  "swim_meets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Null for meets the owner added by hand.
    sourceId: uuid("source_id").references(() => sources.id),
    externalId: text("external_id"),
    name: text("name").notNull(),
    // SCM, LCM or SCY; null when the source doesn't say.
    course: text("course"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    venue: text("venue"),
    city: text("city"),
    // yes / no / null (not answered) for the athlete's sign-up.
    signup: text("signup"),
    sourceUrl: text("source_url"),
    sourceHash: text("source_hash"),
    status: text("status").notNull().default("active"),
    deletedAt: ts("deleted_at"),
    lastSyncedAt: ts("last_synced_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("swim_meets_source_external_uq").on(t.sourceId, t.externalId),
    index("swim_meets_start_idx").on(t.startDate),
    check("swim_meets_course_chk", sql`${t.course} is null or ${t.course} in (${inList(COURSES)})`),
    check("swim_meets_status_chk", sql`${t.status} in ('active', 'cancelled')`),
    check("swim_meets_dates_chk", sql`${t.endDate} >= ${t.startDate}`),
    check("swim_meets_signup_chk", sql`${t.signup} is null or ${t.signup} in ('yes', 'no')`),
  ],
);

// Events the athlete is entered in, with seed times (SWM-2).
export const swimEntries = pgTable(
  "swim_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    meetId: uuid("meet_id")
      .notNull()
      .references(() => swimMeets.id),
    distance: integer("distance").notNull(),
    stroke: text("stroke").notNull(),
    course: text("course").notNull(),
    seedTimeMs: integer("seed_time_ms"),
    // Which day of the meet (1 = first) and the session's start, "HH:MM" in
    // the meet's local time, when the source says.
    meetDay: integer("meet_day"),
    sessionStart: text("session_start"),
    // withdrawn: the source stopped listing the entry.
    status: text("status").notNull().default("active"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("swim_entries_event_uq").on(t.meetId, t.distance, t.stroke, t.course),
    check("swim_entries_stroke_chk", sql`${t.stroke} in (${inList(STROKES)})`),
    check("swim_entries_course_chk", sql`${t.course} in (${inList(COURSES)})`),
    check("swim_entries_status_chk", sql`${t.status} in ('active', 'withdrawn')`),
  ],
);

// One swim (SWM-3). The row holds the values the site shows. For a result
// from a source that the owner never corrected, those are the source's
// values. Once corrected (SWM-7, TEN-8's rule), sync only updates
// `source_values` and sets `source_disagrees` when they differ.
export const swimResults = pgTable(
  "swim_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id").references(() => sources.id),
    externalId: text("external_id"),
    meetId: uuid("meet_id").references(() => swimMeets.id),
    swimDate: date("swim_date").notNull(),
    distance: integer("distance").notNull(),
    stroke: text("stroke").notNull(),
    course: text("course").notNull(),
    // Null when there's no valid time (DQ, no-show).
    timeMs: integer("time_ms"),
    place: integer("place"),
    heat: integer("heat"),
    lane: integer("lane"),
    // e.g. Final, Prelim.
    stage: text("stage"),
    dqReason: text("dq_reason"),
    // Per leg, in order: [{ distance, ms }]. Empty when not available.
    splits: jsonb("splits")
      .notNull()
      .default(sql`'[]'::jsonb`),
    // source: came from a sync; manual: added by the owner.
    origin: text("origin").notNull(),
    status: text("status").notNull().default("active"),
    // The source's latest version of the fields above, and its hash.
    sourceValues: jsonb("source_values"),
    sourceHash: text("source_hash"),
    correctedAt: ts("corrected_at"),
    correctedBy: text("corrected_by"),
    sourceDisagrees: boolean("source_disagrees").notNull().default(false),
    notes: text("notes"),
    deletedAt: ts("deleted_at"),
    lastSyncedAt: ts("last_synced_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("swim_results_source_external_uq").on(t.sourceId, t.externalId),
    index("swim_results_event_idx").on(t.distance, t.stroke, t.course, t.swimDate),
    index("swim_results_meet_idx").on(t.meetId),
    check("swim_results_stroke_chk", sql`${t.stroke} in (${inList(STROKES)})`),
    check("swim_results_course_chk", sql`${t.course} in (${inList(COURSES)})`),
    check("swim_results_distance_chk", sql`${t.distance} between 25 and 1650`),
    check("swim_results_time_chk", sql`${t.timeMs} is null or ${t.timeMs} > 0`),
    check("swim_results_origin_chk", sql`${t.origin} in ('source', 'manual')`),
    check("swim_results_status_chk", sql`${t.status} in ('active', 'cancelled')`),
  ],
);

export const swimResultRevisions = pgTable(
  "swim_result_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    resultId: uuid("result_id")
      .notNull()
      .references(() => swimResults.id),
    changedAt: ts("changed_at").notNull().defaultNow(),
    // "sync" or the owner's email.
    changedBy: text("changed_by").notNull(),
    action: text("action").notNull(),
    syncRunId: uuid("sync_run_id").references(() => syncRuns.id),
    before: jsonb("before"),
    after: jsonb("after"),
  },
  (t) => [index("swim_result_revisions_result_idx").on(t.resultId, t.changedAt)],
);
