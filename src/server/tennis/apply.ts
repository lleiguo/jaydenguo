import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import {
  changeLog,
  tennisDraws,
  tennisMatchRevisions,
  tennisMatches,
  tennisPlayers,
  tennisTournaments,
} from "@db/schema";
import type { MatchOutcome } from "../../domain/tennis-constants";
import {
  matchValues,
  planMatches,
  planTournaments,
  type SetScore,
  type StoredMatch,
  type TennisBatch,
  type TennisMatchValues,
  type TennisTournamentRecord,
} from "../../domain/tennis-upsert";
import type { Db, DbOrTx } from "../db/client";

// Writes a tennis sync in one transaction (plan M3.3): players, tournaments,
// his draws, matches, a revision for every match change, and a change-log
// entry. Players are referred to in the batch by member number; players the
// owner typed in (no member number) by `player:<id>`.

type MatchRow = typeof tennisMatches.$inferSelect;
type PlayerRow = typeof tennisPlayers.$inferSelect;

export const playerKey = (p: Pick<PlayerRow, "id" | "memberId">) => p.memberId ?? `player:${p.id}`;

// Names compared loosely: case, accents and spacing don't matter.
export const nameKey = (name: string) =>
  name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export function rowValues(
  r: MatchRow,
  keyOf: (id: string) => string,
  tournamentExternal: (id: string) => string,
): TennisMatchValues {
  const side = (a: string, b: string | null) => (b ? [keyOf(a), keyOf(b)] : [keyOf(a)]);
  return {
    tournamentExternalId: r.tournamentId ? tournamentExternal(r.tournamentId) : null,
    drawNo: r.drawNo,
    eventName: r.eventName,
    round: r.round,
    matchDate: r.matchDate,
    scheduledAt: r.scheduledAt?.toISOString() ?? null,
    side1: side(r.side1, r.side1Partner),
    side2: side(r.side2, r.side2Partner),
    winner: (r.winner ?? null) as 1 | 2 | null,
    sets: (r.sets ?? []) as SetScore[],
    outcome: r.outcome as MatchOutcome,
  };
}

function tournamentColumns(t: TennisTournamentRecord) {
  return {
    name: t.name,
    startDate: t.startDate,
    endDate: t.endDate,
    venue: t.venue,
    city: t.city,
    region: t.region,
    entryDeadline: t.entryDeadline,
    categories: t.categories,
    entered: t.entered,
    sourceUrl: t.sourceUrl,
  };
}

export async function matchRevision(
  db: DbOrTx,
  matchId: string,
  action: string,
  changedBy: string,
  before: unknown,
  after: unknown,
  syncRunId?: string,
) {
  await db.insert(tennisMatchRevisions).values({
    matchId,
    action,
    changedBy,
    syncRunId,
    before: before ?? null,
    after: after ?? null,
  });
}

export type TennisCounts = { added: number; changed: number; cancelled: number };

