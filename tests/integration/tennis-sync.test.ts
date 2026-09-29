import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  events,
  sources,
  tennisDraws,
  tennisMatchRevisions,
  tennisMatches,
  tennisPlayers,
  tennisTournaments,
} from "@db/schema";
import { createDb, createPool, type PoolHandle } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { createLogger } from "@/server/log";
import { syncSource } from "@/worker/sync";
import { createFakeTc, PLANTED_PRIVATE, TC_FIXTURE, TC_NOW, TC_PROFILE_URL } from "../e2e/support/fake-tc";

// Plan M3.3: the tennis_tc adapter end to end, against a fake of the site,
// into Postgres.

describe("Tennis Canada sync", () => {
  let handle: PoolHandle;
  let db: ReturnType<typeof createDb>;
  let server: Server;
  let base: string;
  const lines: string[] = [];
  const log = createLogger((l) => lines.push(l));
  const now = () => TC_NOW;

  async function newSource() {
    const [s] = await db
      .insert(sources)
      .values({
        kind: "tennis_tc",
        name: "Tennis",
        config: { profileUrl: TC_PROFILE_URL(base) },
        categoryMapping: { default: "tennis" },
      })
      .returning();
    return s.id;
  }

  beforeAll(async () => {
    await runMigrations();
    handle = await createPool();
    db = createDb(handle.pool);
    process.env.SYNC_MIN_GAP_MINUTES = "0";
    process.env.FETCH_MIN_GAP_MS = "0";
    server = createFakeTc();
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.TENNIS_TC_BASE_URL = base;
  });
  afterAll(async () => {
    server.close();
    delete process.env.TENNIS_TC_BASE_URL;
    delete process.env.SYNC_MIN_GAP_MINUTES;
    delete process.env.FETCH_MIN_GAP_MS;
    await handle.close();
  });

  it("stores players, tournaments, his draws and matches, and puts tournaments on the calendar", async () => {
    const id = await newSource();
    const result = await syncSource(db, id, "manual", log, now);
    expect(result).toMatchObject({ status: "succeeded", changed: 0, cancelled: 0 });

    const players = await db.select().from(tennisPlayers).where(eq(tennisPlayers.sourceId, id));
    expect(players).toHaveLength(96);
    const me = players.filter((p) => p.isSelf);
    expect(me.map((p) => p.memberId)).toEqual([TC_FIXTURE.self.memberId]);
    expect(players.filter((p) => p.profileFetchedAt)).toHaveLength(4);
    const tournaments = await db.select().from(tennisTournaments).where(eq(tennisTournaments.sourceId, id));
    expect(tournaments).toHaveLength(39);
    const matches = await db.select().from(tennisMatches).where(eq(tennisMatches.sourceId, id));
    expect(matches).toHaveLength(124);
    expect(matches.every((m) => m.origin === "source" && m.sourceValues)).toBe(true);
    const current = tournaments.find((t) => t.externalId === TC_FIXTURE.currentTournament)!;
    const [draw] = await db.select().from(tennisDraws).where(eq(tennisDraws.tournamentId, current.id));
    expect(draw).toMatchObject({ kind: "bracket", position: 1, size: 16, seed: "1", status: "active" });
    expect(draw.nextMatch).toMatchObject({ status: "next", round: "Semi final" });

    const calendar = await db.select().from(events).where(eq(events.sourceId, id));
    expect(calendar.filter((e) => e.allDay)).toHaveLength(3);
    expect(calendar.every((e) => e.category === "tennis")).toBe(true);

    // Nothing planted on the profile page is stored or logged.
    const everything = JSON.stringify({ players, tournaments, matches, calendar, lines });
    for (const s of PLANTED_PRIVATE) expect(everything).not.toContain(s);

    // A second run changes nothing (SYNC-3).
    expect(await syncSource(db, id, "manual", log, now)).toEqual({
      status: "succeeded",
      added: 0,
      changed: 0,
      cancelled: 0,
    });
  }, 60_000);

  it("keeps only the draws that list him: a draw in his event he isn't in is dropped", async () => {
    const id = await newSource();
    await syncSource(db, id, "manual", log, now);
    const [current] = await db
      .select()
      .from(tennisTournaments)
      .where(
        and(eq(tennisTournaments.sourceId, id), eq(tennisTournaments.externalId, TC_FIXTURE.currentTournament)),
      );
    // Stored by an earlier sync, before draws he isn't in were skipped.
    await db.insert(tennisDraws).values({
      tournamentId: current.id,
      drawNo: "99",
      eventName: "U10 (Orange Ball)",
      kind: "other",
      nextMatch: { status: "not_drawn" },
      status: "active",
    });
    await syncSource(db, id, "manual", log, now);
    const draws = await db.select().from(tennisDraws).where(eq(tennisDraws.tournamentId, current.id));
    expect(draws).toHaveLength(1);
    expect(draws[0]).toMatchObject({ position: 1, status: "active" });
  }, 60_000);

  it("keeps the owner's correction through the next sync and flags the disagreement (TEN-8)", async () => {
    const id = await newSource();
    await syncSource(db, id, "manual", log, now);
    const [me] = await db
      .select()
      .from(tennisPlayers)
      .where(and(eq(tennisPlayers.sourceId, id), eq(tennisPlayers.isSelf, true)));
    const [row] = await db
      .select()
      .from(tennisMatches)
      .where(
        and(
          eq(tennisMatches.sourceId, id),
          eq(tennisMatches.outcome, "played"),
          sql`${tennisMatches.side1} = ${me.id} or ${tennisMatches.side2} = ${me.id}`,
        ),
      )
      .limit(1);
    await db
      .update(tennisMatches)
      .set({ sets: [[0, 0]], correctedAt: sql`now()`, correctedBy: "owner@example.test" })
      .where(eq(tennisMatches.id, row.id));

    await syncSource(db, id, "manual", log, now);
    const [after] = await db.select().from(tennisMatches).where(eq(tennisMatches.id, row.id));
    expect(after.sets).toEqual([[0, 0]]);
    expect(after.sourceDisagrees).toBe(true);
    expect((after.sourceValues as { sets: unknown }).sets).toEqual(row.sets);
    const revisions = await db
      .select()
      .from(tennisMatchRevisions)
      .where(eq(tennisMatchRevisions.matchId, row.id));
    expect(revisions.map((r) => r.action)).toEqual(["insert", "source_disagrees"]);
  }, 60_000);

  it("links a match the owner typed in to the source's copy instead of adding a second one", async () => {
    const id = await newSource();
    await syncSource(db, id, "manual", log, now);
    const [me] = await db
      .select()
      .from(tennisPlayers)
      .where(and(eq(tennisPlayers.sourceId, id), eq(tennisPlayers.isSelf, true)));
    const [source] = await db
      .select()
      .from(tennisMatches)
      .where(
        and(
          eq(tennisMatches.sourceId, id),
          eq(tennisMatches.side1, me.id),
          eq(tennisMatches.outcome, "played"),
        ),
      )
      .limit(1);
    const [opponent] = await db.select().from(tennisPlayers).where(eq(tennisPlayers.id, source.side2));
    // Pretend the owner typed the match before the site had it: a manual
    // opponent (no member number) and no link to the source.
    const [typed] = await db.insert(tennisPlayers).values({ name: opponent.name.toUpperCase() }).returning();
    await db
      .update(tennisMatches)
      .set({ sourceId: null, externalId: null })
      .where(eq(tennisMatches.id, source.id));
    const [manual] = await db
      .insert(tennisMatches)
      .values({
        matchDate: source.matchDate,
        side1: me.id,
        side2: typed.id,
        winner: source.winner,
        sets: source.sets,
        outcome: "played",
        origin: "manual",
      })
      .returning();
    // The old copy is out of the way (as if it had never been synced).
    await db.delete(tennisMatchRevisions).where(eq(tennisMatchRevisions.matchId, source.id));
    await db.delete(tennisMatches).where(eq(tennisMatches.id, source.id));

    const result = await syncSource(db, id, "manual", log, now);
    expect(result).toMatchObject({ status: "succeeded", added: 0 });
    const [linked] = await db.select().from(tennisMatches).where(eq(tennisMatches.id, manual.id));
    expect(linked).toMatchObject({ sourceId: id, externalId: source.externalId, origin: "manual" });
    expect(linked.tournamentId).toBe(source.tournamentId);
  }, 60_000);

  it("syncs a second source while a typed-in match points at another source's players", async () => {
    const first = await newSource();
    await syncSource(db, first, "manual", log, now);
    const [me] = await db
      .select()
      .from(tennisPlayers)
      .where(and(eq(tennisPlayers.sourceId, first), eq(tennisPlayers.isSelf, true)));
    const [typed] = await db.insert(tennisPlayers).values({ name: "Typed Opponent" }).returning();
    await db.insert(tennisMatches).values({
      matchDate: "2024-09-01",
      side1: me.id,
      side2: typed.id,
      winner: 1,
      sets: [[4, 1]],
      outcome: "played",
      origin: "manual",
    });
    const second = await newSource();
    expect(await syncSource(db, second, "manual", log, now)).toMatchObject({ status: "succeeded" });
  });
});
