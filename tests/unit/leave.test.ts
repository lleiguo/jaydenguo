import { describe, expect, it } from "vitest";
import { decide, distanceM, leaveByOf, minutesLate, routeDue, type Situation } from "@/domain/leave";
import { candidates, leaveText, originFor } from "@/server/leave/check";
import { googleRoutes } from "@/server/traffic/routes";
import type { EventView } from "@/lib/calendar-types";

// "Time to leave" (intent 0027): leave-by maths, when to route, which push.

const at = (hhmm: string) => new Date(`2026-10-28T${hhmm}:00Z`);
const HOME = { lat: 43.65, lng: -79.38 };
const AWAY = { lat: 43.7, lng: -79.4 }; // ~5.8 km from HOME
const FIELD = { lat: 43.72, lng: -79.45 };

const base: Situation = {
  now: at("15:20"),
  start: at("16:00"),
  driveMinutes: 25,
  sent: [],
  firstLeaveBy: null,
  origin: null,
  place: null,
  destination: null,
};

describe("leave-by maths (TRF-P1)", () => {
  it("counts the drive and 5 minutes to park", () => {
    expect(leaveByOf(at("16:00"), 25)).toEqual(at("15:30"));
    expect(minutesLate(at("15:40"), at("16:00"), 25)).toBe(10);
    expect(minutesLate(at("15:20"), at("16:00"), 25)).toBe(1);
  });
  it("measures metres", () => {
    expect(distanceM(HOME, HOME)).toBe(0);
    expect(distanceM(HOME, { lat: 43.652, lng: -79.38 })).toBeGreaterThan(200);
    expect(distanceM(HOME, { lat: 43.652, lng: -79.38 })).toBeLessThan(250);
  });
});

describe("routes due (TRF-R3)", () => {
  it("routes first, then every 30 min, every 10 near leave-by", () => {
    expect(routeDue({ now: at("14:00"), routedAt: null, leaveBy: null })).toBe(true);
    expect(routeDue({ now: at("14:20"), routedAt: at("14:00"), leaveBy: at("15:30") })).toBe(false);
    expect(routeDue({ now: at("14:30"), routedAt: at("14:00"), leaveBy: at("15:30") })).toBe(true);
    expect(routeDue({ now: at("14:55"), routedAt: at("14:45"), leaveBy: at("15:30") })).toBe(true);
    expect(routeDue({ now: at("14:54"), routedAt: at("14:45"), leaveBy: at("15:30") })).toBe(false);
  });
  it("stays within the budget: 3 events a day for 30 days under 1,500 calls", () => {
    let calls = 0;
    for (let day = 0; day < 30; day++)
      for (const start of [at("09:00"), at("13:00"), at("17:00")]) {
        const s = new Date(start.getTime() + day * 86_400_000);
        let routedAt: Date | null = null;
        for (let t = s.getTime() - 2 * 3_600_000; t < s.getTime(); t += 5 * 60_000) {
          const now = new Date(t);
          if (routeDue({ now, routedAt, leaveBy: routedAt ? leaveByOf(s, 25) : null })) {
            calls++;
            routedAt = now;
          }
        }
      }
    expect(calls).toBeLessThan(1500);
  });
});

describe("which push (TRF-P1..P5)", () => {
  it("leave-by 10 minutes before, not earlier, not after the start", () => {
    expect(decide({ ...base, now: at("15:19") })).toBeNull();
    expect(decide(base)).toBe("leave_by");
    expect(decide({ ...base, now: at("16:00") })).toBeNull();
    expect(decide({ ...base, driveMinutes: null })).toBeNull();
  });
  const afterP1: Situation = {
    ...base,
    sent: ["leave_by"],
    firstLeaveBy: at("15:30"),
    origin: HOME,
    place: HOME,
    destination: FIELD,
  };
  it("traffic got worse: leave-by 10+ min earlier, once", () => {
    expect(decide({ ...afterP1, now: at("15:15"), driveMinutes: 34 })).toBeNull();
    expect(decide({ ...afterP1, now: at("15:15"), driveMinutes: 35 })).toBe("worse");
    expect(
      decide({ ...afterP1, now: at("15:15"), driveMinutes: 40, sent: ["leave_by", "worse"] }),
    ).toBeNull();
  });
  it("running late: past leave-by, still at the origin, arriving after the start", () => {
    expect(decide({ ...afterP1, now: at("15:29") })).toBeNull();
    expect(decide({ ...afterP1, now: at("15:31") })).toBe("late");
    expect(decide({ ...afterP1, now: at("15:31"), sent: ["leave_by", "late"] })).toBeNull();
    // No fresh place: no running-late push.
    expect(decide({ ...afterP1, now: at("15:31"), place: null })).toBeNull();
  });
  it("quiet once on the way or there", () => {
    expect(decide({ ...afterP1, now: at("15:31"), place: AWAY })).toBeNull();
    expect(decide({ ...afterP1, now: at("15:31"), driveMinutes: 40, place: AWAY })).toBeNull();
    expect(decide({ ...afterP1, now: at("15:31"), origin: FIELD, place: FIELD })).toBeNull();
  });
  it("at most three", () => {
    expect(decide({ ...afterP1, now: at("15:31"), sent: ["leave_by", "worse", "late"] })).toBeNull();
  });
});

