import { describe, expect, it } from "vitest";
import { repeatKey, sameRepeat } from "@/domain/repeats";

const base = { seriesId: null, sourceId: "s1", sourceKind: "ical", externalId: null };

describe("repeatKey", () => {
  it("groups a series added here by its ID", () => {
    expect(repeatKey({ ...base, seriesId: "x", externalId: "2031-04-01" })).toEqual({ seriesId: "x" });
  });

  it("groups iCal occurrences by UID and leaves single events alone", () => {
    const a = repeatKey({ ...base, externalId: "abc@teamsnap#20310401T150000" });
    const b = repeatKey({ ...base, externalId: "abc@teamsnap#20310408T150000" });
    expect(a).toEqual({ sourceId: "s1", prefix: "abc@teamsnap#" });
    expect(sameRepeat(a!, b!)).toBe(true);
    expect(repeatKey({ ...base, externalId: "abc@teamsnap" })).toBeNull();
  });

  it("groups Google Calendar instances by their recurring event", () => {
    const g = { ...base, sourceKind: "google_calendar" };
    expect(repeatKey({ ...g, externalId: "7kq2ab_20310401T190000Z" })).toEqual({
      sourceId: "s1",
      prefix: "7kq2ab_",
    });
    expect(repeatKey({ ...g, externalId: "7kq2ab_20310401" })).toEqual({ sourceId: "s1", prefix: "7kq2ab_" });
    expect(repeatKey({ ...g, externalId: "7kq2ab" })).toBeNull();
  });

  it("doesn't match across sources or other kinds", () => {
    const a = repeatKey({ ...base, externalId: "u#1" })!;
    const b = repeatKey({ ...base, sourceId: "s2", externalId: "u#2" })!;
    expect(sameRepeat(a, b)).toBe(false);
    expect(repeatKey({ ...base, sourceKind: "veracross", externalId: "u#1" })).toBeNull();
  });
});
