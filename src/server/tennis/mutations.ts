import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { changeLog, tennisMatches, tennisPlayers, tennisTournaments } from "@db/schema";
import { flipSets, parseSets } from "../../domain/tennis";
import { MATCH_OUTCOMES, type MatchOutcome } from "../../domain/tennis-constants";
import { disagrees, type SetScore, type TennisMatchValues } from "../../domain/tennis-upsert";
import { zonedToUtc } from "../../domain/time";
import type { Db, DbOrTx } from "../db/client";
import { HttpError } from "../errors";
import { getHomeTimeZone } from "../settings";
import { matchRevision } from "./apply";

// The owner's own matches and corrections (TEN-8, SYNC-6). A corrected
// match keeps the owner's score and time through every later sync; sync
// only records the site's version and flags a disagreement (apply.ts).
// Scores are typed from his side ("6-3 4-6 10-8") and stored in side order.

const date = z.iso.date({ message: "Give the date of the match." });
const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Write the time like 09:30.")
  .nullable()
  .optional();
const sets = z
  .string()
  .trim()
  .max(60)
  .transform((s, ctx) => {
    const parsed = parseSets(s);
    if (parsed === null) {
      ctx.addIssue({ code: "custom", message: "Write the score from his side, like 6-3 4-6 10-8." });
      return z.NEVER;
    }
    return parsed;
  });
const text = (max: number) => z.string().trim().max(max);

export const addMatchInput = z
  .object({
    matchDate: date,
    time,
    // An opponent already known (their page key), or a name to add.
    opponentKey: z
      .string()
      .regex(/^[0-9a-f-]{1,40}$/i)
      .optional(),
    opponentName: text(80).optional(),
    // null: not played yet.
    won: z.boolean().nullable(),
    score: sets.optional(),
    outcome: z.enum(MATCH_OUTCOMES).default("played"),
    tournamentId: z.uuid().optional(),
    eventName: text(80).optional(),
    round: text(40).optional(),
    notes: text(500).optional(),
  })
  .refine((v) => !!v.opponentKey || !!v.opponentName, "Name the opponent.")
  .refine((v) => (v.won === null) === (v.outcome === "scheduled"), "Say who won, or mark it not played yet.");

export const correctMatchInput = z
  .object({
    won: z.boolean().nullable().optional(),
    score: sets.optional(),
    outcome: z.enum(MATCH_OUTCOMES).optional(),
    matchDate: date.optional(),
    time,
    round: text(40).nullable().optional(),
    notes: text(500).nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), "Nothing to change.");

async function noteChange(db: DbOrTx, id: string) {
  await db.insert(changeLog).values({ kind: "tennis", refId: id });
}

async function scheduledAt(db: DbOrTx, day: string, hhmm: string | null | undefined) {
  if (!hhmm) return null;
  return zonedToUtc(
    {
      year: +day.slice(0, 4),
      month: +day.slice(5, 7),
      day: +day.slice(8, 10),
      hour: +hhmm.slice(0, 2),
      minute: +hhmm.slice(3, 5),
      second: 0,
    },
    await getHomeTimeZone(db),
  );
}

// His player row: the one a source knows, else one typed in.
async function selfPlayer(db: DbOrTx) {
  const [me] = await db
    .select()
    .from(tennisPlayers)
    .where(eq(tennisPlayers.isSelf, true))
    .orderBy(sql`${tennisPlayers.sourceId} is null`, desc(tennisPlayers.profileFetchedAt))
    .limit(1);
  if (!me) throw new HttpError(409, "Add his Tennis Canada profile on the Sources page first.");
  return me;
}

// What's compared with the site's version (see `disagrees`).
function outcomeValues(r: typeof tennisMatches.$inferSelect): TennisMatchValues {
  return {
    winner: (r.winner ?? null) as 1 | 2 | null,
    sets: (r.sets ?? []) as SetScore[],
    outcome: r.outcome as MatchOutcome,
    scheduledAt: r.scheduledAt?.toISOString() ?? null,
  } as TennisMatchValues;
}

export async function addMatch(db: Db, actor: string, input: z.infer<typeof addMatchInput>) {
  return db.transaction(async (tx) => {
    const me = await selfPlayer(tx);
    let opponentId: string;
    if (input.opponentKey) {
      const [p] = await tx
        .select({ id: tennisPlayers.id })
        .from(tennisPlayers)
        .where(
          /^[0-9a-f]{8}-/i.test(input.opponentKey)
            ? eq(tennisPlayers.id, input.opponentKey)
            : eq(tennisPlayers.memberId, input.opponentKey),
        )
        .limit(1);
      if (!p) throw new HttpError(400, "That opponent wasn't found.");
      opponentId = p.id;
    } else {
      const [p] = await tx
        .insert(tennisPlayers)
        .values({ name: input.opponentName! })
        .returning({ id: tennisPlayers.id });
      opponentId = p.id;
    }
    if (opponentId === me.id) throw new HttpError(400, "He can't play himself.");
    if (input.tournamentId) {
      const [t] = await tx
        .select({ id: tennisTournaments.id })
        .from(tennisTournaments)
        .where(eq(tennisTournaments.id, input.tournamentId));
      if (!t) throw new HttpError(400, "That tournament wasn't found.");
    }
    const values = {
      tournamentId: input.tournamentId ?? null,
      eventName: input.eventName || null,
      round: input.round || null,
      matchDate: input.matchDate,
      scheduledAt: await scheduledAt(tx, input.matchDate, input.time),
      side1: me.id,
      side2: opponentId,
      winner: input.won === null ? null : input.won ? 1 : 2,
      sets: input.score ?? [],
      outcome: input.outcome,
      notes: input.notes || null,
    };
    const [row] = await tx
      .insert(tennisMatches)
      .values({ ...values, origin: "manual", correctedBy: actor })
      .returning({ id: tennisMatches.id });
    await matchRevision(tx, row.id, "manual_add", actor, null, values);
    await noteChange(tx, row.id);
    return row.id;
  });
}

