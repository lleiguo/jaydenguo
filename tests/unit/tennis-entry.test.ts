import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  entryStatusOf,
  parseEventList,
  parseEventPage,
  parseSearchResults,
} from "@/adapters/tennis-tc/entry-parse";
import {
  chooseEntries,
  DEFAULT_ENTRY_PREFS,
  entryPrefsOf,
  fallbackRadiusKm,
  findSelfRow,
  nameTokens,
  pickEvent,
  searchRadiusKm,
  statusFromList,
} from "@/domain/tennis-entry";
import { minutesOf, routesDriveTimer } from "@/server/tennis/drive";
import { entrySettingsOf } from "@/server/tennis/entries";

// TEN-9..11: tournament search, entry lists and the entry rules.

const page = (f: string) => readFileSync(`tests/fixtures/tennis-tc/entries/${f}`, "utf8");

describe("entry page parsers", () => {
  it("reads search results: id, name, venue, dates, tags and whether entry is open", () => {
    const r = parseSearchResults(page("search.html"));
    expect(r).toHaveLength(3);
    expect(r[0]).toEqual({
      id: "a0000000-0000-4000-8000-00000000000a",
      name: "Fixture Rookie Open",
      venue: "Fixture Tennis Club",
      startDate: "2024-10-05",
      endDate: "2024-10-06",
      categories: ["Rookie"],
      entryOpen: true,
    });
  });

  it("reads a tournament's events", () => {
    expect(parseEventList(page("events-a.html"))).toEqual([
      { eventNo: "5", name: "U10 (Orange Ball)" },
      { eventNo: "6", name: "U9 Orange Boys" },
      { eventNo: "7", name: "U9 Orange Girls" },
    ]);
  });

  it("reads an entry list's status per player, and the draws once published", () => {
    const p = parseEventPage(page("event-current.html"));
    expect(p.draws).toEqual([{ drawNo: "15", name: "Fixture Event 13", size: 16 }]);
    expect(p.entries[0]).toEqual({
      status: { kind: "main_draw" },
      tournamentPlayerIds: ["1021"],
      names: ["Fixture, Sam"],
    });
    const a = parseEventPage(page("event-a6.html"));
    expect(a.draws).toEqual([]);
    expect(a.entries.map((e) => e.status)).toEqual([
      { kind: "main_draw" },
      { kind: "main_draw" },
      { kind: "reserve", position: 1 },
    ]);
  });

  it("understands the site's status labels", () => {
    expect(entryStatusOf("Maindraw")).toEqual({ kind: "main_draw" });
    expect(entryStatusOf("Reserve list 12")).toEqual({ kind: "reserve", position: 12 });
    expect(entryStatusOf("Alternate")).toEqual({ kind: "reserve", position: null });
    expect(entryStatusOf("")).toBeNull();
  });
});

