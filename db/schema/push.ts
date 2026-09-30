// Push notifications for the iPhone app (intent 0004, PUSH-1..6, plan N7).
import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { APNS_ENVIRONMENTS, NOTIFICATION_KINDS } from "../../src/domain/notifications";
import { sessions } from "./auth";

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
