import { categorise } from "../../domain/categories";
import type { MatchOutcome } from "../../domain/tennis-constants";
import { drawView, isKnockout, type DrawRound, type SelfIds } from "../../domain/tennis-draw";
import {
  matchKey,
  type TennisDrawRecord,
  type TennisMatchRecord,
  type TennisPlayerRecord,
  type TennisTournamentRecord,
} from "../../domain/tennis-upsert";
import { addDays, localDate, zonedToUtc } from "../../domain/time";
import type { SourceRecord } from "../../domain/upsert";
import type { AdapterContext, NormalisedBatch } from "../types";
import type { TcRaw } from "./index";
import type { TcBracketRound, TcMatch, TcTournamentSummary } from "./parse";

// Turns what the crawl read into players, tournaments, his draws and
// matches, plus calendar events for his tournaments and scheduled matches
// (TEN-2, TEN-3). Pure, so it's tested from the recorded fixtures.

const PAST_DAYS = 30;

export function toDrawRounds(rounds: TcBracketRound[]): DrawRound[] {
  return rounds.map((r) => ({
    name: r.name,
    matches: r.matches.map((m) => ({
      sides: m.sides,
      played: m.sides.some((s) => s.won) || m.sets.length > 0,
      date: m.date,
      time: m.time,
    })),
  }));
}
// Whether a draw page's columns are its rounds. Round robin boxes are laid
// out in columns too, but there each column is one player's matches, so
// the "rounds" are wrong and out of order.
export const isBracket = (rounds: TcBracketRound[]) => isKnockout(toDrawRounds(rounds));

// The rounds to read a draw by: a knockout's bracket as it is; any other
// shape (round robin, compass) from the draw's match list, which is in
// schedule order, grouped by each match's round. Without a list, the
// bracket page is all there is.
export function drawRounds(
  bracket: TcBracketRound[],
  list: TcMatch[],
  drawName: string | null,
): TcBracketRound[] {
  if (isBracket(bracket) || !list.length) return bracket;
  const rounds: TcBracketRound[] = [];
  for (const m of list) {
    const name = m.round ?? drawName ?? "Draw";
    const r = rounds.find((x) => x.name === name);
    if (r) r.matches.push(m);
    else rounds.push({ name, matches: [m] });
  }
  return rounds;
}
const MATCH_MINUTES = 60;

function outcomeOf(m: TcMatch): { outcome: MatchOutcome; winner: 1 | 2 | null } {
  const w = m.sides[0].won ? 1 : m.sides[1].won ? 2 : null;
  const note = (m.note ?? "").toLowerCase();
  if (/walk ?over|w\/o|w\.o\./.test(note)) return { outcome: "walkover", winner: w };
  if (/retire|ret\.|default|dns/.test(note)) return { outcome: "retired", winner: w };
  if (w === null && !m.sets.length) return { outcome: "scheduled", winner: null };
  return { outcome: "played", winner: w };
}

