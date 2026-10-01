import { parse, type HTMLElement } from "node-html-parser";

// Parsers for the Tennis Canada tournament site's pages (spikes.md SP-2).
// Every page is server-rendered HTML with the same "match" markup. These
// functions read only what TEN-2..7 need (names, member IDs, results,
// dates, rounds, venues) and nothing else: no photos, contacts, addresses
// of people, or other profile details. Pure, so they're tested from
// fixtures.

export type TcPlayerRef = {
  // The Tennis Canada member number: the one ID that holds across
  // tournaments. Null when the page doesn't give it (e.g. a bye).
  memberId: string | null;
  name: string;
  // The player's number inside one tournament (links and draws use it).
  tournamentPlayerId: string | null;
  // Draw seeding, printed after the name as "[1]".
  seed: string | null;
};

export type TcSide = { players: TcPlayerRef[]; won: boolean };

export type TcMatch = {
  tournamentId: string | null;
  drawNo: string | null;
  eventName: string | null;
  drawName: string | null;
  round: string | null;
  sides: [TcSide, TcSide];
  // Games per set, in side order.
  sets: [number, number][];
  // walkover, retired, etc. as the site labels it.
  note: string | null;
  // Local date and time as printed: "2026-09-20" and "12:00" (24 h).
  date: string | null;
  time: string | null;
  // In a draw: the site's match number.
  matchNo: string | null;
};

export type TcTournamentSummary = {
  id: string;
  name: string;
  venue: string | null;
  startDate: string | null;
  categories: string[];
  matches: TcMatch[];
  // Draws he's in, as (draw number, event name, draw name).
  draws: { drawNo: string; eventName: string | null; drawName: string | null }[];
};

export type TcTournament = {
  id: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  venue: string | null;
  city: string | null;
  region: string | null;
  entryDeadline: string | null;
  entryOpens: string | null;
  categories: string[];
};

export type TcProfile = {
  memberId: string | null;
  name: string | null;
  // The association group the site shows under the name (club or region).
  club: string | null;
  // Years the Tournaments tab offers, newest first.
  years: number[];
};

export type TcBracketRound = { name: string; matches: TcMatch[] };

const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const clean = (s: string | undefined | null) => {
  const t = (s ?? "")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t || null;
};
const text = (el: HTMLElement | null | undefined) => (el ? clean(decode(el.text)) : null);

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

const guidIn = (href: string | undefined) => href?.match(GUID)?.[0].toLowerCase() ?? null;
const param = (href: string | undefined, name: string) => {
  const m = decode(href ?? "").match(new RegExp(`[?&]${name}=([^&#]+)`, "i"));
  return m ? m[1] : null;
};

// The site's error pages (e.g. 404) come back with status 200.
export function isErrorPage(html: string): boolean {
  return /returnUrl=%2Ferror%2F\d{3}/i.test(html) || /<title>\s*(Error|Page not found)/i.test(html);
}

// "Sun 2026-09-20 12:00 PM" or "Sun 2026-09-20" → date and 24 h time.
export function parseWhen(s: string | null): { date: string | null; time: string | null } {
  const m = s?.match(/(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM)?)?/i);
  if (!m) return { date: null, time: null };
  if (!m[2]) return { date: m[1], time: null };
  let h = Number(m[2]);
  const ap = m[4]?.toUpperCase();
  if (ap === "PM" && h < 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  return { date: m[1], time: `${String(h).padStart(2, "0")}:${m[3]}` };
}

