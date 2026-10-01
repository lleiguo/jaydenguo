import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fetchTennis, profileIdFromLink } from "@/adapters/tennis-tc";
import { normaliseTennis } from "@/adapters/tennis-tc/normalise";
import {
  isErrorPage,
  parseBracket,
  parseDrawMatches,
  parseProfile,
  parseTournament,
  parseTournamentsForYear,
  parseYears,
} from "@/adapters/tennis-tc/parse";
import { SyncError, type AdapterContext } from "@/adapters/types";
import { createFakeTc, PLANTED_PRIVATE, TC_FIXTURE, TC_NOW, TC_PROFILE_URL } from "../e2e/support/fake-tc";

// Plan M3.3: the tennis_tc parsers on the scrubbed fixtures, and the whole
// crawl against a local fake of the site (tests/e2e/support/fake-tc.ts).

const page = (name: string) => readFileSync(`tests/fixtures/tennis-tc/${name}`, "utf8");
const { self, currentTournament, pastTournament } = TC_FIXTURE;

describe("tennis_tc parsers", () => {
  it("reads his member number, name and club from the profile, and nothing else", () => {
    const html = page("profile.html").replace(
      "</body>",
      `<span class="p-tel">${PLANTED_PRIVATE[0]}</span></body>`,
    );
    const profile = parseProfile(html);
    expect(profile).toMatchObject({ memberId: self.memberId, name: "Sam Fixture", club: "Fixture Courts 1" });
    expect(JSON.stringify(profile)).not.toContain(PLANTED_PRIVATE[0]);
    expect(parseYears(page("profile-tournaments.html"))).toEqual([2024, 2023]);
  });

  it("reads a year of tournaments with their matches and draws", () => {
    const year = parseTournamentsForYear(page("year-current.html"));
    expect(year).toHaveLength(8);
    const current = year.find((t) => t.id === currentTournament)!;
    expect(current).toMatchObject({ name: "Fixture Open 11", startDate: "2024-09-26" });
    expect(current.draws).toEqual([
      { drawNo: "15", eventName: "Fixture Event 13", drawName: "Fixture Event 13" },
    ]);
    // A bye: him on one side, nobody on the other.
    expect(current.matches[0].sides[1].players).toEqual([]);
  });

  it("reads a tournament's dates, venue and entry deadline", () => {
    expect(parseTournament(page("tournament-current.html"), currentTournament)).toMatchObject({
      startDate: "2024-09-26",
      endDate: "2024-09-30",
      venue: "Fixture Courts 19",
      entryDeadline: "2024-09-17",
    });
  });

  it("reads a knockout bracket in draw order, and other draw shapes", () => {
    const rounds = parseBracket(page("draw-current.html"), currentTournament, "15");
    expect(rounds.map((r) => [r.name, r.matches.length])).toEqual([
      ["Round of 16", 8],
      ["Quarter final", 4],
      ["Semi final", 2],
      ["Final", 1],
    ]);
    // Seeds are split off the name, so names match across pages.
    const first = rounds[0].matches[0].sides[0].players[0];
    expect(first).toMatchObject({ name: "Sam Fixture", seed: "1" });
    expect(parseBracket(page("draw-compass.html"), pastTournament, "38").length).toBeGreaterThan(4);
    expect(parseDrawMatches(page("draw-current-matches.html"), currentTournament, "15")).toHaveLength(15);
  });

  it("recognises the site's error page, which comes back with status 200", () => {
    expect(isErrorPage(page("profile.html"))).toBe(false);
    expect(isErrorPage('<html><body><a href="/user?returnUrl=%2Ferror%2F404">x</a></body></html>')).toBe(
      true,
    );
  });

  it("accepts only profile links on the tournament site", () => {
    expect(profileIdFromLink(`https://tc.tournamentsoftware.com/player-profile/${self.profileId}`)).toBe(
      self.profileId,
    );
    expect(profileIdFromLink(`https://example.com/player-profile/${self.profileId}`)).toBeNull();
    expect(profileIdFromLink("not a link")).toBeNull();
    expect(profileIdFromLink(undefined)).toBeNull();
  });
});

