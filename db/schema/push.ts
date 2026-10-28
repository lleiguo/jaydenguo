// Push notifications for the iPhone app (intent 0004, PUSH-1..6, plan N7).
import { sql } from "drizzle-orm";
import {
  check,
  doublePrecision,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { APNS_ENVIRONMENTS, NOTIFICATION_KINDS } from "../../src/domain/notifications";
import { sessions } from "./auth";
import { events } from "./events";

const ts = (name: string) => timestamp(name, { withTimezone: true });
const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(", "));

// One per signed-in phone: its APNs token and the kinds it wants (PUSH-3).
// It goes with its device session: a revoked or expired session gets
// nothing, and signing in again registers afresh.
export const devices = pgTable(
  "devices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: text("session_id")
      .notNull()
      .unique()
      .references(() => sessions.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    environment: text("environment").notNull(),
    // The app's bundle ID, the APNs topic (.dev builds differ).
    topic: text("topic").notNull(),
    kinds: text("kinds").array().notNull(),
    // Whose events "Time to leave" covers (intent 0027, TRF-A3): `people.id`s,
    // empty means everyone.
    leavePeople: uuid("leave_people")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [check("devices_environment_chk", sql`${t.environment} in (${inList(APNS_ENVIRONMENTS)})`)],
);

// What was notified. The text is built here, never sent through Apple: the
// push carries the id, and the app's extension fetches the text (PUSH-2).
// The dedup key makes each event notify once (PUSH-5). Kept 90 days.
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    dedupKey: text("dedup_key").notNull().unique(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    // Where a tap goes, as the app's link path, e.g. "videos/<id>" (PUSH-4).
    target: text("target").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("notifications_created_idx").on(t.createdAt),
    check("notifications_kind_chk", sql`${t.kind} in (${inList(NOTIFICATION_KINDS)})`),
  ],
);

// Each phone's latest place, for "Time to leave" (intent 0027, TRFSEC-1):
// one row, overwritten by each report, rounded to about 100 m, deleted after
// 24 hours or when the phone turns the kind off. Never logged.
export const deviceLocations = pgTable("device_locations", {
  deviceId: uuid("device_id")
    .primaryKey()
    .references(() => devices.id, { onDelete: "cascade" }),
  lat: doublePrecision("lat").notNull(),
  lng: doublePrecision("lng").notNull(),
  accuracyM: integer("accuracy_m"),
  reportedAt: ts("reported_at").notNull().defaultNow(),
});

// What "Time to leave" decided for one phone and one event (TRF-P1..P5):
// the origin and drive time behind the leave-by push, so the later pushes
// can tell traffic got worse or the phone hasn't moved. Deleted with the
// device or the event; rows for past events are pruned by the job.
export const leaveAlerts = pgTable(
  "leave_alerts",
  {
    deviceId: uuid("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    startUtc: ts("start_utc").notNull(),
    // The last route asked for (TRF-R3) and what it said.
    routedAt: ts("routed_at"),
    driveMinutes: integer("drive_minutes"),
    failures: integer("failures").notNull().default(0),
    // The origin of the leave-by push (TRF-P3, TRF-P4), rounded like the
    // device's place.
    originLat: doublePrecision("origin_lat"),
    originLng: doublePrecision("origin_lng"),
    // Leave-by when the first push went, and which pushes went:
    // "leave_by", "worse", "late" (at most three, TRF-P5).
    leaveBy: ts("leave_by"),
    sent: text("sent")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
  },
  (t) => [primaryKey({ columns: [t.deviceId, t.eventId] }), index("leave_alerts_start_idx").on(t.startUtc)],
);
