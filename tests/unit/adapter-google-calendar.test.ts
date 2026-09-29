import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normaliseGoogle, type GoogleCalendarRaw } from "@/adapters/google-calendar";
import type { AdapterContext } from "@/adapters/types";
import { HOUSEHOLD_RULES } from "@/domain/categories";

const raw = JSON.parse(
  readFileSync("tests/fixtures/google-calendar/events.json", "utf8"),
) as GoogleCalendarRaw;
const ctx: AdapterContext = {
  source: {
    id: "s",
    name: "Household",
    config: { calendarId: "family" },
    mapping: { default: "other", rules: HOUSEHOLD_RULES },
  },
  credential: null,
  now: new Date("2026-10-01T00:00:00Z"),
  homeTimeZone: "America/Toronto",
};

describe("Google Calendar adapter (SRC-1)", () => {
  const { records, window } = normaliseGoogle(raw, ctx);
  const byId = (id: string) => records.find((r) => r.externalId === id);

  it("maps timed events to UTC and categorises by title", () => {
    expect(byId("abc123_20261005T220000Z")).toMatchObject({
      title: "Math class",
      category: "math",
      attendance: "required",
      startUtc: new Date("2026-10-05T22:00:00Z"),
      endUtc: new Date("2026-10-05T23:00:00Z"),
      locationName: "Learning Centre, 100 Example St",
      sourceUrl: "https://www.google.com/calendar/event?eid=example1",
    });
    expect(byId("def456")).toMatchObject({ category: "swimming", attendance: "optional" });
    expect(byId("jkl012")).toMatchObject({ category: "other", attendance: "required" });
  });

  it("keeps all-day events as dates", () => {
    expect(byId("ghi789")).toMatchObject({
      allDay: true,
      startUtc: new Date("2026-10-10T00:00:00Z"),
      endUtc: new Date("2026-10-13T00:00:00Z"),
    });
  });

  it("drops cancelled events and reports the window it asked for", () => {
    expect(byId("gone1")).toBeUndefined();
    expect(records).toHaveLength(4);
    expect(window).toEqual({ from: new Date("2026-09-01T00:00:00Z"), to: new Date("2027-11-05T00:00:00Z") });
  });
});
