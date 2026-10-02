import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normaliseSchoolDates, parseKeyDates } from "@/adapters/school-dates";
import type { AdapterContext } from "@/adapters/types";
import { SCHOOL_DATE_RULES } from "@/domain/categories";
import { closureDates } from "@/domain/clashes";

// A school's public key dates page (SCH-2, CAL-7): hand-built fixture with
// the real page's markup and a made-up school.

const html = readFileSync("tests/fixtures/school-dates/key-dates.html", "utf8");
const ctx = (config: Record<string, unknown> = {}): AdapterContext => ({
  source: {
    id: "s",
    name: "School dates",
    config: { pageUrl: "https://school.example.test/calendar", ...config },
    mapping: { default: "school_class", rules: SCHOOL_DATE_RULES },
  },
  credential: null,
  now: new Date("2030-09-01T00:00:00Z"),
  homeTimeZone: "America/Toronto",
});

describe("parseKeyDates", () => {
  const parsed = parseKeyDates(html);

  it("reads the school year and every dated item, with end dates exclusive", () => {
    expect(parsed.schoolYear).toEqual([2030, 2031]);
    expect(parsed.dates).toHaveLength(11);
    expect(parsed.dates[0]).toEqual({
      start: "2030-09-03",
      end: "2030-09-04",
      title: "First Day of Classes",
    });
    // Autumn months are the first year, the rest the second.
    expect(parsed.dates.find((d) => d.title.startsWith("Winter"))).toMatchObject({
      start: "2030-12-23",
      end: "2031-01-04",
    });
    // Ranges written with or without spaces around the dash.
    expect(parsed.dates.find((d) => d.title.startsWith("Spring"))).toMatchObject({
      start: "2031-03-17",
      end: "2031-03-29",
    });
    expect(parsed.dates.find((d) => d.title === "AP Exams")).toMatchObject({ end: "2031-05-17" });
    expect(parsed.dates[1].title).toBe("National Day for Truth & Reconciliation (School Closed)");
  });

  it("warns about an undated line and a weekday that doesn't match its date", () => {
    expect(parsed.warnings).toEqual([expect.stringContaining("Dates are subject to change")]);
    const wrongYear = html.replace("2030-2031", "2029-2030");
    expect(parseKeyDates(wrongYear).warnings.some((w) => w.includes("check the page's year"))).toBe(true);
  });

  it("says so when the page has no key dates list", () => {
    expect(() => parseKeyDates("<html><h2>Calendar</h2><ul><li>x</li></ul></html>")).toThrow(/Key Dates/);
  });
});

describe("normaliseSchoolDates", () => {
  it("makes all-day school events and closures, linking back to the page (SCH-5)", () => {
    const { records, window } = normaliseSchoolDates(html, ctx());
    const byTitle = (t: string) => records.find((r) => r.title.startsWith(t));
    expect(byTitle("First Day of Classes")).toMatchObject({
      category: "school_class",
      allDay: true,
      startUtc: new Date("2030-09-03T00:00:00Z"),
      endUtc: new Date("2030-09-04T00:00:00Z"),
      sourceUrl: "https://school.example.test/calendar",
      externalId: "2030-09-03:first-day-of-classes",
    });
    for (const t of ["Thanksgiving", "Province-Wide Pro-D", "Winter Break", "Non-Instructional Day (Jr."])
      expect(byTitle(t)?.category).toBe("school_closure");
    expect(byTitle("AP Exams")?.category).toBe("school_class");
    expect(window).toEqual({
      from: new Date("2030-08-01T00:00:00Z"),
      to: new Date("2031-08-01T00:00:00Z"),
    });

    // Closure banners cover every day of a break (CAL-7).
    const closed = closureDates(
      records.map((r, i) => ({
        id: String(i),
        category: r.category,
        attendance: r.attendance,
        owners: ["jayden"],
        allDay: r.allDay,
        start: r.startUtc,
        end: r.endUtc,
        locationId: null,
        locationName: null,
      })),
      "America/Toronto",
    );
    expect(closed.has("2030-12-23")).toBe(true);
    expect(closed.has("2031-01-03")).toBe(true);
    expect(closed.has("2031-01-04")).toBe(false);
  });

  it("leaves out items with the owner's words, e.g. the other campus's days", () => {
    const { records } = normaliseSchoolDates(html, ctx({ exclude: "Sr. School Only, ap exams" }));
    expect(records.map((r) => r.title)).not.toContain("Non-Instructional Day (Sr. School Only)");
    expect(records.map((r) => r.title)).not.toContain("AP Exams");
    expect(records).toHaveLength(9);
  });
});
