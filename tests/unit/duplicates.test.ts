import { describe, expect, it } from "vitest";
import { householdDuplicates, type DedupEvent } from "@/domain/duplicates";

const at = (hm: string, day = "2026-10-03") => new Date(`${day}T${hm}:00Z`);
const ev = (
  id: string,
  sourceKind: string | null,
  from: string,
  to: string,
  extra: Partial<DedupEvent> = {},
) =>
  ({
    id,
    sourceKind,
    title: id,
    category: "soccer",
    owners: ["jayden"],
    start: at(from),
    end: at(to),
    allDay: false,
    repeats: false,
    ...extra,
  }) as DedupEvent;

// The household calendar gives way to a dedicated source's copy of the
// same event.
describe("householdDuplicates", () => {
  it("drops a household event that repeats a source's game", () => {
    const got = householdDuplicates([
      ev("h", "google_calendar", "17:00", "18:30"),
      ev("s", "ical", "17:15", "18:30"),
    ]);
    expect([...got]).toEqual(["h"]);
  });

  it("keeps it when the times barely touch", () => {
    const got = householdDuplicates([
      ev("h", "google_calendar", "17:00", "18:00"),
      ev("s", "ical", "17:45", "19:00"),
    ]);
    expect(got.size).toBe(0);
  });

  it("keeps it for a different category", () => {
    const got = householdDuplicates([
      ev("h", "google_calendar", "17:00", "18:00", { category: "math" }),
      ev("s", "ical", "17:00", "18:00"),
    ]);
    expect(got.size).toBe(0);
  });

  it("keeps someone else's event at the same time", () => {
    const got = householdDuplicates([
      ev("h", "google_calendar", "17:00", "18:00", { owners: ["lei"] }),
      ev("s", "ical", "17:00", "18:00"),
    ]);
    expect(got.size).toBe(0);
  });

  it("never matches on 'other'", () => {
    const got = householdDuplicates([
      ev("h", "google_calendar", "17:00", "18:00", { category: "other" }),
      ev("s", "ical", "17:00", "18:00", { category: "other" }),
    ]);
    expect(got.size).toBe(0);
  });

  it("leaves manual events and differently titled household events alone", () => {
    const got = householdDuplicates([
      ev("m", null, "17:00", "18:00"),
      ev("h1", "google_calendar", "17:00", "18:00"),
      ev("h2", "google_calendar", "17:00", "18:00"),
    ]);
    expect(got.size).toBe(0);
  });

  it("shows a household event entered twice once, keeping the one-off", () => {
    const twin = { title: "Jayden Soccer – Practice (Turf)" };
    const got = householdDuplicates([
      ev("series", "google_calendar", "18:45", "19:45", { ...twin, repeats: true }),
      ev("oneoff", "google_calendar", "18:45", "19:45", { title: " jayden soccer –  practice (turf)" }),
      ev("third", "google_calendar", "18:45", "19:45", twin),
    ]);
    expect([...got].sort()).toEqual(["series", "third"]);
  });

  it("keeps same-titled household events at other times or for other people", () => {
    const twin = { title: "Practice" };
    const got = householdDuplicates([
      ev("a", "google_calendar", "17:00", "18:00", twin),
      ev("b", "google_calendar", "18:00", "19:00", twin),
      ev("c", "google_calendar", "17:00", "18:00", { ...twin, owners: ["ethan"] }),
    ]);
    expect(got.size).toBe(0);
  });

  it("matches all-day events that share a date", () => {
    const day = { allDay: true, category: "tennis" as const };
    const got = householdDuplicates([
      { ...ev("h", "google_calendar", "00:00", "00:00", day), end: at("00:00", "2026-10-04") },
      {
        ...ev("s", "tennis_tc", "00:00", "00:00", day),
        start: at("00:00", "2026-10-02"),
        end: at("00:00", "2026-10-05"),
      },
      {
        ...ev("x", "google_calendar", "00:00", "00:00", day),
        start: at("00:00", "2026-10-05"),
        end: at("00:00", "2026-10-06"),
      },
    ]);
    expect([...got]).toEqual(["h"]);
  });

  it("doesn't match an all-day event with a timed one", () => {
    const got = householdDuplicates([
      { ...ev("h", "google_calendar", "00:00", "00:00", { allDay: true }), end: at("00:00", "2026-10-04") },
      ev("s", "ical", "17:00", "18:00"),
    ]);
    expect(got.size).toBe(0);
  });
});