describe("tennis_tc crawl", () => {
  let server: Server;
  let base: string;
  const requests: string[] = [];
  const ctx = (config: Record<string, unknown>): AdapterContext => ({
    source: { id: "s1", name: "Tennis", config, mapping: { default: "tennis" } },
    credential: null,
    now: TC_NOW,
    homeTimeZone: "America/Toronto",
  });

  beforeAll(async () => {
    process.env.FETCH_MIN_GAP_MS = "0";
    server = createFakeTc({ requests });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.TENNIS_TC_BASE_URL = base;
  });
  afterAll(() => {
    server.close();
    delete process.env.TENNIS_TC_BASE_URL;
    delete process.env.FETCH_MIN_GAP_MS;
  });

  it("reads his tournaments, draws and opponents, and works out his next match", async () => {
    const c = ctx({ profileUrl: TC_PROFILE_URL(base) });
    const raw = await fetchTennis(c);
    expect(raw.requests).toBe(46);
    expect(raw.truncated).toBe(false);
    expect(raw.opponents.map((o) => o.memberId).sort()).toEqual(
      TC_FIXTURE.opponents.map((o) => o.memberId).sort(),
    );

    const batch = normaliseTennis(raw, c);
    const tennis = batch.tennis!;
    expect(batch.warnings).toEqual([]);
    expect(tennis.selfMemberId).toBe(self.memberId);
    expect(tennis.players.filter((p) => p.isSelf)).toHaveLength(1);
    expect(tennis.tournaments.filter((t) => t.entered)).toHaveLength(16);
    expect(tennis.matches.filter((m) => [...m.side1, ...m.side2].includes(self.memberId))).toHaveLength(48);

    const current = tennis.draws.find((d) => d.tournamentExternalId === currentTournament)!;
    expect(current).toMatchObject({ kind: "bracket", size: 16, position: 1, seed: "1" });
    expect(current.nextMatch).toMatchObject({
      status: "next",
      round: "Semi final",
      opponent: { name: "Casey Brackenridge", memberId: TC_FIXTURE.opponents[2].memberId },
      date: "2024-09-29",
      time: "09:00",
    });
    expect(tennis.draws.find((d) => d.tournamentExternalId === pastTournament)).toMatchObject({
      kind: "other",
      nextMatch: { status: "out" },
    });

    // Calendar: his recent tournaments all-day, his matches with a time.
    const tournaments = batch.records.filter((r) => r.externalId.startsWith("tournament:"));
    expect(tournaments.every((r) => r.allDay && r.category === "tennis")).toBe(true);
    expect(tournaments.find((r) => r.externalId === `tournament:${currentTournament}`)?.notes).toContain(
      "next Semi final vs Casey Brackenridge",
    );
    const semi = batch.records.find((r) => r.title === "Tennis Semi final vs Casey Brackenridge")!;
    expect(semi.startUtc.toISOString()).toBe("2024-09-29T13:00:00.000Z");

    // Nothing planted on the profile page is kept.
    const everything = JSON.stringify({ raw, batch });
    for (const s of PLANTED_PRIVATE) expect(everything).not.toContain(s);
  });

  it("stops at the request cap and says so", async () => {
    process.env.TENNIS_TC_MAX_REQUESTS = "12";
    try {
      const c = ctx({ profileUrl: TC_PROFILE_URL(base) });
      const raw = await fetchTennis(c);
      expect(raw.requests).toBe(12);
      expect(raw.truncated).toBe(true);
      expect(normaliseTennis(raw, c).warnings.join(" ")).toContain("page limit");
    } finally {
      delete process.env.TENNIS_TC_MAX_REQUESTS;
    }
  });

  it("fails plainly without a profile link or with a wrong one", async () => {
    await expect(fetchTennis(ctx({}))).rejects.toThrow(SyncError);
    await expect(
      fetchTennis(ctx({ profileUrl: `${base}/player-profile/00000000-0000-0000-0000-000000000000` })),
    ).rejects.toThrow("wasn't found");
  });
});
