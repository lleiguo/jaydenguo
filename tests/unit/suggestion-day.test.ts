import { describe, expect, it } from "vitest";
import { isPastSuggestion, suggestionDay } from "@/server/email/suggestions";

// Intent 0011, TID-1: a suggestion about a day before today is cleared.
describe("suggestion day", () => {
  const tz = "America/Toronto";
  const timed = { startUtc: new Date("2026-10-03T02:30:00Z"), allDay: false };

  it("uses its own date first", () => {
    expect(suggestionDay({ date: "2026-10-09" }, timed, tz)).toBe("2026-10-09");
  });

  it("else the home-zone day of the event it's about", () => {
    // 02:30 UTC on the 3rd is 22:30 on the 2nd in Toronto.
    expect(suggestionDay({ date: null }, timed, tz)).toBe("2026-10-02");
    const allDay = { startUtc: new Date("2026-10-03T00:00:00Z"), allDay: true };
    expect(suggestionDay({ date: null }, allDay, tz)).toBe("2026-10-03");
  });

  it("has no day with neither", () => {
    expect(suggestionDay({ date: null }, null, tz)).toBeNull();
  });

  it("is past only before today", () => {
    expect(isPastSuggestion("2026-10-02", "2026-10-03")).toBe(true);
    expect(isPastSuggestion("2026-10-03", "2026-10-03")).toBe(false);
    expect(isPastSuggestion(null, "2026-10-03")).toBe(false);
  });
});
