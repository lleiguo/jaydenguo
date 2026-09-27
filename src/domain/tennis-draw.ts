// A draw's next match for him (TEN-3), from the published draw. Pure.
//
// A knockout bracket lists rounds that halve (8, 4, 2, 1 matches) in draw
// order, so match k of a round is fed by matches 2k and 2k+1 of the round
// before. His next opponent is the other player in his first unplayed
// match; when that slot is still empty, it's "the winner of A vs B", the
// feeder match on the other side. Other draw shapes (compass, round robin)
// only get the first unplayed match with whoever is already in it.

export type DrawPlayer = {
  name: string;
  memberId: string | null;
  tournamentPlayerId: string | null;
  seed: string | null;
};
export type DrawMatch = {
  sides: [{ players: DrawPlayer[]; won: boolean }, { players: DrawPlayer[]; won: boolean }];
  played: boolean;
  date: string | null;
  time: string | null;
};
export type DrawRound = { name: string; matches: DrawMatch[] };

export type NextMatch =
  | {
      status: "next";
      round: string;
      opponent: { name: string; memberId: string | null; tournamentPlayerId: string | null } | null;
      // When the opponent isn't known yet: the two players (or "?") in the
      // match whose winner he meets.
      feeders: [string, string] | null;
      date: string | null;
      time: string | null;
    }
  | { status: "won" | "out" | "not_drawn" };

export type DrawView = {
  kind: "bracket" | "other";
  size: number | null;
  position: number | null;
  seed: string | null;
  next: NextMatch;
};

export type SelfIds = { memberId: string | null; tournamentPlayerIds: Set<string> };

const isSelf = (p: DrawPlayer, self: SelfIds) =>
  (!!p.memberId && p.memberId === self.memberId) ||
  (!!p.tournamentPlayerId && self.tournamentPlayerIds.has(p.tournamentPlayerId));

const sideOf = (m: DrawMatch, self: SelfIds) =>
  m.sides.findIndex((s) => s.players.some((p) => isSelf(p, self)));

export function isKnockout(rounds: DrawRound[]): boolean {
  if (!rounds.length) return false;
  for (let i = 1; i < rounds.length; i++) {
    if (rounds[i].matches.length * 2 !== rounds[i - 1].matches.length) return false;
  }
  return rounds[rounds.length - 1].matches.length === 1;
}

export function drawView(rounds: DrawRound[], self: SelfIds): DrawView {
  const knockout = isKnockout(rounds);
  const kind = knockout ? "bracket" : "other";
  let position: number | null = null;
  let seed: string | null = null;
  if (knockout) {
    rounds[0].matches.forEach((m, k) => {
      const s = sideOf(m, self);
      if (s >= 0) {
        position = 2 * k + s + 1;
        seed = m.sides[s].players.find((p) => isSelf(p, self))?.seed ?? null;
      }
    });
  }
  const size = knockout ? rounds[0].matches.length * 2 : null;
  const base = { kind, size, position, seed } as const;

  const all = rounds.flatMap((r, ri) => r.matches.map((m, k) => ({ r, ri, m, k })));
  const mine = all.filter(({ m }) => sideOf(m, self) >= 0);
  if (!mine.length) return { ...base, next: { status: "not_drawn" } };
  const open = mine.find(({ m }) => !m.played);
  if (!open) {
    const last = mine[mine.length - 1];
    const won = last.m.sides[sideOf(last.m, self)].won;
    // Won the last round of a knockout: won the draw. Otherwise he's out,
    // or (compass, round robin) waiting on a match not yet listed.
    return { ...base, next: { status: won && knockout && last.ri === rounds.length - 1 ? "won" : "out" } };
  }
  const s = sideOf(open.m, self);
  let other: DrawPlayer | undefined = open.m.sides[1 - s].players[0];
  let feeders: [string, string] | null = null;
  if (!other && knockout && open.ri > 0) {
    const prev = rounds[open.ri - 1].matches;
    // The feeder on the other side: 2k+1 if he came through 2k, and so on.
    const a = prev[2 * open.k];
    const b = prev[2 * open.k + 1];
    const feeder = a && sideOf(a, self) >= 0 ? b : a;
    const winner = feeder?.sides.find((x) => x.won);
    if (feeder?.played && winner) other = winner.players[0];
    else if (feeder) {
      const side = (i: 0 | 1) => feeder.sides[i].players.map((p) => p.name).join(" / ") || "?";
      feeders = [side(0), side(1)];
    }
  }
  return {
    ...base,
    next: {
      status: "next",
      round: open.r.name,
      opponent: other
        ? { name: other.name, memberId: other.memberId, tournamentPlayerId: other.tournamentPlayerId }
        : null,
      feeders,
      date: open.m.date,
      time: open.m.time,
    },
  };
}
