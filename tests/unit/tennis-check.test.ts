import { describe, expect, it } from "vitest";
import { CHECK_GAP_MS, CHECK_STALE_MS, checkDecision } from "@/server/tennis/check";

// TPR-4: pull to refresh asks the site at most once every 5 minutes.

describe("checkDecision", () => {
  const now = new Date("2026-10-09T17:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);

  it("starts the first check", () => {
    expect(checkDecision(null, now)).toBe("start");
  });

  it("answers with a good check under 5 minutes old, and starts after", () => {
    expect(checkDecision({ status: "succeeded", startedAt: ago(CHECK_GAP_MS - 1000) }, now)).toBe("recent");
    expect(checkDecision({ status: "succeeded", startedAt: ago(CHECK_GAP_MS) }, now)).toBe("start");
  });

  it("retries a failed check at once", () => {
    expect(checkDecision({ status: "failed", startedAt: ago(1000) }, now)).toBe("start");
  });

  it("waits for a running check, unless it has died", () => {
    expect(checkDecision({ status: "running", startedAt: ago(60_000) }, now)).toBe("wait");
    expect(checkDecision({ status: "running", startedAt: ago(CHECK_STALE_MS) }, now)).toBe("start");
  });
});
