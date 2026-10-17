import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Fenced, householdWriter } from "@/adapters/google-calendar/writer";
import { ownersFor } from "@/domain/categories";
import { householdTitle, planHousehold, type HouseholdLink, type PlanItem } from "@/domain/household-sync";
import type { Person } from "@/domain/people";

// Intent 0020: what goes to the household calendar (TWO), twins (DUP2-2),
// the brake and the fence (TWSEC-1, TWSEC-2).

const jayden: Person = { id: "11111111-1111-1111-1111-111111111111", name: "Jayden", isPrimary: true };
const sam: Person = { id: "22222222-2222-2222-2222-222222222222", name: "Sam", isPrimary: false };
const people = [jayden, sam];
const tz = "America/Toronto";
const now = new Date("2030-03-01T12:00:00Z");

let n = 0;
const item = (over: Partial<PlanItem> = {}): PlanItem => ({
  id: `e${++n}`,
  sourceKind: "tennis",
  title: "Tennis lesson",
  category: "tennis",
  owners: [jayden.id],
  start: "2030-03-04T22:00:00.000Z",
  end: "2030-03-04T23:00:00.000Z",
  allDay: false,
  locationName: "Club",
  notes: null,
  active: true,
  repeats: false,
  createdAt: now,
  ...over,
});
const plan = (items: PlanItem[], links: HouseholdLink[] = [], overrideBrake = false) =>
  planHousehold({ items, people, links, timeZone: tz, now, overrideBrake });

describe("householdTitle (TWO-2)", () => {
  it("names whose event it is, unless the title already does or it is everyone's", () => {
    expect(householdTitle("Tennis lesson", [jayden.id], people)).toBe("Jayden – Tennis lesson");
    expect(householdTitle("Jayden swim", [jayden.id], people)).toBe("Jayden swim");
    expect(householdTitle("Family dinner", [jayden.id, sam.id], people)).toBe("Family dinner");
    expect(householdTitle("Dentist", [sam.id], people)).toBe("Sam – Dentist");
  });

  it("reads back as the same owners", () => {
    for (const owners of [[jayden.id], [sam.id]]) {
      const title = householdTitle("Tennis lesson", owners, people);
      expect(ownersFor(title, { default: "other" }, people)).toEqual(owners);
    }
  });
});

