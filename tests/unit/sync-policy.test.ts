import { afterEach, describe, expect, it } from "vitest";
import { minGapMs } from "@/server/sync/policy";

describe("minGapMs (SYNC-5)", () => {
  afterEach(() => {
    delete process.env.SYNC_MIN_GAP_MINUTES;
  });

  it("lets calendar feeds refresh whenever asked", () => {
    expect(minGapMs("ical")).toBe(0);
    expect(minGapMs("google_calendar")).toBe(0);
  });

  it("keeps scraped sites to one run an hour", () => {
    expect(minGapMs("tennis_tc")).toBe(60 * 60_000);
    expect(minGapMs("veracross")).toBe(60 * 60_000);
    process.env.SYNC_MIN_GAP_MINUTES = "0";
    expect(minGapMs("commit_swim")).toBe(0);
  });
});
