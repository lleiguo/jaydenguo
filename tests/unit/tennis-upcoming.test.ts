import { describe, expect, it } from "vitest";
import type { EntryView } from "@/server/tennis/entries";
import type { DrawView, TournamentView } from "@/server/tennis/load";
import { upcomingRows } from "@/server/tennis/upcoming";

const SOURCE = "src-1";
const TODAY = "2024-09-28";

const entry = (over: Partial<EntryView>): EntryView =>
  ({
    id: `entry-${over.tournamentExternalId}`,
    sourceId: SOURCE,
    tournamentExternalId: "t-x",
    tournamentName: "Entry Open",
    startDate: "2024-10-05",
    endDate: "2024-10-06",
    venue: "Club",
    city: "Town",
    region: null,
    entryDeadline: null,
    eventNo: "6",
    eventName: "U9 Orange Boys",
    driveMinutes: 30,
    driveEstimated: false,
    status: "entered",
    reservePosition: null,
    note: null,
    tournamentPlayerId: null,
    tournamentUrl: "https://site/tournament/t-x",
    entryUrl: "https://site/individual-entry/t-x",
    enteredAt: null,
    listCheckedAt: null,
    drawSeenAt: null,
    drawSyncedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  }) as EntryView;

const draw = (over: Partial<DrawView> = {}): DrawView => ({
  id: "d1",
  eventName: "U9 Orange Boys",
  drawName: null,
  kind: "bracket",
  size: 8,
  position: 1,
  seed: null,
  status: "active",
  next: null,
  opponentKey: null,
  sourceUrl: null,
  ...over,
});

const tournament = (over: Partial<TournamentView>): TournamentView => ({
  id: "tid",
  name: "Synced Open",
  startDate: "2024-10-12",
  endDate: "2024-10-13",
  venue: "Park",
  city: null,
  region: null,
  entryDeadline: null,
  categories: [],
  sourceUrl: null,
  manual: false,
  sourceId: SOURCE,
  externalId: "t-synced",
  when: "upcoming",
  draws: [],
  events: [],
  entryStatus: "",
  record: { wins: 0, losses: 0 },
  ...over,
});

describe("upcoming tournaments (TEN-2, TEN-10)", () => {
  it("lists registered entries before the sync knows the tournament, soonest first", () => {
    const rows = upcomingRows(
      [tournament({})],
      [
        entry({
          tournamentExternalId: "t-a",
          tournamentName: "Reserve Cup",
          status: "reserve",
          reservePosition: 3,
        }),
        entry({ tournamentExternalId: "t-b", tournamentName: "Found Open", status: "found" }),
        entry({
          tournamentExternalId: "t-c",
          tournamentName: "Pay Classic",
          status: "payment_needed",
          startDate: "2024-10-01",
          endDate: "2024-10-01",
        }),
      ],
      TODAY,
    );
    expect(rows.map((r) => [r.name, r.status.label])).toEqual([
      ["Pay Classic", "Payment required"],
      ["Reserve Cup", "Reserve list (3)"],
      ["Synced Open", "Registered"],
    ]);
    expect(rows[0].status.action).toEqual({
      text: "Pay on the site",
      url: "https://site/individual-entry/t-x",
    });
    expect(rows[1]).toMatchObject({ tournamentId: null, venue: "Club, Town", driveMinutes: 30 });
  });

  it("joins an entry to its synced tournament; being in the draw wins over the list", () => {
    const e = entry({ tournamentExternalId: "t-synced", status: "reserve", reservePosition: 1 });
    expect(upcomingRows([tournament({})], [e], TODAY)).toEqual([
      expect.objectContaining({
        tournamentId: "tid",
        status: expect.objectContaining({ label: "Reserve list (1)" }),
        events: ["U9 Orange Boys"],
      }),
    ]);
    const inDraw = upcomingRows([tournament({ draws: [draw()], events: ["U9 Orange Boys"] })], [e], TODAY);
    expect(inDraw).toHaveLength(1);
    expect(inDraw[0].status).toMatchObject({ kind: "main_draw", label: "Accepted" });
    expect(inDraw[0].draws).toHaveLength(1);
    // Intent 0017, ACC-1: the main draw from the list reads "Accepted" too,
    // and the row knows its entry (ACC-5).
    const accepted = upcomingRows([tournament({})], [{ ...e, status: "main_draw" }], TODAY);
    expect(accepted[0]).toMatchObject({ entryId: e.id, status: { kind: "main_draw", label: "Accepted" } });
  });

  it("leaves in-progress tournaments (and their entries) to the In progress list", () => {
    const e = entry({ tournamentExternalId: "t-synced", startDate: TODAY, endDate: "2024-09-29" });
    expect(upcomingRows([tournament({ when: "in_progress" })], [e], TODAY)).toEqual([]);
  });
});
