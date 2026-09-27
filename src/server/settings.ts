import { eq } from "drizzle-orm";
import { settings } from "@db/schema";
import { isValidTimeZone } from "../domain/time";
import type { DbOrTx } from "./db/client";

// The home time zone (CAL-9, O-4). Stored as a setting; the first default
// comes from HOME_TIME_ZONE (set by Terraform), then Toronto.
export async function getHomeTimeZone(db: DbOrTx): Promise<string> {
  const [row] = await db.select().from(settings).where(eq(settings.key, "home_time_zone"));
  const value = typeof row?.value === "string" ? row.value : process.env.HOME_TIME_ZONE;
  return value && isValidTimeZone(value) ? value : "America/Toronto";
}

export async function setHomeTimeZone(db: DbOrTx, tz: string) {
  if (!isValidTimeZone(tz)) throw new Error("unknown time zone");
  await db
    .insert(settings)
    .values({ key: "home_time_zone", value: tz })
    .onConflictDoUpdate({ target: settings.key, set: { value: tz, updatedAt: new Date() } });
}
