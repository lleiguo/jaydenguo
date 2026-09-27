import { parse, type HTMLElement } from "node-html-parser";

// Parsers for the pages the tournament-entry jobs read (spikes.md SP-7):
// the public tournament search, a tournament's event list and one event's
// page (its entry list, with "Maindraw" / "Reserve list N" per player, and
// its draws once published). Pure and whitelisted like parse.ts: only
// tournament and event facts, and on entry lists only the status, the
// tournament player number and the name (to find him).

export type TcSearchResult = {
  id: string;
  name: string;
  venue: string | null;
  startDate: string | null;
  endDate: string | null;
  categories: string[];
  // The site's own entry link, when online entry is open.
  entryOpen: boolean;
};

export type TcEvent = { eventNo: string; name: string };

export type TcEntryStatus = { kind: "main_draw" } | { kind: "reserve"; position: number | null };

export type TcEntryRow = {
  status: TcEntryStatus | null;
  // Tournament player numbers (two for doubles).
  tournamentPlayerIds: string[];
  names: string[];
};

export type TcEventPage = {
  entries: TcEntryRow[];
  draws: { drawNo: string; name: string | null; size: number | null }[];
};

const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const clean = (s: string | null | undefined) => {
  const t = (s ?? "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
  return t || null;
};
const text = (el: HTMLElement | null | undefined) => (el ? clean(el.text) : null);
const param = (href: string | undefined | null, name: string) =>
  (href ?? "").replace(/&amp;/g, "&").match(new RegExp(`[?&]${name}=([^&#]+)`, "i"))?.[1] ?? null;

// /find/tournament/DoSearch (fragment): one page of results, 20 at most.
export function parseSearchResults(html: string): TcSearchResult[] {
  const root = parse(html);
  const out: TcSearchResult[] = [];
  const seen = new Set<string>();
  for (const media of root.querySelectorAll(".media")) {
    const link = media.querySelector("a.media__link");
    const id = link?.getAttribute("href")?.match(GUID)?.[0].toLowerCase();
    if (!link || !id || seen.has(id)) continue;
    seen.add(id);
    const times = media.querySelectorAll(".media__subheading--muted time");
    out.push({
      id,
      name: text(link.querySelector(".nav-link__value") ?? link) ?? "Tournament",
      venue: text(media.querySelector(".media__subheading:not(.media__subheading--muted) .nav-link__value")),
      startDate: times[0]?.getAttribute("datetime")?.slice(0, 10) ?? null,
      endDate: (times[1] ?? times[0])?.getAttribute("datetime")?.slice(0, 10) ?? null,
      categories: media
        .querySelectorAll(".tag")
        .map((t) => text(t)!)
        .filter(Boolean),
      entryOpen: !!media.querySelector('a[href*="onlineentry"], a[href*="individual-entry"]'),
    });
  }
  return out;
}

// /sport/events.aspx?id=<tournament>: every event (e.g. "U10 (Orange Ball)").
export function parseEventList(html: string): TcEvent[] {
  const out: TcEvent[] = [];
  const seen = new Set<string>();
  for (const a of parse(html).querySelectorAll('a[href*="event.aspx"]')) {
    const eventNo = param(a.getAttribute("href"), "event");
    const name = text(a);
    if (!eventNo || !name || seen.has(eventNo)) continue;
    seen.add(eventNo);
    out.push({ eventNo, name });
  }
  return out;
}

// "Maindraw", "Main draw", "Reserve list 3", "Reserve" → a status.
export function entryStatusOf(label: string | null): TcEntryStatus | null {
  const l = (label ?? "").toLowerCase();
  if (/^main\s*draw/.test(l)) return { kind: "main_draw" };
  if (/reserve|alternate/.test(l)) {
    const n = l.match(/(\d+)/);
    return { kind: "reserve", position: n ? Number(n[1]) : null };
  }
  return null;
}

// /sport/event.aspx?id=<tournament>&event=<n>: the entry list and, once
// published, the event's draws.
export function parseEventPage(html: string): TcEventPage {
  const page: TcEventPage = { entries: [], draws: [] };
  for (const table of parse(html).querySelectorAll("table.ruler")) {
    const caption = text(table.querySelector("caption")) ?? "";
    const rows = table.querySelectorAll("tbody tr");
    if (/^entries/i.test(caption)) {
      for (const row of rows) {
        const cells = row.querySelectorAll("td");
        const links = row.querySelectorAll('a[href*="player.aspx"], a[href*="/player/"]');
        if (!links.length) continue;
        page.entries.push({
          status: entryStatusOf(text(cells[0])),
          tournamentPlayerIds: links
            .map(
              (a) =>
                param(a.getAttribute("href"), "player") ??
                a.getAttribute("href")?.match(/\/player\/(\d+)/)?.[1],
            )
            .filter((x): x is string => !!x),
          names: links.map((a) => text(a)!).filter(Boolean),
        });
      }
    } else {
      for (const row of rows) {
        const a = row.querySelector('a[href*="draw.aspx"], a[href*="/draw/"]');
        const drawNo =
          param(a?.getAttribute("href"), "draw") ?? a?.getAttribute("href")?.match(/\/draw\/(\d+)/i)?.[1];
        if (!drawNo) continue;
        const size = Number(text(row.querySelectorAll("td")[1]));
        page.draws.push({ drawNo, name: text(a), size: Number.isFinite(size) && size > 0 ? size : null });
      }
    }
  }
  return page;
}