export async function syncTennis(
  db: Db,
  sourceId: string,
  batch: TennisBatch,
  opts: { actor: string; syncRunId?: string },
): Promise<TennisCounts> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`tennis:${sourceId}`}))`);
    const now = new Date();
    const counts: TennisCounts = { added: 0, changed: 0, cancelled: 0 };
    let touched = false;

    // Players. A profile read this run is the best source for the name and
    // club; a name seen only in a match never overwrites one.
    const fetched = batch.players.filter((p) => p.profileFetched);
    const seen = batch.players.filter((p) => !p.profileFetched);
    const playerRow = (p: (typeof batch.players)[number]) => ({
      sourceId,
      memberId: p.memberId,
      name: p.name,
      club: p.club,
      profileId: p.profileId,
      isSelf: p.isSelf,
      profileFetchedAt: p.profileFetched ? now : null,
    });
    const storedPlayers = await tx.select().from(tennisPlayers).where(eq(tennisPlayers.sourceId, sourceId));
    const playerByMember = new Map(storedPlayers.map((p) => [p.memberId!, p]));
    const newPlayers = batch.players.filter((p) => !playerByMember.has(p.memberId));
    for (let i = 0; i < newPlayers.length; i += 500)
      await tx.insert(tennisPlayers).values(newPlayers.slice(i, i + 500).map(playerRow));
    if (newPlayers.length) touched = true;
    for (const p of fetched) {
      const had = playerByMember.get(p.memberId);
      if (!had) continue;
      const changed =
        had.name !== p.name ||
        (p.club !== null && had.club !== p.club) ||
        (p.profileId !== null && had.profileId !== p.profileId) ||
        had.isSelf !== p.isSelf;
      await tx
        .update(tennisPlayers)
        .set({
          name: p.name,
          club: p.club ?? had.club,
          profileId: p.profileId ?? had.profileId,
          isSelf: p.isSelf,
          profileFetchedAt: now,
          ...(changed ? { updatedAt: now } : {}),
        })
        .where(eq(tennisPlayers.id, had.id));
      if (changed) touched = true;
    }
    // His own row is marked even when only a match named him.
    for (const p of seen) {
      const had = playerByMember.get(p.memberId);
      if (had && p.isSelf && !had.isSelf) {
        await tx
          .update(tennisPlayers)
          .set({ isSelf: true, updatedAt: now })
          .where(eq(tennisPlayers.id, had.id));
        touched = true;
      }
    }

    // Players this source knows, plus the ones the owner typed in.
    const players = await tx
      .select()
      .from(tennisPlayers)
      .where(sql`${tennisPlayers.sourceId} = ${sourceId} or ${tennisPlayers.sourceId} is null`);
    const playerById = new Map(players.map((p) => [p.id, p]));
    const idByKey = new Map(players.map((p) => [playerKey(p), p.id]));
    const keyOf = (id: string) => playerKey(playerById.get(id)!);
    const batchNames = new Map(batch.players.map((p) => [p.memberId, nameKey(p.name)]));

    // Tournaments.
    const storedTournaments = await tx
      .select()
      .from(tennisTournaments)
      .where(eq(tennisTournaments.sourceId, sourceId));
    const tournamentPlan = planTournaments(
      storedTournaments.map((t) => ({
        id: t.id,
        externalId: t.externalId!,
        status: t.status as "active" | "cancelled",
        entered: t.entered,
        sourceHash: t.sourceHash,
        startDate: t.startDate,
      })),
      batch.tournaments,
      batch.window,
    );
    for (const item of tournamentPlan) {
      if (item.op === "cancel") {
        await tx
          .update(tennisTournaments)
          .set({ status: "cancelled", updatedAt: now })
          .where(eq(tennisTournaments.id, item.id));
        counts.cancelled++;
        continue;
      }
      const values = {
        ...tournamentColumns(item.record),
        sourceHash: item.hash,
        status: "active",
        lastSyncedAt: now,
      };
      if (item.op === "insert") {
        await tx
          .insert(tennisTournaments)
          .values({ sourceId, externalId: item.record.externalId, ...values });
        counts.added++;
      } else {
        await tx
          .update(tennisTournaments)
          .set({ ...values, updatedAt: now })
          .where(eq(tennisTournaments.id, item.id));
        counts.changed++;
      }
    }
    const tournamentRows = await tx
      .select({ id: tennisTournaments.id, externalId: tennisTournaments.externalId })
      .from(tennisTournaments)
      .where(sql`${tennisTournaments.sourceId} = ${sourceId} or ${tennisTournaments.sourceId} is null`);
    const tournamentIdByExternal = new Map(
      tournamentRows.filter((t) => t.externalId).map((t) => [t.externalId!, t.id]),
    );
    const externalByTournamentId = new Map(
      tournamentRows.map((t) => [t.id, t.externalId ?? `manual:${t.id}`]),
    );
    const tournamentIdFor = (ext: string | null) =>
      ext ? (tournamentIdByExternal.get(ext) ?? (ext.startsWith("manual:") ? ext.slice(7) : null)) : null;

    // His draws, for the tournaments whose draws this run read: each one
    // is replaced; a draw no longer listed is marked withdrawn.
    const drawsByTournament = new Map<string, typeof batch.draws>();
    for (const d of batch.draws) {
      const list = drawsByTournament.get(d.tournamentExternalId) ?? [];
      list.push(d);
      drawsByTournament.set(d.tournamentExternalId, list);
    }
    for (const [ext, draws] of drawsByTournament) {
      const tournamentId = tournamentIdByExternal.get(ext);
      if (!tournamentId) continue;
      const existing = await tx.select().from(tennisDraws).where(eq(tennisDraws.tournamentId, tournamentId));
      const byNo = new Map(existing.map((d) => [d.drawNo, d]));
      for (const d of draws) {
        const values = {
          eventName: d.eventName,
          drawName: d.drawName,
          kind: d.kind,
          size: d.size,
          position: d.position,
          seed: d.seed,
          nextMatch: d.nextMatch,
          sourceUrl: d.sourceUrl,
          status: "active",
        };
        const had = byNo.get(d.drawNo);
        if (!had) {
          await tx.insert(tennisDraws).values({ tournamentId, drawNo: d.drawNo, ...values });
          touched = true;
          continue;
        }
        const same =
          JSON.stringify([
            had.eventName,
            had.drawName,
            had.kind,
            had.size,
            had.position,
            had.seed,
            had.nextMatch,
            had.sourceUrl,
            had.status,
          ]) ===
          JSON.stringify([
            values.eventName,
            values.drawName,
            values.kind,
            values.size,
            values.position,
            values.seed,
            values.nextMatch,
            values.sourceUrl,
            values.status,
          ]);
        if (!same) {
          await tx
            .update(tennisDraws)
            .set({ ...values, updatedAt: now })
            .where(eq(tennisDraws.id, had.id));
          touched = true;
        }
      }
      const listed = draws.map((d) => d.drawNo);
      const gone = await tx
        .update(tennisDraws)
        .set({ status: "withdrawn", updatedAt: now })
        .where(
          and(
            eq(tennisDraws.tournamentId, tournamentId),
            eq(tennisDraws.status, "active"),
            notInArray(tennisDraws.drawNo, listed),
          ),
        )
        .returning({ id: tennisDraws.id });
      if (gone.length) touched = true;
    }

    // Matches: this source's, plus owner-entered ones not tied to a source.
    const rows = await tx
      .select()
      .from(tennisMatches)
      .where(
        sql`${tennisMatches.sourceId} = ${sourceId} or (${tennisMatches.sourceId} is null and ${tennisMatches.origin} = 'manual')`,
      );
    const tournamentExternal = (id: string) => externalByTournamentId.get(id) ?? `manual:${id}`;
    // A typed-in match can point at another source's players (linked to
    // that source's copy); read those players too, for their keys.
    const foreign = [
      ...new Set(
        rows
          .flatMap((r) => [r.side1, r.side2, r.side1Partner, r.side2Partner])
          .filter((id): id is string => !!id && !playerById.has(id)),
      ),
    ];
    if (foreign.length)
      for (const p of await tx.select().from(tennisPlayers).where(inArray(tennisPlayers.id, foreign)))
        playerById.set(p.id, p);
    const stored: StoredMatch[] = rows.map((r) => ({
      id: r.id,
      externalId: r.externalId,
      origin: r.origin as "source" | "manual",
      status: r.status as "active" | "cancelled",
      deleted: r.deletedAt !== null,
      corrected: r.correctedAt !== null,
      sourceHash: r.sourceHash,
      sourceDisagrees: r.sourceDisagrees,
      values: rowValues(r, keyOf, tournamentExternal),
    }));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const idFor = (key: string) => {
      const id = idByKey.get(key);
      if (!id) throw new Error(`tennis sync: no player for ${key}`);
      return id;
    };
    const columns = (v: TennisMatchValues) => ({
      tournamentId: tournamentIdFor(v.tournamentExternalId),
      drawNo: v.drawNo,
      eventName: v.eventName,
      round: v.round,
      matchDate: v.matchDate,
      scheduledAt: v.scheduledAt ? new Date(v.scheduledAt) : null,
      side1: idFor(v.side1[0]),
      side1Partner: v.side1[1] ? idFor(v.side1[1]) : null,
      side2: idFor(v.side2[0]),
      side2Partner: v.side2[1] ? idFor(v.side2[1]) : null,
      winner: v.winner,
      sets: v.sets,
      outcome: v.outcome,
    });
    const sameOpponent = (manualKey: string, sourceKey: string) => {
      if (!manualKey.startsWith("player:")) return false;
      const manual = playerById.get(manualKey.slice(7));
      const name = batchNames.get(sourceKey);
      return !!manual && !!name && nameKey(manual.name) === name;
    };
    // A hand-typed match the site also lists now points at the site's
    // players (so head-to-head finds it). If the site has the sides the
    // other way round, the owner's winner and score are flipped to match.
    const linkSides = (row: MatchRow, record: TennisMatchValues) => {
      const mine = rowValues(row, keyOf, tournamentExternal);
      const same = (a: string, b: string) => a === b || sameOpponent(a, b);
      const straight = mine.side1.every((k) => record.side1.some((r) => same(k, r)));
      const c = columns(record);
      return {
        side1: c.side1,
        side1Partner: c.side1Partner,
        side2: c.side2,
        side2Partner: c.side2Partner,
        ...(straight
          ? {}
          : {
              winner: row.winner === null ? null : 3 - row.winner,
              sets: ((row.sets ?? []) as SetScore[]).map(([a, b]) => [b, a]),
            }),
      };
    };
    const plan = planMatches(stored, batch.matches, {
      selfKey: batch.selfMemberId,
      window: batch.window,
      sameOpponent,
    });

    for (const item of plan.items) {
      if (item.op === "insert") {
        const values = matchValues(item.record);
        const [row] = await tx
          .insert(tennisMatches)
          .values({
            sourceId,
            externalId: item.record.externalId,
            ...columns(values),
            origin: "source",
            sourceValues: values,
            sourceHash: item.hash,
            lastSyncedAt: now,
          })
          .returning({ id: tennisMatches.id });
        await matchRevision(tx, row.id, "insert", opts.actor, null, values, opts.syncRunId);
      } else if (item.op === "update") {
        const values = matchValues(item.record);
        await tx
          .update(tennisMatches)
          .set({
            ...columns(values),
            status: "active",
            sourceValues: values,
            sourceHash: item.hash,
            lastSyncedAt: now,
            updatedAt: now,
          })
          .where(eq(tennisMatches.id, item.id));
        await matchRevision(
          tx,
          item.id,
          item.restore ? "restore" : "update",
          opts.actor,
          item.before,
          values,
          opts.syncRunId,
        );
      } else if (item.op === "source") {
        const row = byId.get(item.id)!;
        const values = item.record ? matchValues(item.record) : null;
        const fill: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(item.fill)) {
          if (k === "tournamentExternalId") fill.tournamentId = tournamentIdFor(v as string);
          else if (k === "scheduledAt") fill.scheduledAt = v ? new Date(v as string) : null;
          else fill[k] = v;
        }
        await tx
          .update(tennisMatches)
          .set({
            ...fill,
            ...(item.link
              ? { sourceId, externalId: item.record!.externalId, ...linkSides(row, item.record!) }
              : {}),
            sourceValues: values,
            sourceHash: item.hash,
            sourceDisagrees: item.disagrees,
            lastSyncedAt: now,
            updatedAt: now,
          })
          .where(eq(tennisMatches.id, item.id));
        if (item.link || item.disagrees !== row.sourceDisagrees) {
          await matchRevision(
            tx,
            item.id,
            item.link ? "link" : item.disagrees ? "source_disagrees" : "source_agrees",
            opts.actor,
            row.sourceValues,
            values,
            opts.syncRunId,
          );
        }
      } else {
        await tx
          .update(tennisMatches)
          .set({ status: "cancelled", updatedAt: now })
          .where(eq(tennisMatches.id, item.id));
        await matchRevision(tx, item.id, "cancel", opts.actor, item.before, null, opts.syncRunId);
      }
    }
    if (plan.unchanged.length) {
      for (let i = 0; i < plan.unchanged.length; i += 1000)
        await tx
          .update(tennisMatches)
          .set({ lastSyncedAt: now })
          .where(
            and(
              eq(tennisMatches.sourceId, sourceId),
              inArray(tennisMatches.externalId, plan.unchanged.slice(i, i + 1000)),
            ),
          );
    }
    counts.added += plan.counts.added;
    counts.changed += plan.counts.changed;
    counts.cancelled += plan.counts.cancelled;
    if (touched || plan.items.length || tournamentPlan.length) {
      await tx.insert(changeLog).values({ kind: "tennis", refId: sourceId });
    }
    return counts;
  });
}