function parseMatch(
  el: HTMLElement,
  ctx: {
    tournamentId: string | null;
    drawNo: string | null;
    eventName: string | null;
    drawName: string | null;
  },
): TcMatch {
  const round = text(el.querySelector(".match__header-title-item .nav-link__value"));
  const rows = el.querySelectorAll(".match__row");
  // Member IDs come from the head-to-head link: T1P1, T1P2 (doubles), T2P1...
  const h2h = el.querySelector("a.match__btn-h2h")?.getAttribute("href");
  const sides = rows.slice(0, 2).map((row, i): TcSide => {
    const links = row.querySelectorAll('a[href*="player.aspx"], a[href*="/player/"]');
    const players = links.map((a, j) => {
      const full = text(a.querySelector(".nav-link__value") ?? a) ?? "";
      const seed = full.match(/\s*\[([0-9A-Za-z/]{1,6})\]$/);
      return {
        memberId: param(h2h, `T${i + 1}P${j + 1}MemberID`),
        name: seed ? full.slice(0, seed.index).trim() : full,
        tournamentPlayerId: a.getAttribute("data-player-id") ?? param(a.getAttribute("href"), "player"),
        seed: seed?.[1] ?? null,
      };
    });
    return { players: players.filter((p) => p.name), won: row.classList.contains("has-won") };
  });
  while (sides.length < 2) sides.push({ players: [], won: false });
  const sets: [number, number][] = [];
  for (const ul of el.querySelectorAll(".match__result ul.points")) {
    const cells = ul.querySelectorAll("li.points__cell").map((li) => Number(clean(li.text)));
    if (cells.length >= 2 && cells.every((n) => Number.isFinite(n))) sets.push([cells[0], cells[1]]);
  }
  const note = text(el.querySelector(".match__message"));
  let when = { date: null as string | null, time: null as string | null };
  for (const item of el.querySelectorAll(".match__footer-list-item")) {
    const w = parseWhen(text(item));
    if (w.date) {
      when = w;
      break;
    }
  }
  const idAttr = el.parentNode?.getAttribute?.("id") ?? "";
  return {
    ...ctx,
    round,
    sides: [sides[0], sides[1]],
    sets,
    note,
    date: when.date,
    time: when.time,
    matchNo: idAttr.match(/^match_(\d+)$/)?.[1] ?? null,
  };
}

// /player-profile/<id>: name, member number and club.
export function parseProfile(html: string): TcProfile {
  const root = parse(html);
  const heading = root.querySelector("h2.media__title--large");
  const fav = root.querySelector("button.js-userlisttoggle[data-uldata3]");
  const years = parseYears(html);
  return {
    memberId: clean(fav?.getAttribute("data-uldata3")),
    name: text(heading?.querySelector(".nav-link__value")),
    club: text(root.querySelector("#mediaContentSubinfo .media__subheading .nav-link__value")),
    years,
  };
}

// The years offered on /player-profile/<id>/tournaments, newest first.
export function parseYears(html: string): number[] {
  const years = new Set<number>();
  for (const m of html.matchAll(/\/tournaments\/(\d{4})\/TournamentsForYear/g)) years.add(Number(m[1]));
  return [...years].sort((a, b) => b - a);
}

// /player-profile/<id>/tournaments/<year>/TournamentsForYear: one player's
// tournaments that year, each with the events, draws and matches they
// played.
export function parseTournamentsForYear(html: string): TcTournamentSummary[] {
  const root = parse(html);
  const out: TcTournamentSummary[] = [];
  for (const media of root.querySelectorAll(".media")) {
    const link = media.querySelector("a.media__link[href*='tournament']");
    const id = guidIn(link?.getAttribute("href"));
    if (!link || !id) continue;
    const li = media.closest("li.list__item");
    if (!li) continue;
    const subheadings = media.querySelectorAll(
      ".media__subheading:not(.media__subheading--muted) .nav-link__value",
    );
    const summary: TcTournamentSummary = {
      id,
      name: text(link.querySelector(".nav-link__value") ?? link) ?? "Tournament",
      venue: text(subheadings[0]),
      startDate: media.querySelector("time")?.getAttribute("datetime")?.slice(0, 10) ?? null,
      categories: media
        .querySelectorAll(".tag")
        .map((t) => text(t)!)
        .filter(Boolean),
      matches: [],
      draws: [],
    };
    // Walk the rest of the card in order: event headings (h4), draw
    // headings (h5) and match lists.
    let eventName: string | null = null;
    let draw: { drawNo: string | null; drawName: string | null } = { drawNo: null, drawName: null };
    const walk = (node: HTMLElement) => {
      for (const child of node.childNodes) {
        if (!(child as HTMLElement).tagName) continue;
        const el = child as HTMLElement;
        if (el.classList.contains("media")) continue;
        if (el.classList.contains("module-divider")) {
          const a = el.querySelector("a[href*='draw']");
          if (el.tagName === "H4" && !a) {
            eventName = text(el)?.replace(/^[^:]{1,20}:\s*/, "") ?? null;
          } else {
            const drawNo = param(a?.getAttribute("href"), "draw");
            draw = { drawNo, drawName: text(el) };
            if (drawNo) summary.draws.push({ drawNo, eventName, drawName: draw.drawName });
          }
        } else if (el.classList.contains("match")) {
          summary.matches.push(parseMatch(el, { tournamentId: id, ...draw, eventName }));
        } else walk(el);
      }
    };
    walk(li);
    out.push(summary);
  }
  return out;
}

