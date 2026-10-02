import { z } from "zod";
import type { Perspective, TennisMatch } from "@/domain/tennis";
import { loadPlayer, loadResults, loadTennis, loadTournament, predictAgainst } from "../../tennis/load";
import { tennisOverview } from "../../tennis/overview";
import { shapeDraw, shapePrediction } from "./shape";
import { dayOf, has, problem, type Tool } from "./types";

const input = z.object({
  view: z
    .enum(["upcoming", "results", "player", "tournament"])
    .describe(
      "upcoming: tournaments he is in or could enter, and his next matches. results: his past matches and win–loss. player: one opponent (needs `player`). tournament: one tournament (needs `tournament`).",
    ),
  player: z.string().optional().describe("An opponent's name, or part of it"),
  tournament: z.string().optional().describe("A tournament's name, or part of it"),
  season: z.number().int().optional().describe("A calendar year, for results"),
});

const MAX_MATCHES = 15;

const shapeMatch = (x: { match: TennisMatch; view: Perspective }) => ({
  date: x.match.matchDate,
  tournament: x.match.tournamentName,
  event: x.match.eventName,
  round: x.match.round,
  opponents: x.view.opponents.map((p) => p.name),
  partner: x.view.partner?.name,
  result: x.view.result ?? (x.match.outcome === "scheduled" ? "scheduled" : undefined),
  score: x.view.score,
});

// TOOL-3: the primary person's tennis (TOOL-16).
export const tennisTool: Tool<z.infer<typeof input>> = {
  name: "tennis",
  kind: "hub",
  label: "Tennis",
  description:
    "Tennis for the family's tournament player only (the first name in People): tournaments and entries, draws and next opponents with a win estimate, past results, one opponent's record against him, one tournament's matches.",
  input,
  async run(ctx, q) {
    if (q.view === "upcoming") {
      const o = await tennisOverview(ctx.db);
      const entry = (e: (typeof o.found)[number]) => ({
        tournament: e.tournamentName,
        event: e.eventName,
        start: dayOf(e.startDate),
        status: e.status,
        entryDeadline: e.entryDeadline,
      });
      return {
        player: o.selfName,
        nextMatches: o.nextMatches.map((n) => ({
          tournament: n.tournament.name,
          ...shapeDraw(n.draw, n.prediction),
        })),
        tournaments: o.upcomingRows.map((r) => ({
          name: r.name,
          start: dayOf(r.startDate),
          end: dayOf(r.endDate),
          venue: r.venue,
          driveMinutes: r.driveMinutes,
          events: r.events,
          status: r.status.label,
          draws: r.draws.map((d) =>
            shapeDraw(d, r.drawPredictions.find((p) => p.drawId === d.id)?.prediction ?? null),
          ),
        })),
        couldEnter: o.found.map(entry),
        entryNotOpenYet: o.notOpen.slice(0, 5).map(entry),
        lastUpdated: o.lastUpdated?.slice(0, 10),
      };
    }

    if (q.view === "results") {
      const r = await loadResults(ctx.db, q.season ?? null);
      return {
        season: r.season ?? "all",
        seasons: r.seasons,
        record: r.total,
        singlesRecord: r.singles,
        matches: r.rows.slice(0, MAX_MATCHES).map(shapeMatch),
        more: r.rows.length > MAX_MATCHES || undefined,
      };
    }

    if (q.view === "player") {
      if (!q.player) return problem("give the opponent's name in `player`");
      const data = await loadTennis(ctx.db);
      const found = [...data.players.values()].filter((p) => !p.isSelf && has(p.name, q.player!));
      if (!found.length) return problem(`no opponent called ${q.player} in his matches or draws`);
      if (found.length > 1)
        return { severalMatch: found.slice(0, 6).map((p) => ({ name: p.name, club: p.club })) };
      const p = await loadPlayer(ctx.db, found[0].key);
      if (!p) return problem("that player is no longer listed");
      const played = p.form.lastYear.wins + p.form.lastYear.losses;
      return {
        name: p.player.name,
        club: p.player.club,
        headToHead: {
          hisRecordAgainstThem: p.h2h.record,
          meetings: p.h2h.meetings.slice(0, 5).map(shapeMatch),
        },
        theirLast10: p.form.last.map((x) => ({
          date: x.match.matchDate,
          result: x.view.result,
          score: x.view.score,
        })),
        theirLast12Months: {
          ...p.form.lastYear,
          winPercent: played ? Math.round(p.form.winRate! * 100) : undefined,
        },
        prediction: shapePrediction(predictAgainst(p.data, found[0].key)),
        upcomingAgainstHim: p.upcoming.map((u) => ({ tournament: u.tournament.name, ...shapeDraw(u.draw) })),
      };
    }

    if (!q.tournament) return problem("give the tournament's name in `tournament`");
    const data = await loadTennis(ctx.db);
    // The nearest to today first: upcoming and in progress, then the latest past one.
    const found = data.tournaments
      .filter((t) => has(t.name, q.tournament!))
      .sort((a, b) =>
        a.when === "past" && b.when === "past"
          ? b.startDate.localeCompare(a.startDate)
          : a.when === "past"
            ? 1
            : b.when === "past"
              ? -1
              : a.startDate.localeCompare(b.startDate),
      );
    if (!found.length) return problem(`no tournament called ${q.tournament}`);
    const t = await loadTournament(ctx.db, found[0].id);
    if (!t) return problem("that tournament is no longer listed");
    return {
      name: t.tournament.name,
      start: dayOf(t.tournament.startDate),
      end: dayOf(t.tournament.endDate),
      venue: t.tournament.venue,
      city: t.tournament.city,
      when: t.tournament.when,
      entryStatus: t.tournament.entryStatus,
      record: t.tournament.record,
      draws: t.tournament.draws.map((d) =>
        shapeDraw(d, d.opponentKey ? predictAgainst(t.data, d.opponentKey) : null),
      ),
      matches: t.matches.map(shapeMatch),
      otherMatches: found.slice(1, 4).map((x) => x.name),
    };
  },
};
