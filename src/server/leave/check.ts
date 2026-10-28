import { and, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { deviceLocations, devices, leaveAlerts, sessions } from "@db/schema";
import {
  decide,
  FRESH_MS,
  leaveByOf,
  MAX_FAILURES,
  MAX_PUSHES,
  minutesLate,
  PARK_MIN,
  routeDue,
  WINDOW_MS,
  type Point,
  type Step,
} from "../../domain/leave";
import type { EventView } from "../../lib/calendar-types";
import { loadCalendar } from "../calendar/load";
import type { DbOrTx } from "../db/client";
import { createLogger, type Logger } from "../log";
import { pruneLocations } from "../push/location";
import { notify, type NotifyDeps } from "../push/notify";
import { getHomeAddress } from "../settings";
import type { Place, RouteFn } from "../traffic/routes";

// The "Time to leave" job (intent 0027, TRF-E, TRF-R, TRF-P): every few
// minutes, for each phone with the kind on and each event it covers in the
// next two hours, ask for a traffic route when one is due and send the
// push the situation calls for. Logs carry ids and minutes only, never a
// place or an address (TRFSEC-2).

const SCHOOL = new Set(["school_class", "school_closure"]);

// TRF-E1: timed, active, required, not school, starting within the window,
// with a place (TRF-E2).
export function candidates(events: EventView[], now: Date): EventView[] {
  const until = now.getTime() + WINDOW_MS;
  return events
    .filter((e) => {
      const start = new Date(e.start).getTime();
      return (
        !e.allDay &&
        e.status === "active" &&
        !e.deletedAt &&
        !e.override?.skip &&
        e.attendance === "required" &&
        !SCHOOL.has(e.category) &&
        !!e.locationName?.trim() &&
        start > now.getTime() &&
        start <= until
      );
    })
    .sort((a, b) => a.start.localeCompare(b.start));
}

const covers = (people: string[], e: EventView) => !people.length || e.owners.some((o) => people.includes(o));

// TRF-E3, TRF-R2: from the previous event's place while it's still on
// and ends within two hours of this one; else the phone's fresh place;
// else home.
export function originFor(a: {
  event: EventView;
  others: EventView[];
  now: Date;
  place: Point | null;
  home: string | null;
}): Place | null {
  const start = new Date(a.event.start).getTime();
  const before = a.others
    .filter((o) => {
      const end = new Date(o.end).getTime();
      return o.id !== a.event.id && end <= start && end > start - WINDOW_MS && end > a.now.getTime();
    })
    .sort((x, y) => y.end.localeCompare(x.end))[0];
  if (before?.locationName?.trim()) return { address: before.locationName.trim() };
  if (a.place) return a.place;
  return a.home ? { address: a.home } : null;
}

export function timeLabel(d: Date, tz: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(d)
    .replace(/\s?[ap]\.?m\.?/i, "");
}

// The push text (TRF-P1..P3).
export function leaveText(a: { step: Step; event: EventView; now: Date; driveMinutes: number; tz: string }): {
  title: string;
  body: string;
} {
  const start = new Date(a.event.start);
  const leaveBy = leaveByOf(start, a.driveMinutes);
  const place = a.event.locationName?.trim() ?? "";
  const drive = `${a.driveMinutes} min with traffic`;
  if (a.step === "late") {
    const late = minutesLate(a.now, start, a.driveMinutes);
    const arrive = new Date(a.now.getTime() + (a.driveMinutes + PARK_MIN) * 60_000);
    return {
      title: `Leave now for ${a.event.title}`,
      body: `You'll get there at ${timeLabel(arrive, a.tz)}, ${late} min late (${drive}).`,
    };
  }
  const when = leaveBy > a.now ? `Leave by ${timeLabel(leaveBy, a.tz)}` : "Leave now";
  if (a.step === "worse")
    return { title: `${when} for ${a.event.title}`, body: `Traffic is heavier: ${drive} to ${place}.` };
  return { title: `${when} for ${a.event.title}`, body: `${place}: ${drive}.` };
}

export type LeaveDeps = NotifyDeps & { routes: RouteFn };

export async function checkLeave(db: DbOrTx, deps: LeaveDeps) {
  const log: Logger = deps.log ?? createLogger();
  const now = deps.now ?? new Date();
  await pruneLocations(db, now);
  await db.delete(leaveAlerts).where(lt(leaveAlerts.startUtc, new Date(now.getTime() - 86_400_000)));

  const phones = await db
    .select({ id: devices.id, people: devices.leavePeople, place: deviceLocations })
    .from(devices)
    .innerJoin(sessions, eq(sessions.id, devices.sessionId))
    .leftJoin(deviceLocations, eq(deviceLocations.deviceId, devices.id))
    .where(
      and(sql`'leave' = any(${devices.kinds})`, isNull(sessions.revokedAt), gt(sessions.expiresAt, now)),
    );
  if (!phones.length) return { phones: 0, routes: 0, sent: 0 };

  // Events on now..+2h, plus the two hours before for TRF-E3.
  const cal = await loadCalendar(
    db,
    new Date(now.getTime() - WINDOW_MS),
    new Date(now.getTime() + WINDOW_MS),
  );
  const upcoming = candidates(cal.events, now);
  const home = await getHomeAddress(db);
  let routes = 0;
  let sent = 0;

  for (const phone of phones) {
    const fresh =
      phone.place && now.getTime() - phone.place.reportedAt.getTime() <= FRESH_MS
        ? { lat: phone.place.lat, lng: phone.place.lng }
        : null;
    const mine = cal.events.filter((e) => covers(phone.people, e));
    for (const event of upcoming.filter((e) => covers(phone.people, e))) {
      const start = new Date(event.start);
      await db
        .insert(leaveAlerts)
        .values({ deviceId: phone.id, eventId: event.id, startUtc: start })
        .onConflictDoUpdate({
          target: [leaveAlerts.deviceId, leaveAlerts.eventId],
          set: { startUtc: start },
        });
      const [state] = await db
        .select()
        .from(leaveAlerts)
        .where(and(eq(leaveAlerts.deviceId, phone.id), eq(leaveAlerts.eventId, event.id)));
      if (state.failures >= MAX_FAILURES || state.sent.length >= MAX_PUSHES) continue;

      let driveMinutes = state.driveMinutes;
      let destination: Point | null = null;
      const lastLeaveBy = driveMinutes === null ? null : leaveByOf(start, driveMinutes);
      if (routeDue({ now, routedAt: state.routedAt, leaveBy: lastLeaveBy })) {
        const origin = originFor({ event, others: mine, now, place: fresh, home });
        if (!origin) continue;
        routes++;
        try {
          const route = await deps.routes(origin, { address: event.locationName!.trim() });
          if (!route) {
            // TRF-E2: logged once, then left alone.
            log("leave: no route", { event: event.id });
            await db
              .update(leaveAlerts)
              .set({ failures: MAX_FAILURES, routedAt: now })
              .where(and(eq(leaveAlerts.deviceId, phone.id), eq(leaveAlerts.eventId, event.id)));
            continue;
          }
          driveMinutes = route.minutes;
          destination = route.end;
          // Until the leave-by push goes, the origin follows the latest
          // route: the phone's place, else where the route began. Then it
          // stays, for "still there" (TRF-P3, TRF-P4).
          const from = fresh ?? route.start;
          await db
            .update(leaveAlerts)
            .set({
              routedAt: now,
              driveMinutes,
              failures: 0,
              ...(state.sent.includes("leave_by")
                ? {}
                : { originLat: from?.lat ?? null, originLng: from?.lng ?? null }),
            })
            .where(and(eq(leaveAlerts.deviceId, phone.id), eq(leaveAlerts.eventId, event.id)));
        } catch (err) {
          // TRF-R4: skip this run; give up quietly after three in a row.
          const failures = state.failures + 1;
          await db
            .update(leaveAlerts)
            .set({ failures, routedAt: now })
            .where(and(eq(leaveAlerts.deviceId, phone.id), eq(leaveAlerts.eventId, event.id)));
          if (failures >= MAX_FAILURES)
            log("leave: route failed", { event: event.id, error: String(err) }, "WARNING");
          continue;
        }
      }

      const [after] = await db
        .select({ lat: leaveAlerts.originLat, lng: leaveAlerts.originLng })
        .from(leaveAlerts)
        .where(and(eq(leaveAlerts.deviceId, phone.id), eq(leaveAlerts.eventId, event.id)));
      const origin = after.lat !== null && after.lng !== null ? { lat: after.lat, lng: after.lng } : null;
      const step = decide({
        now,
        start,
        driveMinutes,
        sent: state.sent,
        firstLeaveBy: state.leaveBy,
        origin,
        place: fresh,
        destination,
      });
      if (!step || driveMinutes === null) continue;
      const text = leaveText({ step, event, now, driveMinutes, tz: cal.homeTimeZone });
      const id = await notify(
        db,
        {
          kind: "leave",
          dedupKey: `leave:${phone.id}:${event.id}:${step}`,
          target: `events/${event.id}`,
          ...text,
        },
        { ...deps, log, now, deviceId: phone.id },
      );
      if (!id) continue;
      sent++;
      await db
        .update(leaveAlerts)
        .set({
          sent: [...state.sent, step],
          ...(step === "leave_by" ? { leaveBy: leaveByOf(start, driveMinutes) } : {}),
        })
        .where(and(eq(leaveAlerts.deviceId, phone.id), eq(leaveAlerts.eventId, event.id)));
      log("leave: sent", { event: event.id, step, minutes: driveMinutes });
    }
  }
  return { phones: phones.length, routes, sent };
}
