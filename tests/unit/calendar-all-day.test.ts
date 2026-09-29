import { describe, expect, it } from "vitest";
import { allDayMove } from "@/components/calendar/all-day";

// A dragged all-day event is saved as UTC midnights of its new dates,
// whatever the home zone (CON-3).
describe("allDayMove", () => {
  it("keeps the calendar's dates", () => {
    expect(
      allDayMove(
        { startStr: "2026-10-01", endStr: "2026-10-02" },
        { startStr: "2026-09-30", endStr: "2026-10-01" },
      ),
    ).toEqual({ start: "2026-10-01T00:00:00.000Z", end: "2026-10-02T00:00:00.000Z" });
  });

  it("keeps a multi-day event's length when the calendar gives no end", () => {
    expect(
      allDayMove({ startStr: "2026-10-05", endStr: "" }, { startStr: "2026-09-30", endStr: "2026-10-03" }),
    ).toEqual({ start: "2026-10-05T00:00:00.000Z", end: "2026-10-08T00:00:00.000Z" });
  });

  it("makes a one-day event without an end", () => {
    expect(
      allDayMove({ startStr: "2026-10-05", endStr: "" }, { startStr: "2026-09-30", endStr: "" }),
    ).toEqual({
      start: "2026-10-05T00:00:00.000Z",
      end: "2026-10-06T00:00:00.000Z",
    });
  });
});
