import { lt, sql } from "drizzle-orm";
import { rateLimits } from "@db/schema";
import type { Db } from "../db/client";

// Fixed-window counter in Postgres, shared by every web instance (NFR-2:
// rate limiting on login). Returns true while the caller is under the limit.
export async function hit(db: Db, key: string, limit: number, windowMs: number): Promise<boolean> {
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
  const [row] = await db
    .insert(rateLimits)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimits.key, rateLimits.windowStart],
      set: { count: sql`${rateLimits.count} + 1` },
    })
    .returning({ count: rateLimits.count });
  if (Math.random() < 0.05) {
    await db.delete(rateLimits).where(lt(rateLimits.windowStart, new Date(Date.now() - 24 * 3600_000)));
  }
  return row.count <= limit;
}

// Sign-in attempts: per client address, plus a global cap as a backstop.
export async function allowLoginAttempt(db: Db, clientIp: string): Promise<boolean> {
  const window = 10 * 60_000;
  const perIp = await hit(db, `login:ip:${clientIp}`, 10, window);
  const global = await hit(db, "login:all", 50, window);
  return perIp && global;
}

// Firebase Hosting and Cloud Run append to X-Forwarded-For; the first entry
// is the browser's address.
export function clientIp(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}
