import { FetchError, politeFetch } from "../http";
import { SyncError, type Adapter, type AdapterContext } from "../types";
import { addDays, localDate } from "../../domain/time";
import { drawView } from "../../domain/tennis-draw";
import { parseEventPage } from "./entry-parse";
import { normaliseTennis, toDrawRounds } from "./normalise";
import {
  isErrorPage,
  parseBracket,
  parseDrawMatches,
  parseProfile,
  parseTournament,
  parseTournamentsForYear,
  parseYears,
  profileIdFromUrl,
  type TcBracketRound,
  type TcTournament,
  type TcTournamentSummary,
} from "./parse";

// Tennis Canada's tournament site (SRC-5, plan M3.3, spikes.md SP-2). Every
// page needed is public and server-rendered, so the adapter reads them over
// plain HTTP (no browser, no login): his profile and tournaments, the draws
// of tournaments in progress or coming up, and one hop out, the recent
// results of the opponents he has met or is about to meet. Polite (SYNC-5):
// one request at a time, 2 s apart, one user agent, and a cap on requests
// per run.

const DEFAULT_BASE = "https://tc.tournamentsoftware.com";
// Per run. At 2 s apart this stays well inside the 10-minute budget.
const MAX_REQUESTS = () => Number(process.env.TENNIS_TC_MAX_REQUESTS ?? 150);
const MAX_OPPONENTS = 30;
// The quick check's draw update: his next opponents only.
const MAX_SCOPED_OPPONENTS = 4;
// Tournaments that started this recently are read in full (draws, dates).
const CURRENT_DAYS = 10;
const DETAIL_DAYS = 30;

// Tests point this at a local fake of the site; only loopback addresses are
// accepted.
export function tennisBaseUrl(): string {
  const override = process.env.TENNIS_TC_BASE_URL;
  if (!override) return DEFAULT_BASE;
  const u = new URL(override);
  if (u.hostname !== "127.0.0.1" && u.hostname !== "localhost")
    throw new Error("TENNIS_TC_BASE_URL must be a loopback address");
  return u.origin;
}

// Tests against the fake site pin "now" to the fixture's day (the site's
// pages are from 2024). Only honoured with a loopback TENNIS_TC_BASE_URL,
// so it can't affect the real site.
export function tennisTestNow(): Date | null {
  const at = process.env.TENNIS_TC_NOW;
  if (!at || !process.env.TENNIS_TC_BASE_URL) return null;
  tennisBaseUrl(); // throws unless loopback
  return new Date(at);
}
const withClock = (ctx: AdapterContext): AdapterContext => {
  const now = tennisTestNow();
  return now ? { ...ctx, now } : ctx;
};

// The player's public profile link, e.g.
// https://tc.tournamentsoftware.com/player-profile/<id>.
export function profileIdFromLink(link: unknown): string | null {
  if (typeof link !== "string") return null;
  try {
    const u = new URL(link.trim());
    if (u.hostname !== new URL(DEFAULT_BASE).hostname && u.origin !== tennisBaseUrl()) return null;
    return profileIdFromUrl(u.pathname);
  } catch {
    return null;
  }
}

export type TcOpponent = {
  memberId: string;
  profileId: string;
  name: string | null;
  club: string | null;
  tournaments: TcTournamentSummary[];
};

export type TcRaw = {
  base: string;
  self: { profileId: string; memberId: string; name: string; club: string | null };
  tournaments: TcTournamentSummary[];
  details: TcTournament[];
  draws: { tournamentId: string; drawNo: string; rounds: TcBracketRound[] }[];
  opponents: TcOpponent[];
  // Tournament player numbers of opponents read through a draw.
  tournamentPlayers: { tournamentId: string; tournamentPlayerId: string; memberId: string }[];
  // His own tournament player numbers, from entry lists (TEN-10): before
  // he's played a match there, nothing else links him to his draw line.
  selfTournamentPlayers?: { tournamentId: string; tournamentPlayerId: string }[];
  truncated: boolean;
  requests: number;
};

// Thrown when a run has used its request cap.
export class Budget extends Error {}

export class TcClient {
  private cookies = new Map<string, string>();
  requests = 0;
  constructor(
    readonly base: string,
    private readonly max: number,
  ) {}

