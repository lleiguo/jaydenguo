// Calendar data (plan M1.4, spec §7.1, CAL-6, CON-5). Nothing here is ever
// hard-deleted: sync marks vanished events `cancelled`, a manual delete sets
// `deleted_at`, and every change is written to `event_revisions`.
import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sources, syncRuns } from "./core";

const ts = (name: string) => timestamp(name, { withTimezone: true });

import { ATTENDANCE, CATEGORIES } from "../../src/domain/constants";

export { ATTENDANCE, CATEGORIES, type Attendance, type Category } from "../../src/domain/constants";

const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(", "));

// Places with travel buffers (CON-1). `match` lists lower-case fragments of
// source location text that mean this place, e.g. "aquatic centre".
export const locations = pgTable("locations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  address: text("address"),
  match: text("match")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  createdAt: ts("created_at").notNull().defaultNow(),
});

// Travel time between two places, stored once per pair with from_id < to_id.
export const locationBuffers = pgTable(
  "location_buffers",
  {
    fromId: uuid("from_id")
      .notNull()
      .references(() => locations.id),
    toId: uuid("to_id")
      .notNull()
      .references(() => locations.id),
    minutes: integer("minutes").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.fromId, t.toId] }),
    check("location_buffers_order_chk", sql`${t.fromId} < ${t.toId}`),
    check("location_buffers_minutes_chk", sql`${t.minutes} between 0 and 600`),
  ],
);

// Manual repeating events (CAL-5): weekly, every N weeks, with an optional
// end date. Occurrences are written as ordinary event rows, so clashes,
// drag and drop and revisions treat them like any other event.
export const eventSeries = pgTable(
  "event_series",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    category: text("category").notNull(),
    notes: text("notes"),
    locationName: text("location_name"),
    locationId: uuid("location_id").references(() => locations.id),
    attendance: text("attendance").notNull().default("required"),
    allDay: boolean("all_day").notNull().default(false),
    startDate: date("start_date").notNull(),
    untilDate: date("until_date"),
    // Local wall-clock start "HH:MM" in `time_zone`, so DST shifts keep the
    // same local time (CAL-9).
    startTime: text("start_time").notNull(),
    durationMin: integer("duration_min").notNull(),
    timeZone: text("time_zone").notNull(),
    intervalWeeks: integer("interval_weeks").notNull().default(1),
    // 0 = Sunday … 6 = Saturday.
    weekdays: integer("weekdays").array().notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    deletedAt: ts("deleted_at"),
  },
  (t) => [
    check("event_series_interval_chk", sql`${t.intervalWeeks} between 1 and 52`),
    check("event_series_duration_chk", sql`${t.durationMin} between 1 and 10080`),
  ],
);

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Null for manual events.
    sourceId: uuid("source_id").references(() => sources.id),
    // Stable ID from the source (SYNC-3), or the occurrence date for a series.
    externalId: text("external_id"),
    seriesId: uuid("series_id").references(() => eventSeries.id),
    category: text("category").notNull(),
    title: text("title").notNull(),
    notes: text("notes"),
    locationName: text("location_name"),
    locationId: uuid("location_id").references(() => locations.id),
    startUtc: ts("start_utc").notNull(),
    endUtc: ts("end_utc").notNull(),
    // All-day events keep their dates at 00:00 UTC and are shown as dates,
    // not converted to the home time zone.
    allDay: boolean("all_day").notNull().default(false),
    attendance: text("attendance").notNull().default("required"),
    status: text("status").notNull().default("active"),
    deletedAt: ts("deleted_at"),
    sourceUrl: text("source_url"),
    // Hash of the source's fields, to tell whether a sync changed anything.
    sourceHash: text("source_hash"),
    lastSyncedAt: ts("last_synced_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("events_source_external_uq").on(t.sourceId, t.externalId),
    uniqueIndex("events_series_external_uq").on(t.seriesId, t.externalId),
    index("events_range_idx").on(t.startUtc, t.endUtc),
    check("events_category_chk", sql`${t.category} in (${inList(CATEGORIES)})`),
    check("events_attendance_chk", sql`${t.attendance} in (${inList(ATTENDANCE)})`),
    check("events_status_chk", sql`${t.status} in ('active', 'cancelled')`),
    check("events_time_chk", sql`${t.endUtc} >= ${t.startUtc}`),
  ],
);

// The owner's local changes to an event (CON-3, CON-4, CON-5). Sync never
// writes here except to flag that the source changed underneath. Undo clears
// a row instead of deleting it, so the history stays.
export const eventOverrides = pgTable(
  "event_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    newStartUtc: ts("new_start_utc"),
    newEndUtc: ts("new_end_utc"),
    // "Skip this one": Jayden won't attend.
    skip: boolean("skip").notNull().default(false),
    createdBy: text("created_by").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    // The source's version when the override was made, and when the source
    // later changed it ("source changed since you moved this").
    sourceSnapshot: jsonb("source_snapshot"),
    sourceChangedAt: ts("source_changed_at"),
    clearedAt: ts("cleared_at"),
    clearedBy: text("cleared_by"),
    // The override this one replaced; undo brings it back.
    replacesId: uuid("replaces_id"),
  },
  (t) => [
    uniqueIndex("event_overrides_active_uq")
      .on(t.eventId)
      .where(sql`${t.clearedAt} is null`),
  ],
);

// Clashes the owner accepted (CON-4 "accept clash"), per pair of events,
// with event_a < event_b. Detected clashes are computed, not stored.
export const conflicts = pgTable(
  "conflicts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventA: uuid("event_a")
      .notNull()
      .references(() => events.id),
    eventB: uuid("event_b")
      .notNull()
      .references(() => events.id),
    resolution: text("resolution").notNull().default("accepted"),
    resolvedBy: text("resolved_by").notNull(),
    resolvedAt: ts("resolved_at").notNull().defaultNow(),
    undoneAt: ts("undone_at"),
  },
  (t) => [
    check("conflicts_order_chk", sql`${t.eventA} < ${t.eventB}`),
    uniqueIndex("conflicts_active_uq")
      .on(t.eventA, t.eventB)
      .where(sql`${t.undoneAt} is null`),
  ],
);

// Every change to an event (CAL-6).
export const eventRevisions = pgTable(
  "event_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    changedAt: ts("changed_at").notNull().defaultNow(),
    // "sync" or the owner's email.
    changedBy: text("changed_by").notNull(),
    action: text("action").notNull(),
    syncRunId: uuid("sync_run_id").references(() => syncRuns.id),
    before: jsonb("before"),
    after: jsonb("after"),
  },
  (t) => [index("event_revisions_event_idx").on(t.eventId, t.changedAt)],
);

// A cursor for live updates (CAL-8): every write that changes what the
// calendar shows appends a row; browsers poll for anything newer.
export const changeLog = pgTable("change_log", {
  seq: bigserial("seq", { mode: "number" }).primaryKey(),
  at: ts("at").notNull().defaultNow(),
  kind: text("kind").notNull(),
  refId: uuid("ref_id"),
});

// Site-wide settings, e.g. the home time zone (CAL-9).
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});
