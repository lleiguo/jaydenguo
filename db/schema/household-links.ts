// Two-way sync with the household Google Calendar (intent 0020): which
// Google event in Household each hub item is, and a hash of what was last
// written, so a run only writes changes and recognises its own events when
// it reads Household back (DUP2-1).
import { pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { sources } from "./core";

export const householdLinks = pgTable(
  "household_links",
  {
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    // A hub event's ID, or `school:<date>:<owners>` for a school day
    // (TWO-5). Not a foreign key: a deleted hub event keeps its row until
    // the Google event is deleted too.
    hubKey: text("hub_key").notNull(),
    googleEventId: text("google_event_id").notNull(),
    // `hub`: the hub created it. `twin`: a hand-made household event linked
    // to a feed's (DUP2-2); unlinking leaves it in Google.
    origin: text("origin").notNull(),
    hash: text("hash").notNull(),
    // Google's `updated` when last read or written (BACK-5).
    googleUpdatedAt: timestamp("google_updated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.sourceId, t.hubKey] }), unique().on(t.sourceId, t.googleEventId)],
);
