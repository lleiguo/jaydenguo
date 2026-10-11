import { describe, expect, it } from "vitest";
import { geminiFps } from "@/domain/video-fps";

describe("geminiFps", () => {
  it("asks for more frames on tennis strokes", () => {
    expect(geminiFps("tennis", 20)).toBe(8);
    expect(geminiFps("swimming", 20)).toBe(4);
  });
  // Intent 0014, WVR-4: up to 900 frames.
  it("lowers the rate on long clips", () => {
    expect(geminiFps("tennis", 120)).toBe(7);
    expect(geminiFps("swimming", 252)).toBe(3);
    expect(geminiFps("tennis", 600)).toBe(1);
    expect(geminiFps("swimming", 1000)).toBe(1);
  });
});
