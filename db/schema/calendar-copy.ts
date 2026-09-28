// One-way copy of the calendar to a Google Calendar the site creates
// (plan M5.9, spec GCO-1, GCO-2): which Google event each hub event
// became, and a hash of what was sent, so a run only writes changes.
import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { events } from "./events";

export const calendarCopyEvents = pgTable("calendar_copy_events", {
  eventId: uuid("event_id")
    .primaryKey()
    .references(() => events.id, { onDelete: "cascade" }),
  // The copy calendar it was written to; a new calendar starts over.
  calendarId: text("calendar_id").notNull(),
  googleEventId: text("google_event_id").notNull(),
  hash: text("hash").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
