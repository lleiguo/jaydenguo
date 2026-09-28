// Daily cost from the Cloud Billing export (intent 0002, COST-1): one row
// per day (home time zone) and billing service, net of credits, in the
// billing account's currency. Refreshed by the `costs:sync` worker job.
import { date, numeric, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

export const dailyCosts = pgTable(
  "daily_costs",
  {
    day: date("day").notNull(),
    // e.g. "Cloud SQL", "Vertex AI".
    service: text("service").notNull(),
    cost: numeric("cost", { precision: 12, scale: 4, mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.day, t.service] })],
);
