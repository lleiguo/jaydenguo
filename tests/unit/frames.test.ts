import { describe, expect, it } from "vitest";
import { chooseFrameTimes, geminiFps, type MotionSample } from "@/domain/frames";

// 15 samples a second, quiet except where `busy` says.
const motion = (duration: number, busy: [number, number, number][]): MotionSample[] =>
  Array.from({ length: Math.floor(duration * 15) }, (_, i) => {
    const t = i / 15;
    const hit = busy.find(([a, b]) => t >= a && t < b);
    return { t, score: hit ? hit[2] : 0.01 };
  });

describe("chooseFrameTimes", () => {
  it("samples about 1.5 a second, and 12 a second around the busiest moment", () => {
    const times = chooseFrameTimes(20, motion(20, [[8, 9, 0.6]]));
    const dense = times.filter((t) => t >= 7.5 && t < 9.5);
    const elsewhere = times.filter((t) => t < 7 || t >= 10);
    expect(dense.length).toBeGreaterThanOrEqual(12);
    // 1.5 a second over the other ~17 s.
    expect(elsewhere.length).toBeGreaterThanOrEqual(22);
    expect(elsewhere.length).toBeLessThanOrEqual(28);
    expect(times.length).toBeLessThanOrEqual(60);
  });

  it("adds a second window when there's a second burst of motion", () => {
    const times = chooseFrameTimes(
      20,
      motion(20, [
        [3, 4, 0.5],
        [14, 15, 0.45],
      ]),
    );
    expect(times.filter((t) => t >= 3 && t < 4.2).length).toBeGreaterThanOrEqual(12);
    expect(times.filter((t) => t >= 14 && t < 15.2).length).toBeGreaterThanOrEqual(12);
  });

  it("stays under the cap on a long clip, keeping the dense window", () => {
    const times = chooseFrameTimes(120, motion(120, [[60, 61, 0.9]]));
    expect(times.length).toBeLessThanOrEqual(60);
    expect(times.filter((t) => t >= 59.5 && t < 61.5).length).toBeGreaterThanOrEqual(12);
    expect(times[0]).toBeLessThan(1);
    expect(times.at(-1)).toBeGreaterThan(115);
  });

  it("is sorted, unique and inside the clip", () => {
    const times = chooseFrameTimes(5, motion(5, [[1, 2, 0.4]]));
    expect(times).toEqual([...new Set(times)].sort((a, b) => a - b));
    expect(times.every((t) => t >= 0 && t < 5)).toBe(true);
  });

  it("covers a very short clip densely", () => {
    const times = chooseFrameTimes(1, motion(1, []));
    expect(times.length).toBeGreaterThanOrEqual(10);
  });

  it("returns nothing for an empty clip", () => {
    expect(chooseFrameTimes(0, [])).toEqual([]);
  });
});

describe("geminiFps", () => {
  it("asks for more frames on tennis strokes", () => {
    expect(geminiFps("tennis", 20)).toBe(8);
    expect(geminiFps("swimming", 20)).toBe(4);
  });
  it("lowers the rate on long clips", () => {
    expect(geminiFps("tennis", 100)).toBe(4);
    expect(geminiFps("swimming", 1000)).toBe(1);
  });
});