async function loadRow(db: DbOrTx, id: string) {
  const [row] = await db
    .select()
    .from(tennisMatches)
    .where(and(eq(tennisMatches.id, id), isNull(tennisMatches.deletedAt)));
  if (!row) throw new HttpError(404, "not found");
  return row;
}

// His side of a stored match (1 or 2).
async function selfSide(db: DbOrTx, row: typeof tennisMatches.$inferSelect): Promise<1 | 2> {
  const ids = [row.side1, row.side1Partner, row.side2, row.side2Partner].filter((x): x is string => !!x);
  const mine = await db
    .select({ id: tennisPlayers.id })
    .from(tennisPlayers)
    .where(and(eq(tennisPlayers.isSelf, true), or(...ids.map((i) => eq(tennisPlayers.id, i)))));
  const set = new Set(mine.map((m) => m.id));
  if (set.has(row.side1) || (row.side1Partner && set.has(row.side1Partner))) return 1;
  if (set.has(row.side2) || (row.side2Partner && set.has(row.side2Partner))) return 2;
  throw new HttpError(400, "Only his own matches can be corrected.");
}

export async function correctMatch(
  db: Db,
  actor: string,
  id: string,
  input: z.infer<typeof correctMatchInput>,
) {
  const row = await loadRow(db, id);
  const side = await selfSide(db, row);
  const next = { ...row };
  if (input.won !== undefined) next.winner = input.won === null ? null : input.won === (side === 1) ? 1 : 2;
  if (input.score !== undefined) next.sets = side === 1 ? input.score : flipSets(input.score);
  if (input.outcome !== undefined) next.outcome = input.outcome;
  else if (input.won !== undefined)
    next.outcome = input.won === null ? "scheduled" : row.outcome === "scheduled" ? "played" : row.outcome;
  if ((next.winner === null) !== (next.outcome === "scheduled"))
    throw new HttpError(400, "Say who won, or mark it not played yet.");
  if (input.matchDate !== undefined) next.matchDate = input.matchDate;
  if (input.time !== undefined) next.scheduledAt = await scheduledAt(db, next.matchDate, input.time);
  if (input.round !== undefined) next.round = input.round || null;
  if (input.notes !== undefined) next.notes = input.notes || null;
  const before = outcomeValues(row);
  const after = outcomeValues(next);
  const source = row.sourceValues as TennisMatchValues | null;
  const values = {
    winner: next.winner,
    sets: next.sets,
    outcome: next.outcome,
    matchDate: next.matchDate,
    scheduledAt: next.scheduledAt,
    round: next.round,
    notes: next.notes,
  };
  await db.transaction(async (tx) => {
    await tx
      .update(tennisMatches)
      .set({
        ...values,
        correctedAt: sql`now()`,
        correctedBy: actor,
        // Only a match a source knows about can disagree with it.
        sourceDisagrees: row.externalId !== null ? (source ? disagrees(after, source) : true) : false,
        updatedAt: sql`now()`,
      })
      .where(eq(tennisMatches.id, id));
    await matchRevision(tx, id, "correct", actor, before, { ...values, scheduledAt: after.scheduledAt });
    await noteChange(tx, id);
  });
}

// Drop the owner's correction and show the site's result again.
export async function useSourceValues(db: Db, actor: string, id: string) {
  const row = await loadRow(db, id);
  const source = row.sourceValues as TennisMatchValues | null;
  if (!source) throw new HttpError(409, "The site has no version of this match.");
  await db.transaction(async (tx) => {
    await tx
      .update(tennisMatches)
      .set({
        matchDate: source.matchDate,
        scheduledAt: source.scheduledAt ? new Date(source.scheduledAt) : null,
        round: source.round,
        winner: source.winner,
        sets: source.sets,
        outcome: source.outcome,
        origin: "source",
        correctedAt: null,
        correctedBy: null,
        sourceDisagrees: false,
        updatedAt: sql`now()`,
      })
      .where(eq(tennisMatches.id, id));
    await matchRevision(tx, id, "use_source", actor, outcomeValues(row), source);
    await noteChange(tx, id);
  });
}

export async function deleteMatch(db: Db, actor: string, id: string) {
  const row = await loadRow(db, id);
  await db.transaction(async (tx) => {
    await tx
      .update(tennisMatches)
      .set({ deletedAt: sql`now()` })
      .where(eq(tennisMatches.id, id));
    await matchRevision(tx, id, "delete", actor, outcomeValues(row), null);
    await noteChange(tx, id);
  });
}

export async function restoreMatch(db: Db, actor: string, id: string) {
  const [row] = await db.select().from(tennisMatches).where(eq(tennisMatches.id, id));
  if (!row) throw new HttpError(404, "not found");
  await db.transaction(async (tx) => {
    await tx.update(tennisMatches).set({ deletedAt: null }).where(eq(tennisMatches.id, id));
    await matchRevision(tx, id, "restore", actor, null, outcomeValues(row));
    await noteChange(tx, id);
  });
}
