import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import type { AdapterContext } from "@/adapters/types";
import { portalFrom, schoolDays } from "@/adapters/veracross";
import { normaliseVeracross } from "@/adapters/veracross/normalise";
import { parseDailySchedule, to24h } from "@/adapters/veracross/parse";

// Veracross Daily Schedule (SCH-1): hand-built fixture with the real page's
// markup and made-up names.

const html = readFileSync("tests/fixtures/veracross/daily-schedule.html", "utf8");
const tz = "America/Vancouver";
const ctx: AdapterContext = {
  source: { id: "s", name: "School", config: {}, mapping: { default: "school_class" } },
  credential: null,
  now: new Date("2030-09-09T15:00:00Z"),
  homeTimeZone: tz,
};

describe("parseDailySchedule", () => {
  const day = parseDailySchedule(html, "2030-09-09");

  it("reads each period's start, class, teachers and room, and the rotation day", () => {
    expect(day.rotation).toBe("Day 1");
    expect(day.periods).toHaveLength(7);
    expect(day.periods[0]).toEqual({
      start: "08:30",
      description: "Homeroom 4X",
      teachers: ["Alex Sample", "Robin Example"],
      room: "R101",
      block: false,
    });
    expect(day.periods[2]).toMatchObject({
      start: "09:30",
      description: "Recess 4-7",
      block: true,
      room: null,
    });
    expect(day.periods[5]).toMatchObject({ start: "12:45", description: "French 4X", room: "R204" });
  });

  it("refuses a page that isn't a Daily Schedule", () => {
    expect(() =>
      parseDailySchedule("<html><form><input type=password></form></html>", "2030-09-09"),
    ).toThrow();
  });

  it("reads 12-hour times", () => {
    expect(to24h("12:00 pm")).toBe("12:00");
    expect(to24h("12:15 am")).toBe("00:15");
    expect(to24h("1:30 PM")).toBe("13:30");
    expect(to24h("soon")).toBeNull();
  });
});

describe("normaliseVeracross", () => {
  const day = parseDailySchedule(html, "2030-09-09");
  const empty = { date: "2030-09-10", rotation: null, periods: [] };
  const raw = { scheduleUrl: "https://portal.example.test/s/1/daily-schedule", days: [day, empty] };
  const { records, window, warnings } = normaliseVeracross(raw, ctx);

  it("makes timed school classes that end when the next period starts", () => {
    expect(records).toHaveLength(7);
    expect(records[0]).toMatchObject({
      category: "school_class",
      title: "Homeroom 4X",
      locationName: "R101",
      notes: "With Alex Sample, Robin Example",
      allDay: false,
      // 8:30 in Vancouver (PDT).
      startUtc: new Date("2030-09-09T15:30:00Z"),
      endUtc: new Date("2030-09-09T15:45:00Z"),
      sourceUrl: "https://portal.example.test/s/1/daily-schedule?date=2030-09-09",
      externalId: "2030-09-09T08:30:homeroom-4x",
    });
  });

  it("gives the last period the day's most common length", () => {
    // Gaps: 15, 45, 20, 130 (too long to count), 45, 45 → 45 minutes.
    const last = records.at(-1)!;
    expect((last.endUtc.getTime() - last.startUtc.getTime()) / 60_000).toBe(45);
  });

  it("covers every day read, so a day that loses its classes cancels them", () => {
    expect(window).toEqual({
      from: new Date("2030-09-09T07:00:00Z"),
      to: new Date("2030-09-11T07:00:00Z"),
    });
    expect(warnings).toEqual([]);
    expect(normaliseVeracross({ ...raw, days: [empty] }, ctx).warnings).toEqual([
      "No classes were found in the next two weeks.",
    ]);
  });
});

describe("schoolDays and portalFrom", () => {
  afterEach(() => {
    delete process.env.VERACROSS_BASE_URL;
  });

  it("lists weekdays for two weeks from today in the home time zone", () => {
    // Monday 2030-09-09, 8 am in Vancouver.
    const days = schoolDays(new Date("2030-09-09T15:00:00Z"), tz);
    expect(days).toHaveLength(10);
    expect(days[0]).toBe("2030-09-09");
    expect(days).not.toContain("2030-09-14");
  });

  it("accepts only a Veracross parent portal link", () => {
    expect(portalFrom("https://portals.veracross.com/example/parent")).toBe(
      "https://portals.veracross.com/example/parent",
    );
    expect(portalFrom("https://portals.veracross.com/example/parent/student/1/daily-schedule")).toBe(
      "https://portals.veracross.com/example/parent",
    );
    expect(portalFrom("https://evil.example.test/example/parent")).toBeNull();
    expect(portalFrom("http://portals.veracross.com/example/parent")).toBeNull();
    expect(portalFrom("not a link")).toBeNull();
  });

  it("sends tests to a loopback fake only", () => {
    process.env.VERACROSS_BASE_URL = "http://127.0.0.1:4999";
    expect(portalFrom("https://portals.veracross.com/example/parent")).toBe(
      "http://127.0.0.1:4999/example/parent",
    );
    process.env.VERACROSS_BASE_URL = "https://elsewhere.example.test";
    expect(() => portalFrom("https://portals.veracross.com/example/parent")).toThrow(/loopback/);
  });
});