describe("entry rules", () => {
  it("picks his event: orange, not girls or doubles, U9 before U10", () => {
    const events = parseEventList(page("events-a.html"));
    expect(pickEvent(events, DEFAULT_ENTRY_PREFS)?.eventNo).toBe("6");
    expect(pickEvent([{ name: "U10 (Orange Ball)" }], DEFAULT_ENTRY_PREFS)?.name).toBe("U10 (Orange Ball)");
    expect(pickEvent([{ name: "RT 9 - 12 (Green)" }], DEFAULT_ENTRY_PREFS)).toBeNull();
    expect(pickEvent([{ name: "U9 Orange Doubles" }], DEFAULT_ENTRY_PREFS)).toBeNull();
    expect(pickEvent([{ name: "U9 Orange Mixed Doubles" }], DEFAULT_ENTRY_PREFS)).toBeNull();
    // Boys and girls together in one singles event (Rising Stars).
    expect(
      pickEvent(
        [{ name: "BS 10 - Green" }, { name: "U9 Mixed - Orange" }, { name: "GS 10 - Green" }],
        DEFAULT_ENTRY_PREFS,
      )?.name,
    ).toBe("U9 Mixed - Orange");
    // "u9" doesn't match "U19".
    expect(pickEvent([{ name: "U19 Orange" }, { name: "U10 Orange" }], DEFAULT_ENTRY_PREFS)?.name).toBe(
      "U19 Orange",
    );
  });

  it("reads settings from the source, with defaults", () => {
    expect(entryPrefsOf(undefined)).toEqual(DEFAULT_ENTRY_PREFS);
    expect(entryPrefsOf({ include: "orange, red", maxDriveMinutes: 90, prefer: "" })).toEqual({
      ...DEFAULT_ENTRY_PREFS,
      include: ["orange", "red"],
      prefer: [],
      maxDriveMinutes: 90,
    });
    expect(entryPrefsOf({ maxDriveMinutes: 5 }).maxDriveMinutes).toBe(120);
    expect(entrySettingsOf({ entry: { homePostalCode: " a1a 1a1 " } }).postalCode).toBe("A1A 1A1");
    expect(entrySettingsOf({}).postalCode).toBeNull();
  });

  it("sizes the search radius from the drive limit", () => {
    expect(searchRadiusKm(120)).toBe(200);
    expect(searchRadiusKm(45)).toBe(75);
    // Without drive times the radius errs on the near side.
    expect(fallbackRadiusKm(120)).toBe(100);
    expect(fallbackRadiusKm(10)).toBe(25);
  });

  it("finds him by tournament player number, else by name in any order", () => {
    const rows = parseEventPage(page("event-current.html")).entries;
    expect(findSelfRow(rows, { name: "Sam Fixture" })?.tournamentPlayerIds).toEqual(["1021"]);
    expect(findSelfRow(rows, { name: "Someone Else", tournamentPlayerId: "1021" })).toBe(rows[0]);
    expect(findSelfRow(rows, { name: "Someone Else" })).toBeNull();
    expect(nameTokens("Guo, Jayden")).toBe(nameTokens("jayden  GUO"));
  });

  it("works out the status from the list", () => {
    const main = { status: { kind: "main_draw" as const }, tournamentPlayerIds: ["1"], names: ["x"] };
    const res = {
      status: { kind: "reserve" as const, position: 3 },
      tournamentPlayerIds: ["1"],
      names: ["x"],
    };
    expect(statusFromList("entered", main)).toEqual({ status: "main_draw", reservePosition: null });
    expect(statusFromList("entered", res)).toEqual({ status: "reserve", reservePosition: 3 });
    // The owner entered him by hand: found → entered.
    expect(statusFromList("found", { ...main, status: null }).status).toBe("entered");
    expect(statusFromList("main_draw", null).status).toBe("withdrawn");
    expect(statusFromList("entered", null).status).toBe("entered");
    expect(statusFromList("found", null).status).toBe("found");
  });

  it("enters one tournament per weekend, closest first, never over one he's in", () => {
    const c = (id: string, start: string, end: string, drive: number | null, venue: string | null = id) => ({
      tournamentId: id,
      startDate: start,
      endDate: end,
      driveMinutes: drive,
      venue,
    });
    const far = c("far", "2024-10-05", "2024-10-06", 110);
    const near = c("near", "2024-10-05", "2024-10-05", 30);
    const unknown = c("unknown", "2024-10-12", "2024-10-13", null);
    const taken = c("taken", "2024-10-19", "2024-10-20", 10);
    const { enter, skip } = chooseEntries(
      [far, near, unknown, taken],
      [{ startDate: "2024-10-20", endDate: "2024-10-20", venue: "Another Club" }],
    );
    expect(enter.map((e) => e.tournamentId)).toEqual(["near", "unknown"]);
    expect(skip.map((s) => [s.candidate.tournamentId, s.because?.tournamentId ?? null])).toEqual([
      ["taken", null],
      ["far", "near"],
    ]);
  });

  it("enters both when two tournaments on the same dates are at the same club", () => {
    const c = (id: string, venue: string | null, drive = 20) => ({
      tournamentId: id,
      startDate: "2024-10-18",
      endDate: "2024-10-18",
      driveMinutes: drive,
      venue,
    });
    const both = chooseEntries([c("rookie", "Fixture Club"), c("rising", " fixture  club ")], []);
    expect(both.enter.map((e) => e.tournamentId)).toEqual(["rising", "rookie"]);
    expect(both.skip).toEqual([]);
    // One he's already in at that club doesn't block the other either.
    const second = chooseEntries(
      [c("rising", "Fixture Club")],
      [{ startDate: "2024-10-18", endDate: "2024-10-18", venue: "Fixture Club" }],
    );
    expect(second.enter.map((e) => e.tournamentId)).toEqual(["rising"]);
    // An unknown venue isn't the same club.
    const unknown = chooseEntries([c("a", null), c("b", null)], []);
    expect(unknown.enter.map((e) => e.tournamentId)).toEqual(["a"]);
  });
});

describe("drive time", () => {
  it("reads the route's duration in minutes", () => {
    expect(minutesOf({ routes: [{ duration: "4210s" }] })).toBe(70);
    expect(minutesOf({ routes: [] })).toBeNull();
    expect(minutesOf(null)).toBeNull();
  });

  it("asks once per trip and is off without a project", async () => {
    const calls: unknown[] = [];
    const timer = routesDriveTimer({
      request: async (body) => {
        calls.push(body);
        return { status: 200, data: { routes: [{ duration: "3600s" }] } };
      },
    })!;
    expect(await timer("A1A 1A1, Canada", "Club, Town, ON, Canada")).toBe(60);
    expect(await timer("A1A 1A1, Canada", "Club, Town, ON, Canada")).toBe(60);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      travelMode: "DRIVE",
      destination: { address: "Club, Town, ON, Canada" },
    });
    const saved = process.env.ROUTES_PROJECT;
    delete process.env.ROUTES_PROJECT;
    expect(routesDriveTimer()).toBeNull();
    if (saved) process.env.ROUTES_PROJECT = saved;
  });
});