export function normaliseTennis(raw: TcRaw, ctx: AdapterContext): NormalisedBatch {
  const warnings: string[] = [];
  const tz = ctx.homeTimeZone;
  const today = localDate(ctx.now, tz);
  const from = new Date(`${addDays(today, -PAST_DAYS)}T00:00:00Z`);
  const selfId = raw.self.memberId;
  const tUrl = (id: string) => `${raw.base}/tournament/${id}`;

  // Tournament player numbers → member numbers, learned from every match
  // that shows both (played matches link to head-to-head pages).
  const tpMember = new Map<string, string>();
  const learn = (tournaments: TcTournamentSummary[]) => {
    for (const t of tournaments)
      for (const m of t.matches)
        for (const s of m.sides)
          for (const p of s.players)
            if (p.memberId && p.tournamentPlayerId)
              tpMember.set(`${t.id}:${p.tournamentPlayerId}`, p.memberId);
  };
  learn(raw.tournaments);
  for (const o of raw.opponents) learn(o.tournaments);
  for (const x of raw.tournamentPlayers)
    tpMember.set(`${x.tournamentId}:${x.tournamentPlayerId}`, x.memberId);
  for (const x of raw.selfTournamentPlayers ?? [])
    tpMember.set(`${x.tournamentId}:${x.tournamentPlayerId}`, selfId);
  const memberOf = (
    tournamentId: string | null,
    p: { memberId: string | null; tournamentPlayerId: string | null },
  ) =>
    p.memberId ??
    (tournamentId && p.tournamentPlayerId
      ? tpMember.get(`${tournamentId}:${p.tournamentPlayerId}`)
      : undefined);

  // Players: him, the opponents read one hop out, and everyone else by the
  // name a match shows.
  const players = new Map<string, TennisPlayerRecord>();
  const addPlayer = (p: TennisPlayerRecord) => {
    const had = players.get(p.memberId);
    if (!had || (p.profileFetched && !had.profileFetched)) players.set(p.memberId, p);
  };
  addPlayer({
    memberId: selfId,
    name: raw.self.name,
    club: raw.self.club,
    profileId: raw.self.profileId,
    isSelf: true,
    profileFetched: true,
  });
  for (const o of raw.opponents)
    addPlayer({
      memberId: o.memberId,
      name: o.name ?? "Player",
      club: o.club,
      profileId: o.profileId,
      isSelf: false,
      profileFetched: true,
    });

  // Tournaments: his (entered) and the ones his opponents played.
  const details = new Map(raw.details.map((d) => [d.id, d]));
  const tournaments = new Map<string, TennisTournamentRecord>();
  const addTournament = (t: TcTournamentSummary, entered: boolean) => {
    const d = details.get(t.id);
    const dates = t.matches
      .map((m) => m.date)
      .filter((x): x is string => !!x)
      .sort();
    const start = d?.startDate ?? t.startDate ?? dates[0];
    if (!start) return;
    const end = d?.endDate ?? dates[dates.length - 1] ?? start;
    const prev = tournaments.get(t.id);
    tournaments.set(t.id, {
      externalId: t.id,
      name: d?.name ?? t.name,
      startDate: start,
      endDate: end < start ? start : end,
      venue: d?.venue ?? t.venue,
      city: d?.city ?? null,
      region: d?.region ?? null,
      entryDeadline: d?.entryDeadline ?? null,
      categories: t.categories,
      entered: entered || !!prev?.entered,
      sourceUrl: tUrl(t.id),
    });
  };
  for (const t of raw.tournaments) addTournament(t, true);
  for (const o of raw.opponents)
    for (const t of o.tournaments) if (!tournaments.has(t.id)) addTournament(t, false);

  // Matches, from every page read; the same match seen twice is merged
  // (a draw adds start times and rounds a profile page leaves out).
  const matches = new Map<string, TennisMatchRecord>();
  let skipped = 0;
  const addMatch = (t: { id: string; startDate: string | null }, m: TcMatch) => {
    if (m.sides.some((s) => !s.players.length)) return; // a bye
    const sides = m.sides.map((s) => s.players.map((p) => memberOf(t.id, p)));
    if (sides.some((s) => s.some((x) => !x))) {
      skipped++;
      return;
    }
    const [side1, side2] = sides as string[][];
    for (const [i, s] of m.sides.entries())
      s.players.forEach((p, j) =>
        addPlayer({
          memberId: sides[i][j]!,
          name: p.name,
          club: null,
          profileId: null,
          isSelf: sides[i][j] === selfId,
          profileFetched: false,
        }),
      );
    const date = m.date ?? tournaments.get(t.id)?.startDate ?? t.startDate;
    if (!date) return;
    const { outcome, winner } = outcomeOf(m);
    const scheduledAt =
      m.time && m.date
        ? zonedToUtc(
            {
              year: +m.date.slice(0, 4),
              month: +m.date.slice(5, 7),
              day: +m.date.slice(8, 10),
              hour: +m.time.slice(0, 2),
              minute: +m.time.slice(3, 5),
              second: 0,
            },
            tz,
          ).toISOString()
        : null;
    const drawOrEvent = m.drawNo ?? m.eventName ?? "event";
    const externalId = matchKey(t.id, drawOrEvent, side1, side2);
    const prev = matches.get(externalId);
    // Keep the first sighting's side order; flip this one to match it.
    const flip = !!prev && prev.side1.join("+") !== side1.join("+");
    const w = flip && winner ? ((3 - winner) as 1 | 2) : winner;
    const sets = flip ? m.sets.map(([a, b]) => [b, a] as [number, number]) : m.sets;
    matches.set(externalId, {
      externalId,
      tournamentExternalId: t.id,
      drawNo: m.drawNo ?? prev?.drawNo ?? null,
      eventName: m.eventName ?? prev?.eventName ?? null,
      round: m.round ?? prev?.round ?? null,
      matchDate: date,
      scheduledAt: scheduledAt ?? prev?.scheduledAt ?? null,
      side1: prev?.side1 ?? side1,
      side2: prev?.side2 ?? side2,
      winner: w ?? prev?.winner ?? null,
      sets: sets.length ? sets : (prev?.sets ?? []),
      outcome: outcome === "scheduled" && prev ? prev.outcome : outcome,
    });
  };
  for (const t of raw.tournaments) for (const m of t.matches) addMatch(t, m);
  for (const o of raw.opponents) for (const t of o.tournaments) for (const m of t.matches) addMatch(t, m);
  const eventNames = new Map<string, string | null>();
  for (const t of raw.tournaments)
    for (const d of t.draws) eventNames.set(`${t.id}:${d.drawNo}`, d.eventName);
  // From draws, only his matches: they add start times and rounds.
  for (const d of raw.draws)
    for (const r of d.rounds)
      for (const m of r.matches)
        if (m.sides.some((s) => s.players.some((p) => memberOf(d.tournamentId, p) === selfId)))
          addMatch(
            { id: d.tournamentId, startDate: tournaments.get(d.tournamentId)?.startDate ?? null },
            { ...m, eventName: eventNames.get(`${d.tournamentId}:${d.drawNo}`) ?? null },
          );
  if (skipped) warnings.push(`${skipped} matches without player numbers were skipped.`);
  if (raw.truncated)
    warnings.push("Reached the page limit for one run; some opponents' results will be read next time.");

  // His draws: position and next match.
  const selfTps = new Map<string, Set<string>>();
  for (const [k, v] of tpMember) {
    if (v !== selfId) continue;
    const [tid, tp] = k.split(":");
    selfTps.set(tid, (selfTps.get(tid) ?? new Set()).add(tp));
  }
  const draws: TennisDrawRecord[] = [];
  for (const d of raw.draws) {
    const self: SelfIds = { memberId: selfId, tournamentPlayerIds: selfTps.get(d.tournamentId) ?? new Set() };
    const view = drawView(toDrawRounds(d.rounds), self);
    const summary = raw.tournaments
      .find((t) => t.id === d.tournamentId)
      ?.draws.find((x) => x.drawNo === d.drawNo);
    const next = view.next;
    if (next.status === "next" && next.opponent && !next.opponent.memberId)
      next.opponent.memberId = memberOf(d.tournamentId, next.opponent) ?? null;
    draws.push({
      tournamentExternalId: d.tournamentId,
      drawNo: d.drawNo,
      eventName: summary?.eventName ?? null,
      drawName: summary?.drawName ?? null,
      kind: view.kind,
      size: view.size,
      position: view.position,
      seed: view.seed,
      nextMatch: next,
      sourceUrl: `${tUrl(d.tournamentId)}/draw/${d.drawNo}`,
    });
  }

  // Calendar: his tournaments (all-day, multi-day) and his matches with a
  // start time, including a next match whose opponent isn't known yet.
  const records: SourceRecord[] = [];
  const nameOf = (id: string) => players.get(id)?.name ?? "?";
  for (const t of tournaments.values()) {
    if (!t.entered || t.endDate < addDays(today, -PAST_DAYS)) continue;
    const mine = draws.filter((d) => d.tournamentExternalId === t.externalId);
    const notes = mine.map((d) => {
      const n = d.nextMatch;
      const where = d.position ? ` (line ${d.position} of ${d.size})` : "";
      const nextLine =
        n?.status === "next"
          ? `: next ${n.round}${n.opponent ? ` vs ${n.opponent.name}` : n.feeders ? ` vs winner of ${n.feeders[0]} vs ${n.feeders[1]}` : ""}`
          : n?.status === "won"
            ? ": won the draw"
            : n?.status === "out"
              ? ": finished"
              : "";
      return `${d.eventName ?? d.drawName ?? "Draw"}${where}${nextLine}`;
    });
    const { category, attendance } = categorise(t.name, ctx.source.mapping);
    records.push({
      externalId: `tournament:${t.externalId}`,
      category,
      attendance,
      title: t.name,
      notes: notes.length ? notes.join("\n").slice(0, 2000) : null,
      locationName: [t.venue, t.city].filter(Boolean).join(", ") || null,
      startUtc: new Date(`${t.startDate}T00:00:00Z`),
      endUtc: new Date(`${addDays(t.endDate, 1)}T00:00:00Z`),
      allDay: true,
      sourceUrl: t.sourceUrl,
    });
  }
  const matchEvent = (
    externalId: string,
    title: string,
    start: Date,
    t: TennisTournamentRecord | undefined,
  ) => {
    const { category, attendance } = categorise(title, ctx.source.mapping);
    records.push({
      externalId,
      category,
      attendance,
      title,
      notes: t ? t.name : null,
      locationName: t ? [t.venue, t.city].filter(Boolean).join(", ") || null : null,
      startUtc: start,
      endUtc: new Date(start.getTime() + MATCH_MINUTES * 60_000),
      allDay: false,
      sourceUrl: t?.sourceUrl ?? null,
    });
  };
  for (const m of matches.values()) {
    if (!m.scheduledAt || new Date(m.scheduledAt) < from) continue;
    const mySide = m.side1.includes(selfId) ? 1 : m.side2.includes(selfId) ? 2 : 0;
    if (!mySide) continue;
    const opp = (mySide === 1 ? m.side2 : m.side1).map(nameOf).join(" / ");
    matchEvent(
      `match:${m.externalId}`,
      `Tennis ${m.round ?? "match"} vs ${opp}`,
      new Date(m.scheduledAt),
      tournaments.get(m.tournamentExternalId!),
    );
  }
  for (const d of draws) {
    const n = d.nextMatch;
    if (n?.status !== "next" || n.opponent || !n.date || !n.time) continue;
    const start = zonedToUtc(
      {
        year: +n.date.slice(0, 4),
        month: +n.date.slice(5, 7),
        day: +n.date.slice(8, 10),
        hour: +n.time.slice(0, 2),
        minute: +n.time.slice(3, 5),
        second: 0,
      },
      tz,
    );
    if (start < from) continue;
    const vs = n.feeders ? `winner of ${n.feeders[0]} vs ${n.feeders[1]}` : "opponent to be decided";
    matchEvent(
      `next:${d.tournamentExternalId}:${d.drawNo}:${n.round}`,
      `Tennis ${n.round} vs ${vs}`,
      start,
      tournaments.get(d.tournamentExternalId),
    );
  }

  const window = { from, to: null };
  return {
    records,
    window,
    warnings,
    tennis: {
      selfMemberId: selfId,
      players: [...players.values()],
      tournaments: [...tournaments.values()],
      draws,
      matches: [...matches.values()],
      window,
    },
  };
}
