import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseIcs } from "@/adapters/ical";
import type { AdapterContext } from "@/adapters/types";
import { wallClock } from "@/domain/time";

const fixture = readFileSync("tests/fixtures/ical/teamsnap-style.ics", "utf8");
const ctx: AdapterContext = {
  source: {
    id: "s",
    name: "Soccer",
    config: {},
    mapping: { default: "soccer", rules: [{ match: "tournament", attendance: "optional" }] },
  },
  credential: null,
  now: new Date("2026-10-01T12:00:00Z"),
  homeTimeZone: "America/Toronto",
};
const tz = "America/Toronto";

describe("iCal adapter (SRC-2/3)", () => {
  const { records, window } = parseIcs(fixture, ctx);
  const byId = (id: string) => records.find((r) => r.externalId === id);

  it("expands weekly practice across the DST change at the same local time", () => {
    const practices = records.filter((r) => r.externalId.startsWith("practice-001"));
    // Oct 20, 27, Nov 3, (10 excluded), 17 moved, 24.
    expect(practices).toHaveLength(5);
    for (const p of practices.filter((p) => p.title === "Practice")) {
      expect(wallClock(p.startUtc, tz).hour).toBe(17);
    }
    expect(practices.find((p) => p.startUtc.toISOString().startsWith("2026-11-10"))).toBeUndefined();
  });

  it("uses the moved time for a changed occurrence, keyed by its original start", () => {
    const moved = byId("practice-001@example.test#2026-11-17T17:00:00")!;
    expect(moved.title).toBe("Practice (moved to 6 pm)");
    expect(wallClock(moved.startUtc, tz).hour).toBe(18);
    expect(moved.locationName).toBe("Maple Park Field 1");
  });

  it("maps fields, category and URL", () => {
    expect(byId("game-042@example.test")).toMatchObject({
      title: "Game vs Red Rockets",
      category: "soccer",
      attendance: "required",
      locationName: "Cedar Grove Park",
      notes: "Arrive 30 minutes early. Wear blue.",
      sourceUrl: "https://example.test/team/games/42",
      startUtc: new Date("2026-10-24T17:00:00Z"),
      allDay: false,
    });
  });

  it("drops cancelled events so the sync marks them cancelled", () => {
    expect(byId("game-043@example.test")).toBeUndefined();
  });

  it("keeps all-day events as dates and applies attendance rules", () => {
    expect(byId("tournament-7@example.test")).toMatchObject({
      allDay: true,
      attendance: "optional",
      startUtc: new Date("2026-11-07T00:00:00Z"),
      endUtc: new Date("2026-11-09T00:00:00Z"),
    });
  });

  it("returns stable IDs: parsing twice gives the same records", () => {
    expect(parseIcs(fixture, ctx).records).toEqual(records);
    expect(window.from).toEqual(new Date("2026-09-01T00:00:00Z"));
  });

  it("rejects something that isn't a calendar", () => {
    expect(() => parseIcs("<html>login</html>", ctx)).toThrow(/couldn't be read/);
  });
});
