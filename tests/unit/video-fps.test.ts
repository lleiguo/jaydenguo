import { describe, expect, it } from "vitest";
import { geminiFps } from "@/domain/video-fps";

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
