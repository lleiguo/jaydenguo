import { describe, expect, it } from "vitest";
import { expandSeries, type SeriesRule } from "@/domain/series";
import { wallClock } from "@/domain/time";

const rule: SeriesRule = {
  title: "Chinese class",
  category: "chinese",
  notes: null,
  locationName: null,
  attendance: "required",
  allDay: false,
  startDate: "2026-10-03", // a Saturday
  untilDate: "2026-11-30",
  startTime: "10:00",
  durationMin: 90,
  timeZone: "America/Toronto",
  intervalWeeks: 1,
  weekdays: [6],
};

describe("expandSeries (CAL-5)", () => {
  it("repeats weekly on the chosen day until the end date, at the same local time across DST", () => {
    const occ = expandSeries(rule, "2026-10-01");
    expect(occ.map((o) => o.externalId)).toEqual([
      "2026-10-03",
      "2026-10-10",
      "2026-10-17",
      "2026-10-24",
      "2026-10-31",
      "2026-11-07",
      "2026-11-14",
      "2026-11-21",
      "2026-11-28",
    ]);
    for (const o of occ) expect(wallClock(o.startUtc, "America/Toronto").hour).toBe(10);
    expect(occ[0].endUtc.getTime() - occ[0].startUtc.getTime()).toBe(90 * 60_000);
  });

  it("supports every N weeks and several weekdays", () => {
    const occ = expandSeries(
      { ...rule, intervalWeeks: 2, weekdays: [2, 4], untilDate: "2026-10-31" },
      "2026-10-01",
    );
    // Weeks of Sep 27 and Oct 11 and Oct 25: Tue/Thu, from Oct 3 on.
    expect(occ.map((o) => o.externalId)).toEqual(["2026-10-13", "2026-10-15", "2026-10-27", "2026-10-29"]);
  });

  it("stops at the horizon when there is no end date", () => {
    const occ = expandSeries({ ...rule, untilDate: null }, "2026-10-01");
    expect(occ.at(-1)!.externalId <= "2028-10-01").toBe(true);
    expect(occ.length).toBeGreaterThan(100);
  });
});
