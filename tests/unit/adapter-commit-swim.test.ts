import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { commitBaseUrl } from "@/adapters/commit-swim";
import type { CommitRaw } from "@/adapters/commit-swim/extract";
import { normaliseCommit } from "@/adapters/commit-swim/normalise";
import type { AdapterContext } from "@/adapters/types";

// Recorded from team.commitswimming.com (SP-3) and scrubbed: names, IDs,
// places, dates (104 weeks earlier) and times are all replaced.
const raw = JSON.parse(readFileSync("tests/fixtures/commit-swim/athlete.json", "utf8")) as CommitRaw;
const ctx: AdapterContext = {
  source: { id: "s", name: "Swimming", config: {}, mapping: { default: "swimming" } },
  credential: null,
  now: new Date("2024-09-29T12:00:00Z"),
  homeTimeZone: "America/Toronto",
};

describe("Commit Swimming adapter (SRC-6, SWM-1..3)", () => {
  const batch = normaliseCommit(raw, ctx);
  const swim = batch.swim!;
  const meet = (id: string) => swim.meets.find((m) => m.externalId === id);

  it("keeps meets he signed up for or was invited to, and drops declined ones", () => {
    expect(swim.meets.filter((m) => m.externalId.startsWith("signup:"))).toHaveLength(9);
    for (const declined of ["su003", "su006", "su007"]) expect(meet(`signup:${declined}`)).toBeUndefined();
  });

  it("merges one meet uploaded several times into one", () => {
    const winter = swim.meets.filter((m) => m.startDate === "2024-01-27");
    expect(winter).toHaveLength(1);
    // Tied to its sign-up, and named after the results.
    expect(winter[0]).toMatchObject({
      externalId: "signup:su014",
      name: "Fixture Winter Invitational 26",
      endDate: "2024-01-28",
      course: "SCM",
      signup: "yes",
    });
  });

  it("ties result meets to sign-ups by date, and keeps the rest as result-only meets", () => {
    expect(meet("signup:su008")?.name).toBe("Fixture Time Trial 30");
    expect(swim.meets.filter((m) => m.externalId.startsWith("result:")).map((m) => m.externalId)).toEqual([
      "result:rm020",
      "result:rm021",
      "result:rm022",
      "result:rm023",
      "result:rm024",
    ]);
    expect(meet("result:rm024")).toMatchObject({ startDate: "2022-11-20", entries: null, signup: null });
  });

  it("reads entries with seed times in ms", () => {
    expect(meet("signup:su009")?.entries).toEqual([
      { distance: 200, stroke: "im", course: "SCM", seedTimeMs: 265100 },
      { distance: 50, stroke: "back", course: "SCM", seedTimeMs: null },
      { distance: 100, stroke: "free", course: "SCM", seedTimeMs: 134730 },
    ]);
  });

  it("keeps each swim once, in ms, with the right meet", () => {
    expect(swim.results).toHaveLength(33);
    const im200 = swim.results
      .filter((r) => r.distance === 200 && r.stroke === "im")
      .sort((a, b) => a.swimDate.localeCompare(b.swimDate));
    expect(im200.map((r) => [r.swimDate, r.timeMs])).toEqual([
      ["2023-11-05", 314810],
      ["2024-02-18", 288520],
      ["2024-04-14", 267970],
      ["2024-05-19", 271350],
    ]);
    expect(im200[0].meetExternalId).toBe("signup:su018");
    const fly = swim.results.filter((r) => r.swimDate === "2024-01-27" && r.stroke === "fly");
    expect(fly).toEqual([expect.objectContaining({ externalId: "sw055", meetExternalId: "signup:su014" })]);
  });

  it("keeps splits only when every leg has a time and they add up", () => {
    const byId = (id: string) => swim.results.find((r) => r.externalId === id)!;
    expect(byId("sw040").splits).toEqual([
      { distance: 50, ms: 64920 },
      { distance: 50, ms: 69750 },
      { distance: 50, ms: 77760 },
      { distance: 50, ms: 58920 },
    ]);
    // Placeholder splits (null, 0, whole time on the last leg).
    expect(byId("sw042").splits).toEqual([]);
    expect(byId("sw033").splits).toEqual([]);
  });

  it("puts meets and team events on the calendar as all-day swimming events", () => {
    expect(batch.records).toHaveLength(9 + 5 + 6);
    const upcoming = batch.records.find((r) => r.externalId === "signup:su001")!;
    expect(upcoming).toMatchObject({
      category: "swimming",
      attendance: "required",
      allDay: true,
      startUtc: new Date("2024-10-13T00:00:00Z"),
      endUtc: new Date("2024-10-14T00:00:00Z"),
      locationName: "Lakeside Swim Complex, Springfield",
      sourceUrl: "https://team.commitswimming.com/app/fixtureteam/meets",
    });
    const entered = batch.records.find((r) => r.externalId === "signup:su009")!;
    expect(entered.notes).toBe(
      "Entered: 200 IM SCM (seed 4:25.10), 50 Back SCM, 100 Free SCM (seed 2:14.73)",
    );
    const team = batch.records.find((r) => r.externalId === "signup:su002")!;
    expect(team).toMatchObject({ title: "Team Event 2", allDay: true, category: "swimming" });
  });

  it("marks invitations he hasn't answered as optional", () => {
    const unanswered = normaliseCommit(
      { ...raw, signups: [{ ...raw.signups[0], answer: null }], meets: [], swims: [], splits: [] },
      ctx,
    );
    expect(unanswered.records[0]).toMatchObject({ attendance: "optional", notes: "Not signed up yet." });
    expect(unanswered.swim!.meets[0].signup).toBeNull();
  });

  it("gives DQ swims no time", () => {
    const dq = normaliseCommit({ ...raw, swims: [{ ...raw.swims[0], dq: "False start" }] }, ctx);
    expect(dq.swim!.results[0]).toMatchObject({ timeMs: null, dqReason: "False start", splits: [] });
  });

  it("only cancels calendar events and meets from 30 days ago on", () => {
    expect(batch.window.from).toEqual(new Date("2024-08-30T00:00:00Z"));
    expect(swim.window).toEqual(batch.window);
  });
});

describe("Commit Swimming base URL", () => {
  it("only accepts loopback overrides", () => {
    const before = process.env.COMMIT_SWIM_BASE_URL;
    try {
      delete process.env.COMMIT_SWIM_BASE_URL;
      expect(commitBaseUrl()).toBe("https://team.commitswimming.com");
      process.env.COMMIT_SWIM_BASE_URL = "http://127.0.0.1:4455/whatever";
      expect(commitBaseUrl()).toBe("http://127.0.0.1:4455");
      process.env.COMMIT_SWIM_BASE_URL = "https://evil.example";
      expect(() => commitBaseUrl()).toThrow();
    } finally {
      if (before === undefined) delete process.env.COMMIT_SWIM_BASE_URL;
      else process.env.COMMIT_SWIM_BASE_URL = before;
    }
  });
});
