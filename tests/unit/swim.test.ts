import { describe, expect, it } from "vitest";
import {
  annotatePbs,
  eventKey,
  formatChange,
  formatSession,
  formatSwimTime,
  normaliseStroke,
  parseEventKey,
  parseSwimTime,
  personalBests,
  progression,
  sessionDate,
  sessionTime,
  type SwimForStats,
} from "@/domain/swim";

const swim = (
  id: string,
  swimDate: string,
  timeMs: number | null,
  extra: Partial<SwimForStats> = {},
): SwimForStats => ({
  id,
  swimDate,
  timeMs,
  distance: 50,
  stroke: "free",
  course: "SCM",
  ...extra,
});

describe("swim times", () => {
  it("formats to hundredths", () => {
    expect(formatSwimTime(34850)).toBe("34.85");
    expect(formatSwimTime(68230)).toBe("1:08.23");
    expect(formatSwimTime(605000)).toBe("10:05.00");
    expect(formatSwimTime(9990)).toBe("9.99");
    expect(formatSwimTime(null)).toBe("—");
    expect(formatChange(-1230)).toBe("−1.23");
    expect(formatChange(450)).toBe("+0.45");
  });

  it("parses what people type", () => {
    expect(parseSwimTime("1:08.23")).toBe(68230);
    expect(parseSwimTime("68.23")).toBe(68230);
    expect(parseSwimTime("34.8")).toBe(34800);
    expect(parseSwimTime("34,85")).toBe(34850);
    expect(parseSwimTime("2:05")).toBe(125000);
    expect(parseSwimTime("1:75.00")).toBeNull();
    expect(parseSwimTime("fast")).toBeNull();
    expect(parseSwimTime("0")).toBeNull();
  });

  it("round-trips event keys", () => {
    const e = { distance: 200, stroke: "im" as const, course: "LCM" as const };
    expect(parseEventKey(eventKey(e))).toEqual(e);
    expect(parseEventKey("200-im-XYZ")).toBeNull();
    expect(normaliseStroke("Butterfly")).toBe("fly");
    expect(normaliseStroke("Medley")).toBe("im");
  });
});

describe("PBs (SWM-3, SWM-6)", () => {
  const swims = [
    swim("a", "2025-01-10", 40000),
    swim("b", "2025-02-10", 41000),
    swim("c", "2025-03-10", 39000),
    swim("d", "2025-04-10", null, { stroke: "free" }),
    swim("e", "2025-05-10", 39000),
    // Heats then final on the same day.
    swim("f2", "2025-06-10", 38000, { stage: "Final" }),
    swim("f1", "2025-06-10", 38500, { stage: "Prelim" }),
  ];
  const pbs = annotatePbs(swims);

  it("flags the first swim and every new best, with the change from the previous best", () => {
    expect(pbs.get("a")).toEqual({ isPb: true, previousBestMs: null, changeMs: null });
    expect(pbs.get("b")).toEqual({ isPb: false, previousBestMs: 40000, changeMs: 1000 });
    expect(pbs.get("c")).toEqual({ isPb: true, previousBestMs: 40000, changeMs: -1000 });
    expect(pbs.get("d")).toEqual({ isPb: false, previousBestMs: 39000, changeMs: null });
    // Equalling a PB isn't a new one.
    expect(pbs.get("e")).toEqual({ isPb: false, previousBestMs: 39000, changeMs: 0 });
    expect(pbs.get("f1")).toEqual({ isPb: true, previousBestMs: 39000, changeMs: -500 });
    expect(pbs.get("f2")).toEqual({ isPb: true, previousBestMs: 38500, changeMs: -500 });
  });

  it("lists the best per event and course", () => {
    expect(personalBests(swims)).toEqual([
      {
        key: "50-free-SCM",
        distance: 50,
        stroke: "free",
        course: "SCM",
        timeMs: 38000,
        swimDate: "2025-06-10",
        resultId: "f2",
      },
    ]);
  });
});

describe("courses are never mixed (SWM-4, M2.5)", () => {
  const swims = [
    swim("s1", "2025-01-10", 40000, { course: "SCM" }),
    swim("l1", "2025-02-10", 42000, { course: "LCM" }),
    swim("s2", "2025-03-10", 39500, { course: "SCM" }),
    swim("l2", "2025-04-10", 41000, { course: "LCM" }),
    swim("y1", "2025-05-10", 35000, { course: "SCY" }),
  ];

  it("keeps a separate PB per course", () => {
    const pbs = annotatePbs(swims);
    // The LCM swim is slower than the SCM best but is still an LCM PB.
    expect(pbs.get("l1")?.isPb).toBe(true);
    expect(pbs.get("l2")).toEqual({ isPb: true, previousBestMs: 42000, changeMs: -1000 });
    expect(pbs.get("s2")).toEqual({ isPb: true, previousBestMs: 40000, changeMs: -500 });
    expect(personalBests(swims).map((p) => [p.course, p.timeMs])).toEqual([
      ["SCM", 39500],
      ["LCM", 41000],
      ["SCY", 35000],
    ]);
  });

  it("gives a progression series with only one course", () => {
    const scm = progression(swims, { distance: 50, stroke: "free", course: "SCM" });
    expect(scm.points.map((p) => p.id)).toEqual(["s1", "s2"]);
    const lcm = progression(swims, { distance: 50, stroke: "free", course: "LCM" });
    expect(lcm.points.map((p) => p.id)).toEqual(["l1", "l2"]);
    expect(lcm.pbSteps).toEqual([
      { swimDate: "2025-02-10", timeMs: 42000 },
      { swimDate: "2025-04-10", timeMs: 41000 },
    ]);
  });
});

describe("session times (SWM-2)", () => {
  it("reads Commit Swimming's session starts as 24-hour times", () => {
    expect(sessionTime("08:50AM")).toBe("08:50");
    expect(sessionTime("04:30PM")).toBe("16:30");
    expect(sessionTime("12:15PM")).toBe("12:15");
    expect(sessionTime("12:05 am")).toBe("00:05");
    expect(sessionTime("17:45")).toBe("17:45");
    expect(sessionTime("13:00PM")).toBeNull();
    expect(sessionTime("TBD")).toBeNull();
    expect(sessionTime(null)).toBeNull();
  });

  it("puts a session on its day of the meet", () => {
    expect(sessionDate("2024-04-27", 1)).toBe("2024-04-27");
    expect(sessionDate("2024-04-27", 2)).toBe("2024-04-28");
    expect(sessionDate("2024-04-27", null)).toBe("2024-04-27");
    expect(formatSession({ date: "2024-04-28", time: "16:30" })).toBe("Sun 2024-04-28 16:30");
  });
});