  // Returns the page and the URL it ended on, or null for the site's error
  // pages (which come back as 200).
  async get(
    path: string,
    opts: { xhr?: boolean; form?: Record<string, string> } = {},
  ): Promise<{ html: string; url: string } | null> {
    if (this.requests >= this.max) throw new Budget();
    this.requests++;
    let res: Response;
    try {
      res = await politeFetch(new URL(path, this.base), {
        method: opts.form ? "POST" : "GET",
        body: opts.form ? new URLSearchParams(opts.form).toString() : undefined,
        headers: {
          accept: "text/html",
          ...(opts.form ? { "content-type": "application/x-www-form-urlencoded" } : {}),
          ...(opts.xhr ? { "x-requested-with": "XMLHttpRequest" } : {}),
          ...(this.cookies.size ? { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
        },
      });
    } catch (err) {
      if (err instanceof FetchError)
        throw new SyncError("The Tennis Canada site didn't answer. It will be tried again next time.");
      throw err;
    }
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
    if (res.status === 404) return null;
    if (res.status === 429 || res.status === 403)
      throw new SyncError(
        "The Tennis Canada site is refusing requests for now. It will be tried again next time.",
      );
    if (!res.ok)
      throw new SyncError("The Tennis Canada site had a problem. It will be tried again next time.");
    const html = await res.text();
    return isErrorPage(html) ? null : { html, url: res.url || new URL(path, this.base).href };
  }
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

export async function fetchTennis(ctx: AdapterContext): Promise<TcRaw> {
  const profileId = profileIdFromLink(ctx.source.config.profileUrl);
  if (!profileId)
    throw new SyncError("Set his Tennis Canada profile link in this source's settings on the Sources page.");
  const client = new TcClient(tennisBaseUrl(), MAX_REQUESTS());
  const today = localDate(ctx.now, ctx.homeTimeZone);
  const raw: TcRaw = {
    base: client.base,
    self: { profileId, memberId: "", name: "", club: null },
    tournaments: [],
    details: [],
    draws: [],
    opponents: [],
    tournamentPlayers: [],
    selfTournamentPlayers: [],
    truncated: false,
    requests: 0,
  };

  // 1. His profile and every year of tournaments. Without these the run
  //    fails; everything after is best effort within the budget.
  const profile = await client.get(`/player-profile/${profileId}`);
  if (!profile)
    throw new SyncError("That Tennis Canada profile wasn't found. Check the link on the Sources page.");
  const me = parseProfile(profile.html);
  if (!me.memberId || !me.name)
    throw new SyncError(
      "The Tennis Canada site's pages have changed, so this sync needs an update. Add matches by hand meanwhile.",
    );
  raw.self = { profileId, memberId: me.memberId, name: me.name, club: me.club };
  const scope = ctx.tennisScope ? new Set(ctx.tennisScope) : null;
  const tab = scope ? null : await client.get(`/player-profile/${profileId}/tournaments`);
  const years = tab ? parseYears(tab.html) : [];
  for (const year of years.length ? years : [Number(today.slice(0, 4))]) {
    const page = await client.get(`/player-profile/${profileId}/tournaments/${year}/TournamentsForYear`, {
      xhr: true,
    });
    if (page) raw.tournaments.push(...parseTournamentsForYear(page.html));
  }
  if (scope) raw.tournaments = raw.tournaments.filter((t) => scope.has(t.id));
  const org = orgCode([profile.html, tab?.html ?? ""]);

  try {
    // 1b. Tournaments he's entered that his profile doesn't show yet (no
    //     match played there): their draws come from the event page.
    for (const e of ctx.tennisEntries ?? []) {
      if (e.endDate < addDays(today, -CURRENT_DAYS)) continue;
      if (scope && !scope.has(e.tournamentId)) continue;
      if (e.tournamentPlayerId)
        raw.selfTournamentPlayers!.push({
          tournamentId: e.tournamentId,
          tournamentPlayerId: e.tournamentPlayerId,
        });
      const known = raw.tournaments.find((t) => t.id === e.tournamentId);
      if (known?.draws.length) continue;
      const page = await client.get(`/sport/event.aspx?id=${e.tournamentId}&event=${e.eventNo}`);
      const draws = page ? parseEventPage(page.html).draws : [];
      const summary: TcTournamentSummary = known ?? {
        id: e.tournamentId,
        name: e.name,
        venue: null,
        startDate: e.startDate,
        categories: [],
        matches: [],
        draws: [],
      };
      summary.draws.push(
        ...draws.map((d) => ({ drawNo: d.drawNo, eventName: e.eventName, drawName: d.name })),
      );
      if (!known) raw.tournaments.push(summary);
    }

    // 2. Tournaments in progress or coming up: dates and venue, and the
    //    draws he's in (for his next match).
    const recent = raw.tournaments.filter((t) => !t.startDate || t.startDate >= addDays(today, -DETAIL_DAYS));
    for (const t of recent) {
      const page = await client.get(`/tournament/${t.id}`);
      if (page) raw.details.push(parseTournament(page.html, t.id));
    }
    const current = raw.tournaments.filter(
      (t) => !t.startDate || t.startDate >= addDays(today, -CURRENT_DAYS),
    );
    for (const t of current) {
      for (const d of t.draws) {
        const page = await client.get(`/tournament/${t.id}/Draw/${d.drawNo}/GetDrawContent`, { xhr: true });
        let rounds = page ? parseBracket(page.html, t.id, d.drawNo) : [];
        if (!rounds.length) {
          // Round robin and the like: the draw's match list instead.
          const list = await client.get(`/tournament/${t.id}/Draw/${d.drawNo}/GetMatchesContent`, {
            xhr: true,
          });
          if (list)
            rounds = [{ name: d.drawName ?? "Draw", matches: parseDrawMatches(list.html, t.id, d.drawNo) }];
        }
        raw.draws.push({ tournamentId: t.id, drawNo: d.drawNo, rounds });
      }
    }

    // 3. One hop out: next opponents first, then recent opponents.
    const wanted = opponentQueue(raw, today);
    const nextOnly = scope ? wanted.filter((w) => w.tournamentId) : wanted;
    for (const w of nextOnly.slice(0, scope ? MAX_SCOPED_OPPONENTS : MAX_OPPONENTS)) {
      if (raw.opponents.some((o) => o.memberId === w.memberId)) continue;
      let page: { html: string; url: string } | null = null;
      if (w.memberId && org) page = await client.get(`/player/${org}/${b64(`base64:${w.memberId}`)}`);
      else if (w.tournamentId && w.tournamentPlayerId) {
        const tp = await client.get(`/tournament/${w.tournamentId}/player/${w.tournamentPlayerId}`);
        const id = tp?.html.match(/\/player-profile\/([0-9a-f-]{36})/i)?.[1];
        if (id) page = await client.get(`/player-profile/${id}`);
      }
      const opId = page ? (profileIdFromUrl(page.url) ?? profileIdFromUrl(page.html)) : null;
      if (!page || !opId) continue;
      const p = parseProfile(page.html);
      if (!p.memberId || p.memberId === me.memberId) continue;
      if (w.tournamentId && w.tournamentPlayerId)
        raw.tournamentPlayers.push({
          tournamentId: w.tournamentId,
          tournamentPlayerId: w.tournamentPlayerId,
          memberId: p.memberId,
        });
      const op: TcOpponent = {
        memberId: p.memberId,
        profileId: opId,
        name: p.name,
        club: p.club,
        tournaments: [],
      };
      const year = Number(today.slice(0, 4));
      for (const y of [year, year - 1]) {
        const yp = await client.get(`/player-profile/${opId}/tournaments/${y}/TournamentsForYear`, {
          xhr: true,
        });
        if (yp) op.tournaments.push(...parseTournamentsForYear(yp.html));
      }
      raw.opponents.push(op);
    }
  } catch (err) {
    if (!(err instanceof Budget)) throw err;
    raw.truncated = true;
  }
  raw.requests = client.requests;
  return raw;
}

function orgCode(pages: string[]): string | null {
  for (const html of pages) {
    const m = html.match(/OrganizationCode=([0-9a-f-]{36})/i);
    if (m) return m[1].toLowerCase();
  }
  return null;
}

type Wanted = { memberId: string | null; tournamentId: string | null; tournamentPlayerId: string | null };

// Who to read one hop out, most useful first: his next opponents (for the
// prediction), then everyone he's played, most recent first.
export function opponentQueue(
  raw: Pick<TcRaw, "self" | "tournaments" | "draws" | "selfTournamentPlayers">,
  today: string,
): Wanted[] {
  const out: Wanted[] = [];
  const seen = new Set<string>();
  const add = (w: Wanted) => {
    const key = w.memberId ?? `${w.tournamentId}:${w.tournamentPlayerId}`;
    if (seen.has(key) || w.memberId === raw.self.memberId) return;
    seen.add(key);
    out.push(w);
  };
  const selfTps = new Set(
    raw.tournaments.flatMap((t) =>
      t.matches.flatMap((m) =>
        m.sides.flatMap((s) =>
          s.players
            .filter((p) => p.memberId === raw.self.memberId)
            .map((p) => `${t.id}:${p.tournamentPlayerId}`),
        ),
      ),
    ),
  );
  for (const x of raw.selfTournamentPlayers ?? []) selfTps.add(`${x.tournamentId}:${x.tournamentPlayerId}`);
  for (const d of raw.draws) {
    const tps = new Set(
      [...selfTps].filter((k) => k.startsWith(`${d.tournamentId}:`)).map((k) => k.split(":")[1]),
    );
    const view = drawView(toDrawRounds(d.rounds), { memberId: raw.self.memberId, tournamentPlayerIds: tps });
    if (view.next.status === "next" && view.next.opponent)
      add({
        memberId: view.next.opponent.memberId,
        tournamentId: d.tournamentId,
        tournamentPlayerId: view.next.opponent.tournamentPlayerId,
      });
  }
  const yearAgo = addDays(today, -366);
  const matches = raw.tournaments
    .flatMap((t) => t.matches)
    .filter((m) => m.sides.every((s) => s.players.length === 1))
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  for (const recentOnly of [true, false]) {
    for (const m of matches) {
      if (recentOnly && (m.date ?? "") < yearAgo) continue;
      for (const s of m.sides)
        for (const p of s.players)
          if (p.memberId) add({ memberId: p.memberId, tournamentId: null, tournamentPlayerId: null });
    }
  }
  return out;
}

export const tennisTcAdapter: Adapter<TcRaw> = {
  kind: "tennis_tc",
  label: "Tennis Canada tournaments",
  credentialKinds: [],
  fetchRaw: (ctx) => fetchTennis(withClock(ctx)),
  normalise: (raw, ctx) => normaliseTennis(raw, withClock(ctx)),
};
