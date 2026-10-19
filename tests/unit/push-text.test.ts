import { describe, expect, it } from "vitest";
import { swimEntriesText, swimResultsText, tennisResultText } from "@/server/push/kinds";

// What the new pushes say (intent 0023, NTF-T5, NTF-S1, NTF-S3).

describe("tennis result text", () => {
  it("says won or lost with the score, opponent and round", () => {
    expect(
      tennisResultText({ won: true, outcome: "played", sets: "6-3 6-4", opponent: "Sam Lee", round: "R16" }),
    ).toBe("Won 6-3 6-4 against Sam Lee (R16).");
    expect(
      tennisResultText({ won: false, outcome: "played", sets: "4-6 2-6", opponent: "Sam Lee", round: null }),
    ).toBe("Lost 4-6 2-6 against Sam Lee.");
  });

  it("says walkover and retirement", () => {
    expect(
      tennisResultText({ won: true, outcome: "walkover", sets: "", opponent: "Sam Lee", round: "QF" }),
    ).toBe("Won by walkover against Sam Lee (QF).");
    expect(
      tennisResultText({ won: true, outcome: "retired", sets: "6-2 1-0", opponent: "Sam Lee", round: "SF" }),
    ).toBe("Won 6-2 1-0 (retired) against Sam Lee (SF).");
  });
});

describe("swim text", () => {
  it("lists entries with seed times, NT without one", () => {
    expect(
      swimEntriesText([
        { distance: 50, stroke: "free", course: "SCM", seedTimeMs: 34_120 },
        { distance: 100, stroke: "back", course: "SCM", seedTimeMs: null },
      ]),
    ).toBe("50 Free 34.12, 100 Back NT");
  });

  it("lists results with place, best time and DQ", () => {
    expect(
      swimResultsText([
        { distance: 50, stroke: "free", course: "SCM", timeMs: 33_870, place: 2, dqReason: null, isPb: true },
        {
          distance: 200,
          stroke: "im",
          course: "SCM",
          timeMs: 171_450,
          place: 11,
          dqReason: null,
          isPb: false,
        },
        {
          distance: 100,
          stroke: "back",
          course: "SCM",
          timeMs: null,
          place: null,
          dqReason: "false start",
          isPb: false,
        },
      ]),
    ).toBe("50 Free 33.87 (2nd, best time), 200 IM 2:51.45 (11th), 100 Back DQ (false start)");
  });
});
