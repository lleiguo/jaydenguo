import { describe, expect, it } from "vitest";
import { detectClashes, type ClashEvent } from "@/domain/clashes";

// Every rule in spec CON-1, plus CAL-7 closures (plan M1.9).
const tz = "America/Toronto";
let n = 0;
function ev(start: string, end: string, extra: Partial<ClashEvent> = {}): ClashEvent {
  return {
    id: `e${String(++n).padStart(3, "0")}`,
    category: "soccer",
    attendance: "required",
    owners: ["jayden"],
    start: new Date(start),
    end: new Date(end),
    allDay: false,
    ...extra,
  };
}
const run = (events: ClashEvent[]) => detectClashes({ events, homeTimeZone: tz });

describe("detectClashes", () => {
  it("flags overlapping events that both need Jayden", () => {
    const a = ev("2026-10-05T21:00:00Z", "2026-10-05T22:30:00Z");
    const b = ev("2026-10-05T22:00:00Z", "2026-10-05T23:00:00Z", { category: "tennis" });
    expect(run([a, b])).toEqual([{ a: a.id, b: b.id, overlapMin: 30, people: ["jayden"] }]);
  });

  it("back-to-back events and short gaps don't clash", () => {
    const a = ev("2026-10-05T21:00:00Z", "2026-10-05T22:00:00Z");
    const b = ev("2026-10-05T22:00:00Z", "2026-10-05T23:00:00Z");
    const c = ev("2026-10-06T21:00:00Z", "2026-10-06T22:00:00Z");
    const d = ev("2026-10-06T22:05:00Z", "2026-10-06T23:00:00Z");
    expect(run([a, b, c, d])).toEqual([]);
  });

  it("clashes only when the overlap is more than 15 minutes", () => {
    const a = ev("2026-10-05T21:00:00Z", "2026-10-05T22:00:00Z");
    const b = ev("2026-10-05T21:45:00Z", "2026-10-05T23:00:00Z"); // 15 min
    expect(run([a, b])).toEqual([]);
    const c = ev("2026-10-06T21:00:00Z", "2026-10-06T22:00:00Z");
    const d = ev("2026-10-06T21:44:00Z", "2026-10-06T23:00:00Z"); // 16 min
    expect(run([c, d])).toEqual([{ a: c.id, b: d.id, overlapMin: 16, people: ["jayden"] }]);
  });

  it("measures the overlap when one event sits inside another", () => {
    const long = ev("2026-10-05T20:00:00Z", "2026-10-05T23:00:00Z");
    const short = ev("2026-10-05T21:00:00Z", "2026-10-05T21:20:00Z");
    expect(run([long, short])).toMatchObject([{ overlapMin: 20 }]);
  });

  it("never counts optional events", () => {
    const a = ev("2026-10-05T21:00:00Z", "2026-10-05T22:00:00Z");
    const b = ev("2026-10-05T21:00:00Z", "2026-10-05T22:00:00Z", { attendance: "optional" });
    expect(run([a, b])).toEqual([]);
  });

  it("clashes per person: only events that share an owner clash", () => {
    const his = ev("2026-10-05T21:00:00Z", "2026-10-05T22:00:00Z");
    const lei = ev("2026-10-05T21:00:00Z", "2026-10-05T22:00:00Z", { owners: ["lei"] });
    expect(run([his, lei])).toEqual([]);

    const ethan1 = ev("2026-10-06T21:00:00Z", "2026-10-06T22:00:00Z", { owners: ["ethan"] });
    const ethan2 = ev("2026-10-06T21:30:00Z", "2026-10-06T22:30:00Z", { owners: ["ethan"] });
    expect(run([ethan1, ethan2])).toEqual([
      { a: ethan1.id, b: ethan2.id, overlapMin: 30, people: ["ethan"] },
    ]);

    // A family event clashes for each person it shares with the other.
    const family = ev("2026-10-07T21:00:00Z", "2026-10-07T23:00:00Z", { owners: ["jayden", "lei", "ethan"] });
    const game = ev("2026-10-07T22:00:00Z", "2026-10-07T23:00:00Z");
    expect(run([family, game])).toMatchObject([{ people: ["jayden"] }]);
  });

  it("school classes clash with activities on school days but not on closure days", () => {
    const cls = ev("2026-10-05T19:00:00Z", "2026-10-05T20:00:00Z", { category: "school_class" });
    const swim = ev("2026-10-05T19:30:00Z", "2026-10-05T20:30:00Z", { category: "swimming" });
    expect(run([cls, swim])).toHaveLength(1);

    const closure = ev("2026-10-05T00:00:00Z", "2026-10-06T00:00:00Z", {
      category: "school_closure",
      allDay: true,
    });
    expect(run([cls, swim, closure])).toEqual([]);
  });

  it("classes don't clash with each other, and all-day events never clash", () => {
    const c1 = ev("2026-10-05T13:00:00Z", "2026-10-05T14:00:00Z", { category: "school_class" });
    const c2 = ev("2026-10-05T14:00:00Z", "2026-10-05T15:00:00Z", { category: "school_class" });
    const tourney = ev("2026-10-05T00:00:00Z", "2026-10-07T00:00:00Z", { allDay: true, category: "tennis" });
    expect(run([c1, c2, tourney])).toEqual([]);
  });

  it("finds every pair when three events overlap", () => {
    const a = ev("2026-10-05T21:00:00Z", "2026-10-05T23:00:00Z");
    const b = ev("2026-10-05T21:30:00Z", "2026-10-05T22:15:00Z");
    const c = ev("2026-10-05T21:45:00Z", "2026-10-05T22:30:00Z");
    expect(
      run([c, a, b])
        .map((x) => `${x.a}-${x.b}`)
        .sort(),
    ).toEqual([`${a.id}-${b.id}`, `${a.id}-${c.id}`, `${b.id}-${c.id}`].sort());
  });

  it("runs over two years of events in under 200 ms (NFR-4)", () => {
    const events: ClashEvent[] = [];
    const start = Date.UTC(2026, 0, 1);
    // ~10 events a day for two years.
    for (let day = 0; day < 730; day++) {
      for (let i = 0; i < 10; i++) {
        const s = start + day * 86_400_000 + (8 + i) * 3_600_000;
        events.push(
          ev(new Date(s).toISOString(), new Date(s + 5_400_000).toISOString(), {
            category: i % 3 ? "soccer" : "school_class",
          }),
        );
      }
    }
    detectClashes({ events: events.slice(0, 100), homeTimeZone: tz }); // warm up
    const t0 = performance.now();
    const clashes = detectClashes({ events, homeTimeZone: tz });
    const ms = performance.now() - t0;
    expect(clashes.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(200);
  });
});