const ev = (over: Partial<EventView>): EventView =>
  ({
    id: "e1",
    title: "Tennis",
    category: "tennis",
    attendance: "required",
    owners: ["p1"],
    start: at("16:00").toISOString(),
    end: at("17:00").toISOString(),
    allDay: false,
    status: "active",
    deletedAt: null,
    notes: null,
    locationName: "Bayview Tennis Club, Toronto",
    sourceUrl: null,
    source: null,
    seriesId: null,
    lastSyncedAt: null,
    override: null,
    schoolClosed: false,
    ...over,
  }) as EventView;

describe("which events (TRF-E1..E3)", () => {
  it("timed, active, required, with a place, in the next two hours, not school", () => {
    const now = at("15:00");
    const keep = ev({});
    const out = [
      ev({ id: "allday", allDay: true }),
      ev({ id: "optional", attendance: "optional" }),
      ev({ id: "school", category: "school_class" as EventView["category"] }),
      ev({ id: "noplace", locationName: " " }),
      ev({ id: "far", start: at("17:30").toISOString() }),
      ev({ id: "past", start: at("14:59").toISOString() }),
      ev({ id: "cancelled", status: "cancelled" }),
      ev({ id: "skipped", override: { skip: true } as EventView["override"] }),
    ];
    expect(candidates([...out, keep], now).map((e) => e.id)).toEqual(["e1"]);
  });
  it("starts from the previous event while it's on, else the phone, else home", () => {
    const event = ev({ start: at("17:30").toISOString() });
    const before = ev({ id: "swim", end: at("16:45").toISOString(), locationName: "Pool" });
    expect(originFor({ event, others: [before], now: at("16:30"), place: HOME, home: "1 Home St" })).toEqual({
      address: "Pool",
    });
    expect(originFor({ event, others: [before], now: at("16:50"), place: HOME, home: "1 Home St" })).toEqual(
      HOME,
    );
    expect(originFor({ event, others: [], now: at("16:50"), place: null, home: "1 Home St" })).toEqual({
      address: "1 Home St",
    });
    expect(originFor({ event, others: [], now: at("16:50"), place: null, home: null })).toBeNull();
  });
});

describe("push text", () => {
  const event = ev({});
  it("says when to leave, the place and the drive", () => {
    const t = leaveText({ step: "leave_by", event, now: at("15:20"), driveMinutes: 25, tz: "UTC" });
    expect(t).toEqual({
      title: "Leave by 3:30 for Tennis",
      body: "Bayview Tennis Club, Toronto: 25 min with traffic.",
    });
    expect(leaveText({ step: "late", event, now: at("15:40"), driveMinutes: 25, tz: "UTC" })).toEqual({
      title: "Leave now for Tennis",
      body: "You'll get there at 4:10, 10 min late (25 min with traffic).",
    });
    expect(leaveText({ step: "worse", event, now: at("15:22"), driveMinutes: 35, tz: "UTC" }).title).toBe(
      "Leave now for Tennis",
    );
    expect(leaveText({ step: "worse", event, now: at("15:10"), driveMinutes: 35, tz: "UTC" }).body).toBe(
      "Traffic is heavier: 35 min with traffic to Bayview Tennis Club, Toronto.",
    );
  });
});

describe("Routes client (TRF-R1)", () => {
  type Body = { origin: unknown; destination: unknown; travelMode: string; routingPreference: string };
  it("asks for a traffic-aware drive and reads minutes and ends", async () => {
    const bodies: Body[] = [];
    const request = async () => async (body: unknown) => {
      bodies.push(body as Body);
      return {
        status: 200,
        data: {
          routes: [
            {
              duration: "1532s",
              legs: [
                {
                  startLocation: { latLng: { latitude: 43.65, longitude: -79.38 } },
                  endLocation: { latLng: { latitude: 43.72, longitude: -79.45 } },
                },
              ],
            },
          ],
        },
      };
    };
    const route = await googleRoutes(request)(HOME, { address: "Bayview Tennis Club" });
    expect(route).toEqual({ minutes: 26, start: HOME, end: FIELD });
    expect(bodies[0]).toMatchObject({ travelMode: "DRIVE", routingPreference: "TRAFFIC_AWARE" });
    expect(bodies[0].origin).toEqual({ location: { latLng: { latitude: 43.65, longitude: -79.38 } } });
    expect(bodies[0].destination).toEqual({ address: "Bayview Tennis Club" });
  });
  it("null when there's no route or the address isn't found; throws on other errors", async () => {
    const answer = (status: number, data: unknown) => async () => async () => ({ status, data });
    expect(await googleRoutes(answer(200, {}))(HOME, HOME)).toBeNull();
    expect(await googleRoutes(answer(400, {}))(HOME, HOME)).toBeNull();
    await expect(googleRoutes(answer(503, {}))(HOME, HOME)).rejects.toThrow("Routes API 503");
  });
});
