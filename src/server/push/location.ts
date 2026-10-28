import { eq, lt } from "drizzle-orm";
import { z } from "zod";
import { deviceLocations, devices } from "@db/schema";
import type { SessionUser } from "../auth/session";
import type { DbOrTx } from "../db/client";
import { HttpError } from "../errors";

// This phone's latest place, for "Time to leave" (intent 0027, TRF-A2,
// TRFSEC-1..3). The device comes from the session, so a parent only ever
// writes their own phone's row; each report overwrites it.

export const locationInput = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracyM: z.number().int().min(0).max(100_000).optional(),
});

// About 100 m (TRFSEC-1): 3 decimal places of latitude is 111 m.
export const roundPlace = (v: number) => Math.round(v * 1000) / 1000;

// Kept a day (TRFSEC-1).
export const LOCATION_TTL_MS = 24 * 3_600_000;

async function thisDevice(db: DbOrTx, session: SessionUser) {
  if (session.kind !== "device") throw new HttpError(403, "Only the iPhone app shares its place.");
  const [row] = await db
    .select({ id: devices.id, kinds: devices.kinds })
    .from(devices)
    .where(eq(devices.sessionId, session.sessionId));
  if (!row) throw new HttpError(409, "Turn on notifications for this phone first.");
  return row;
}

export async function saveLocation(db: DbOrTx, session: SessionUser, input: z.infer<typeof locationInput>) {
  const device = await thisDevice(db, session);
  if (!device.kinds.includes("leave")) throw new HttpError(409, "Turn on Time to leave first.");
  const row = {
    lat: roundPlace(input.lat),
    lng: roundPlace(input.lng),
    accuracyM: input.accuracyM ?? null,
    reportedAt: new Date(),
  };
  await db
    .insert(deviceLocations)
    .values({ deviceId: device.id, ...row })
    .onConflictDoUpdate({ target: deviceLocations.deviceId, set: row });
  return { saved: true };
}

export async function forgetLocation(db: DbOrTx, session: SessionUser) {
  const device = await thisDevice(db, session);
  await db.delete(deviceLocations).where(eq(deviceLocations.deviceId, device.id));
  return { saved: false };
}

// The job's daily clean-up (TRFSEC-1).
export async function pruneLocations(db: DbOrTx, now = new Date()) {
  const gone = await db
    .delete(deviceLocations)
    .where(lt(deviceLocations.reportedAt, new Date(now.getTime() - LOCATION_TTL_MS)))
    .returning({ id: deviceLocations.deviceId });
  return gone.length;
}