// /tournament/<id>: name, dates, venue and entry deadline.
export function parseTournament(html: string, id: string): TcTournament {
  const root = parse(html);
  const name = text(root.querySelector(".hgroup__heading")) ?? "Tournament";
  const dated: Record<string, string> = {};
  for (const item of root.querySelectorAll(".list__item")) {
    const label = text(item.querySelector(".list__value"))?.toLowerCase();
    const dt = item.querySelector("time")?.getAttribute("datetime");
    if (label && dt) dated[label] = dt.slice(0, 10);
  }
  let venue: string | null = null;
  let city: string | null = null;
  let region: string | null = null;
  for (const mod of root.querySelectorAll(".module")) {
    if (text(mod.querySelector(".module__title-main")) !== "Venue") continue;
    // The title, not the "Route" button above it.
    venue = text(
      mod.querySelector(".media__title .nav-link__value") ?? mod.querySelector(".nav-link__value"),
    );
    city = text(mod.querySelector(".p-locality"));
    region = text(mod.querySelector(".p-region"));
    break;
  }
  const start = dated["start tournament"] ?? null;
  const end = dated["end of tournament"] ?? start;
  return {
    id,
    name,
    startDate: start,
    endDate: end && start && end < start ? start : end,
    venue,
    city,
    region,
    entryDeadline: dated["closing deadline"] ?? dated["entry deadline"] ?? null,
    entryOpens: dated["entry opens"] ?? null,
    categories: root
      .querySelectorAll(".hgroup .tag, .tag--mono")
      .map((t) => text(t)!)
      .filter(Boolean),
  };
}

// /tournament/<id>/Draw/<n>/GetDrawContent: an elimination-style bracket,
// round by round, matches in draw order. Round robin draws have no bracket
// rounds and give [].
export function parseBracket(html: string, tournamentId: string, drawNo: string): TcBracketRound[] {
  const root = parse(html);
  const names = root.querySelectorAll(".js-subheading").map((h) => text(h) ?? "");
  return root.querySelectorAll(".bracket-round__item").map((round, i) => ({
    name: names[i] ?? `Round ${i + 1}`,
    matches: round.querySelectorAll(".match").map((m) => ({
      ...parseMatch(m, { tournamentId, drawNo, eventName: null, drawName: null }),
      round: names[i] ?? null,
    })),
  }));
}

// /tournament/<id>/Draw/<n>/GetMatchesContent: every match in one draw,
// in schedule order.
export function parseDrawMatches(html: string, tournamentId: string, drawNo: string): TcMatch[] {
  return parse(html)
    .querySelectorAll(".match")
    .map((m) => parseMatch(m, { tournamentId, drawNo, eventName: null, drawName: null }));
}

// The profile GUID in a redirected /player/<org>/<member> URL.
export const profileIdFromUrl = (url: string) =>
  url.match(/\/player-profile\/([0-9a-f-]{36})/i)?.[1].toLowerCase() ?? null;
