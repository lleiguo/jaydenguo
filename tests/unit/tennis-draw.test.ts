import { describe, expect, it } from "vitest";
import { drawView, isKnockout, type DrawMatch, type DrawPlayer, type DrawRound } from "@/domain/tennis-draw";

// TEN-3: his position in the draw and his next match.

const p = (name: string, memberId: string | null = null, seed: string | null = null): DrawPlayer => ({
  name,
  memberId,
  tournamentPlayerId: null,
  seed,
});
const me = p("Me", "1", "2");
const self = { memberId: "1", tournamentPlayerIds: new Set<string>() };

// A match between two sides (empty array = slot not filled yet); `won` is
// 1 or 2 once played.
function m(a: DrawPlayer[], b: DrawPlayer[], won: 0 | 1 | 2 = 0, date: string | null = null): DrawMatch {
  return {
    sides: [
      { players: a, won: won === 1 },
      { players: b, won: won === 2 },
    ],
    played: won !== 0,
    date,
    time: date ? "10:30" : null,
  };
}
const round = (name: string, matches: DrawMatch[]): DrawRound => ({ name, matches });

describe("drawView", () => {
  it("finds his line and seed in a knockout, and the opponent already in his next match", () => {
    const rounds = [
      round("Quarter final", [
        m([p("A")], [p("B")], 1),
        m([p("C")], [me], 2),
        m([p("E")], [p("F")], 2),
        m([p("G")], [p("H")], 1),
      ]),
      round("Semi final", [m([p("A")], [me], 0, "2024-09-29"), m([p("F")], [p("G")])]),
      round("Final", [m([], [])]),
    ];
    expect(isKnockout(rounds)).toBe(true);
    const view = drawView(rounds, self);
    expect(view).toMatchObject({ kind: "bracket", size: 8, position: 4, seed: "2" });
    expect(view.next).toEqual({
      status: "next",
      round: "Semi final",
      opponent: { name: "A", memberId: null, tournamentPlayerId: null },
      feeders: null,
      date: "2024-09-29",
      time: "10:30",
    });
  });

  it("says 'winner of A vs B' when the feeder match isn't played yet", () => {
    const rounds = [
      round("Quarter final", [
        m([me], [p("B")], 1),
        m([p("C")], [p("D")]),
        m([p("E")], [p("F")]),
        m([p("G")], [p("H")]),
      ]),
      round("Semi final", [m([me], []), m([], [])]),
      round("Final", [m([], [])]),
    ];
    const view = drawView(rounds, self);
    expect(view.position).toBe(1);
    expect(view.next).toMatchObject({
      status: "next",
      round: "Semi final",
      opponent: null,
      feeders: ["C", "D"],
    });
  });

  it("uses the feeder's winner when that match is played but the draw isn't updated", () => {
    const rounds = [
      round("Semi final", [m([me], [p("B")], 1), m([p("C")], [p("D")], 2)]),
      round("Final", [m([me], [])]),
    ];
    expect(drawView(rounds, self).next).toMatchObject({ status: "next", opponent: { name: "D" } });
  });

  it("goes straight to round two after a bye", () => {
    // The site shows a bye as a match he won against an empty slot.
    const rounds = [
      round("Round 1", [m([me], [], 1), m([p("C")], [p("D")], 1)]),
      round("Final", [m([me], [p("C")])]),
    ];
    const view = drawView(rounds, self);
    expect(view.position).toBe(1);
    expect(view.next).toMatchObject({ status: "next", round: "Final", opponent: { name: "C" } });
  });

  it("reports won and out", () => {
    const won = [
      round("Semi final", [m([me], [p("B")], 1), m([p("C")], [p("D")], 1)]),
      round("Final", [m([me], [p("C")], 1)]),
    ];
    expect(drawView(won, self).next).toEqual({ status: "won" });
    const out = [
      round("Semi final", [m([me], [p("B")], 2), m([p("C")], [p("D")], 1)]),
      round("Final", [m([p("B")], [p("C")])]),
    ];
    expect(drawView(out, self).next).toEqual({ status: "out" });
  });

  it("treats compass and round-robin draws as 'other', with no line number", () => {
    const rounds = [
      round("Round 1", [m([me], [p("B")], 2), m([p("C")], [p("D")], 1), m([p("E")], [p("F")], 1)]),
      round("East", [m([me], [p("D")])]),
    ];
    const view = drawView(rounds, self);
    expect(view).toMatchObject({ kind: "other", size: null, position: null });
    expect(view.next).toMatchObject({ status: "next", round: "East", opponent: { name: "D" } });
  });

  it("recognises him by his tournament player number when the draw has no member numbers", () => {
    const anon = { ...me, memberId: null, tournamentPlayerId: "77" };
    const rounds = [round("Final", [m([anon], [p("B")])])];
    const view = drawView(rounds, { memberId: "1", tournamentPlayerIds: new Set(["77"]) });
    expect(view.next).toMatchObject({ status: "next", opponent: { name: "B" } });
  });

  it("says not drawn when he isn't in it", () => {
    expect(drawView([round("Final", [m([p("A")], [p("B")])])], self).next).toEqual({ status: "not_drawn" });
  });
});