describe("planHousehold", () => {
  it("creates each future hub event once, tagged with its ID, and nothing past or far off", () => {
    const future = item();
    const past = item({ start: "2030-02-01T22:00:00.000Z", end: "2030-02-01T23:00:00.000Z" });
    const far = item({ start: "2031-06-01T22:00:00.000Z", end: "2031-06-01T23:00:00.000Z" });
    const skipped = item({ active: false });
    const p = plan([future, past, far, skipped]);
    expect(p.create.map((c) => c.hubKey)).toEqual([future.id]);
    expect(p.create[0].body).toMatchObject({
      summary: "Jayden – Tennis lesson",
      location: "Club",
      extendedProperties: { private: { hubEventId: future.id } },
    });
    expect(p.create[0].body.description).toContain("From the family hub.");
    expect(p.held).toBeNull();
  });

  it("never writes the household calendar's own events back to it", () => {
    expect(plan([item({ sourceKind: "google_calendar", googleEventId: "g1" })]).create).toEqual([]);
  });

  it("does nothing on a second run, and updates only what changed", () => {
    const e = item();
    const first = plan([e]);
    const links: HouseholdLink[] = first.create.map((c) => ({
      hubKey: c.hubKey,
      googleEventId: "g1",
      origin: "hub",
      hash: c.hash,
    }));
    const again = plan([e], links);
    expect([again.create, again.update, again.remove]).toEqual([[], [], []]);
    const moved = plan([{ ...e, start: "2030-03-04T21:00:00.000Z" }], links);
    expect(moved.update).toMatchObject([{ hubKey: e.id, googleEventId: "g1" }]);
  });

  it("deletes what left the hub, but leaves past events alone (TWO-7)", () => {
    const gone: HouseholdLink = { hubKey: "deleted", googleEventId: "g1", origin: "hub", hash: "x" };
    const ended = item({ start: "2030-02-01T22:00:00.000Z", end: "2030-02-01T23:00:00.000Z" });
    const endedLink: HouseholdLink = { hubKey: ended.id, googleEventId: "g2", origin: "hub", hash: "x" };
    const cancelled = item({ active: false });
    const cancelledLink: HouseholdLink = {
      hubKey: cancelled.id,
      googleEventId: "g3",
      origin: "hub",
      hash: "x",
    };
    const p = plan([ended, cancelled], [gone, endedLink, cancelledLink]);
    expect(p.remove.map((r) => r.googleEventId).sort()).toEqual(["g1", "g3"]);
    expect(p.update).toEqual([]);
  });

  it("sends a school day as one block per child (TWO-5)", () => {
    const cls = (start: string, end: string, owners = [jayden.id]) =>
      item({
        sourceKind: "ical",
        category: "school_class",
        title: "Math",
        start,
        end,
        owners,
        locationName: null,
      });
    const p = plan([
      cls("2030-03-04T13:30:00.000Z", "2030-03-04T14:30:00.000Z"),
      cls("2030-03-04T19:00:00.000Z", "2030-03-04T20:00:00.000Z"),
      cls("2030-03-04T13:30:00.000Z", "2030-03-04T14:30:00.000Z", [sam.id]),
      cls("2030-03-04T18:00:00.000Z", "2030-03-04T19:00:00.000Z", [sam.id]),
    ]);
    expect(p.create.map((c) => [c.hubKey, c.body.summary])).toEqual([
      [`school:2030-03-04:${jayden.id}`, "Jayden – School"],
      [`school:2030-03-04:${sam.id}`, "Sam – School"],
    ]);
    expect(p.create[0].body.start).toMatchObject({ dateTime: "2030-03-04T13:30:00.000Z" });
    expect(p.create[0].body.end).toMatchObject({ dateTime: "2030-03-04T20:00:00.000Z" });
  });

  it("links a hand-made household twin of a feed event instead of doubling it (DUP2-2)", () => {
    const feed = item({ sourceKind: "teamsnap", category: "soccer", title: "Game vs Lions" });
    const twin = item({
      sourceKind: "google_calendar",
      googleEventId: "family1",
      category: "soccer",
      title: "Jayden soccer",
      start: "2030-03-04T21:45:00.000Z",
    });
    const p = plan([feed, twin]);
    expect(p.create).toEqual([]);
    expect(p.link).toHaveLength(1);
    expect(p.link[0]).toMatchObject({ hubKey: feed.id, googleEventId: "family1" });
    // Its title stays as the family wrote it.
    expect(p.link[0].body).not.toHaveProperty("summary");
    expect(p.link[0].body.start).toMatchObject({ dateTime: feed.start });

    // Once the feed drops it, the family's event is untagged, not deleted.
    const link: HouseholdLink = { ...p.link[0], origin: "twin" };
    const later = plan([{ ...feed, active: false }, twin], [link]);
    expect(later.unlink).toMatchObject([{ googleEventId: "family1" }]);
    expect(later.remove).toEqual([]);
  });

  it("doesn't link an event made on the site to a household one", () => {
    const site = item({ sourceKind: null });
    const household = item({ sourceKind: "google_calendar", googleEventId: "family1" });
    expect(plan([site, household]).create.map((c) => c.hubKey)).toEqual([site.id]);
  });

  it("holds a run that would delete or change too much (TWSEC-2)", () => {
    const links = Array.from({ length: 11 }, (_, i): HouseholdLink => ({
      hubKey: `gone${i}`,
      googleEventId: `g${i}`,
      origin: "hub",
      hash: "x",
    }));
    expect(plan([], links).held).toMatch(/delete 11 events/);
    expect(plan([], links, true).held).toBeNull();
    expect(plan([], links.slice(0, 10)).held).toBeNull();
  });
});

describe("the household writer's fence (TWSEC-1)", () => {
  const seen: { method: string; url: string }[] = [];
  // A fake Google needs no pause between requests.
  beforeEach(() => vi.stubEnv("FETCH_MIN_GAP_MS", "0"));
  const google = (event: object | null) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        seen.push({ method, url: String(url) });
        if (method === "GET")
          return new Response(event ? JSON.stringify(event) : null, { status: event ? 200 : 404 });
        return new Response(method === "DELETE" ? null : JSON.stringify(event), {
          status: method === "DELETE" ? 204 : 200,
        });
      }),
    );
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    seen.length = 0;
  });
  const future = { dateTime: "2030-03-04T23:00:00Z" };
  const writer = (untagged: string[] = []) =>
    householdWriter("token", "household", { now, untagged: new Set(untagged) });

  it("deletes and changes events the hub tagged", async () => {
    google({ id: "g1", end: future, extendedProperties: { private: { hubEventId: "e1" } } });
    await writer().remove("g1");
    await writer().patch("g1", { summary: "x" });
    expect(seen.map((s) => s.method)).toEqual(["GET", "DELETE", "GET", "PATCH"]);
  });

  it("refuses the family's own events unless named, and anything that has ended", async () => {
    google({ id: "g1", end: future });
    await expect(writer().remove("g1")).rejects.toBeInstanceOf(Fenced);
    await expect(writer().patch("g1", {})).rejects.toBeInstanceOf(Fenced);
    await expect(writer(["g1"]).patch("g1", {})).resolves.toMatchObject({ id: "g1" });
    google({
      id: "g2",
      end: { dateTime: "2030-02-01T00:00:00Z" },
      extendedProperties: { private: { hubEventId: "e" } },
    });
    await expect(writer().remove("g2")).rejects.toThrow(/ended/);
    expect(seen.filter((s) => s.method === "DELETE")).toEqual([]);
  });

  it("counts an event already gone as removed", async () => {
    google(null);
    await expect(writer().remove("g1")).resolves.toBeUndefined();
  });
});
