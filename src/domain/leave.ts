// "Time to leave" (intent 0027, TRF-R3, TRF-P1..P5): when to ask for a
// route and which push, if any, a phone gets for one event. Pure, so the
// job and the tests share it.

// Minutes to park and walk in, counted into leave-by (open question 2).
export const PARK_MIN = 5;
// The leave-by push goes this long before leave-by (open question 2).
export const HEADS_UP_MIN = 10;
// Events further out than this aren't looked at (TRF-E1, TRF-R3).
export const WINDOW_MS = 2 * 3_600_000;
// A phone's place older than this isn't used (TRF-R2).
export const FRESH_MS = 30 * 60_000;
// "Still there" and "arrived" (TRF-P3, TRF-P4).
export const NEAR_M = 300;
// Leave-by moving this much earlier is "traffic got worse" (TRF-P2).
export const WORSE_MIN = 10;
// TRF-P5.
export const MAX_PUSHES = 3;
// TRF-R4: this many failed routes in a row and the event is given up.
export const MAX_FAILURES = 3;

export type Step = "leave_by" | "worse" | "late";
export type Point = { lat: number; lng: number };

const MIN = 60_000;

export function leaveByOf(start: Date, driveMinutes: number): Date {
  return new Date(start.getTime() - (driveMinutes + PARK_MIN) * MIN);
}

// Metres between two points (haversine); plenty for "within 300 m".
export function distanceM(a: Point, b: Point): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

// TRF-R3: every 10 minutes once the leave-by push is near (or the first
// route), every 30 before that. ~6 calls per event per phone.
export function routeDue(a: { now: Date; routedAt: Date | null; leaveBy: Date | null }): boolean {
  if (!a.routedAt) return true;
  const age = a.now.getTime() - a.routedAt.getTime();
  const near = a.leaveBy && a.now.getTime() >= a.leaveBy.getTime() - (HEADS_UP_MIN + 30) * MIN;
  return age >= (near ? 10 : 30) * MIN;
}

export type Situation = {
  now: Date;
  start: Date;
  // The latest route's drive time; null when there's none yet.
  driveMinutes: number | null;
  sent: readonly string[];
  // Leave-by and origin of the leave-by push, once it went.
  firstLeaveBy: Date | null;
  origin: Point | null;
  // The phone's place if fresh (TRF-R2), and the event's, from the route.
  place: Point | null;
  destination: Point | null;
};

// At most one push per run: leave-by first, then running late, then
// traffic got worse.
export function decide(s: Situation): Step | null {
  if (s.driveMinutes === null) return null;
  if (s.now >= s.start || s.sent.length >= MAX_PUSHES) return null;
  const leaveBy = leaveByOf(s.start, s.driveMinutes);
  if (!s.sent.includes("leave_by")) {
    return s.now.getTime() >= leaveBy.getTime() - HEADS_UP_MIN * MIN ? "leave_by" : null;
  }
  // TRF-P4: on the way, or there.
  if (s.place && s.origin && distanceM(s.place, s.origin) > NEAR_M) return null;
  if (s.place && s.destination && distanceM(s.place, s.destination) <= NEAR_M) return null;
  if (!s.sent.includes("late") && s.place && s.origin && s.now >= leaveBy) {
    const arrive = s.now.getTime() + (s.driveMinutes + PARK_MIN) * MIN;
    if (arrive > s.start.getTime()) return "late";
  }
  if (
    !s.sent.includes("worse") &&
    !s.sent.includes("late") &&
    s.firstLeaveBy &&
    leaveBy.getTime() <= s.firstLeaveBy.getTime() - WORSE_MIN * MIN
  )
    return "worse";
  return null;
}

// Minutes late if leaving now (TRF-P3), at least 1.
export function minutesLate(now: Date, start: Date, driveMinutes: number): number {
  const arrive = now.getTime() + (driveMinutes + PARK_MIN) * MIN;
  return Math.max(1, Math.round((arrive - start.getTime()) / MIN));
}
