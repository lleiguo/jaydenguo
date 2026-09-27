import { describe, expect, it } from "vitest";
import { addDays, localDate, wallClock, weekday, zonedToUtc } from "@/domain/time";

const tz = "America/Toronto";

describe("zonedToUtc (CAL-9)", () => {
  it("converts standard and daylight time", () => {
    expect(
      zonedToUtc({ year: 2026, month: 1, day: 15, hour: 17, minute: 0, second: 0 }, tz).toISOString(),
    ).toBe("2026-01-15T22:00:00.000Z");
    expect(
      zonedToUtc({ year: 2026, month: 7, day: 15, hour: 17, minute: 0, second: 0 }, tz).toISOString(),
    ).toBe("2026-07-15T21:00:00.000Z");
  });

  it("keeps a 5 pm class at 5 pm on both sides of the November change", () => {
    const before = zonedToUtc({ year: 2026, month: 10, day: 31, hour: 17, minute: 0, second: 0 }, tz);
    const after = zonedToUtc({ year: 2026, month: 11, day: 7, hour: 17, minute: 0, second: 0 }, tz);
    expect(wallClock(before, tz).hour).toBe(17);
    expect(wallClock(after, tz).hour).toBe(17);
    expect(after.getTime() - before.getTime()).toBe(7 * 86_400_000 + 3_600_000);
  });

  it("handles the spring gap and the fall overlap", () => {
    // 02:30 doesn't exist on 2026-03-08; pushed forward to 03:30 EDT.
    expect(
      zonedToUtc({ year: 2026, month: 3, day: 8, hour: 2, minute: 30, second: 0 }, tz).toISOString(),
    ).toBe("2026-03-08T07:30:00.000Z");
    // 01:30 happens twice on 2026-11-01; the first (EDT) is used.
    expect(
      zonedToUtc({ year: 2026, month: 11, day: 1, hour: 1, minute: 30, second: 0 }, tz).toISOString(),
    ).toBe("2026-11-01T05:30:00.000Z");
  });

  it("date helpers", () => {
    expect(localDate(new Date("2026-01-16T01:00:00Z"), tz)).toBe("2026-01-15");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(weekday("2026-09-27")).toBe(0);
  });
});
