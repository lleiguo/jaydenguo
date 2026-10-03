import { and, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { assistantTurns } from "@db/schema";
import { LIMITS, type AssistantOutcome, type Language, type SourceKind } from "@/domain/assistant";
import { localDate, zonedToUtc } from "@/domain/time";
import type { DbOrTx } from "../db/client";
import { getHomeTimeZone } from "../settings";
import { didFor, type Did } from "./actions";
import { waitingFor, type Waiting } from "./email-read";

// Cookie's turns: one question and its answer (intent 0007, MEM-8, MEM-9).

// `email`: the email a follow-up summarized, with its Gmail link (intent
// 0009, ERA-6); its kind stays "hub" so app builds before it still read it.
export type AssistantSource = { kind: SourceKind; label: string; url?: string; email?: boolean };

export type TurnView = {
  id: string;
  conversationId: string;
  mode: "voice" | "text";
  // A summary that came after its question, with no question of its own
  // (intent 0009, ERA-1). Shown as mode "text" to app builds before it.
  followup?: boolean;
  // Null once the text has been cleared.
  heard: string | null;
  text: string | null;
  outcome: AssistantOutcome;
  language: Language | null;
  sources: AssistantSource[];
  // What the turn changed, as it stands now (intent 0008, ACT-1).
  did: Did | null;
  // An email read still on its way (intent 0009, ERA-1).
  waiting: Waiting | null;
  createdAt: string;
};

type Row = typeof assistantTurns.$inferSelect;

export const turnView = (r: Row, did: Did | null = null, waiting: Waiting | null = null): TurnView => ({
  id: r.id,
  conversationId: r.conversationId,
  mode: r.mode === "voice" ? "voice" : "text",
  ...(r.mode === "followup" ? { followup: true } : {}),
  heard: r.heard,
  text: r.answer,
  outcome: r.outcome as AssistantOutcome,
  language: r.language as Language | null,
  sources: r.sources as AssistantSource[],
  did,
  waiting,
  createdAt: r.createdAt.toISOString(),
});

// MEM-8: the earlier turns of this conversation a follow-up may lean on.
export async function recentTurns(db: DbOrTx, conversationId: string, now: Date) {
  const rows = await db
    .select({ heard: assistantTurns.heard, answer: assistantTurns.answer, mode: assistantTurns.mode })
    .from(assistantTurns)
    .where(
      and(
        eq(assistantTurns.conversationId, conversationId),
        gte(assistantTurns.createdAt, new Date(now.getTime() - LIMITS.historyMinutes * 60_000)),
        sql`${assistantTurns.outcome} in ('answer', 'bark')`,
        isNull(assistantTurns.textClearedAt),
      ),
    )
    .orderBy(desc(assistantTurns.createdAt))
    .limit(LIMITS.historyTurns);
  // Oldest first, dropping the oldest until the text fits.
  // A follow-up (an email she read) has no question of its own.
  const turns = rows.flatMap((r) =>
    r.answer && (r.heard || r.mode === "followup")
      ? [{ heard: r.heard || "(the email you were asked to read)", answer: r.answer }]
      : [],
  );
  let size = turns.reduce((n, t) => n + t.heard.length + t.answer.length, 0);
  while (turns.length && size > LIMITS.historyChars) {
    const dropped = turns.pop()!;
    size -= dropped.heard.length + dropped.answer.length;
  }
  return turns.reverse();
}

export const turnsQuery = z.object({
  // Turns before this instant (paging back).
  before: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

// MEM-9: the signed-in account's past turns, newest last.
export async function listTurns(
  db: DbOrTx,
  userId: string,
  opts: { before?: Date; limit?: number } = {},
): Promise<{ turns: TurnView[]; more: boolean }> {
  const limit = opts.limit ?? 50;
  const rows = await db
    .select()
    .from(assistantTurns)
    .where(
      and(
        eq(assistantTurns.userId, userId),
        isNull(assistantTurns.textClearedAt),
        opts.before ? lt(assistantTurns.createdAt, opts.before) : undefined,
      ),
    )
    .orderBy(desc(assistantTurns.createdAt))
    .limit(limit + 1);
  const shown = rows.slice(0, limit).reverse();
  const ids = shown.map((r) => r.id);
  const [did, waiting] = await Promise.all([didFor(db, ids), waitingFor(db, ids)]);
  return {
    turns: shown.map((r) => turnView(r, did.get(r.id) ?? null, waiting.get(r.id) ?? null)),
    more: rows.length > limit,
  };
}

// "Clear history": the words go, the token and cost numbers stay (LIM-6).
export async function clearHistory(db: DbOrTx, olderThan?: Date): Promise<number> {
  const rows = await db
    .update(assistantTurns)
    .set({ heard: null, answer: null, sources: [], textClearedAt: new Date() })
    .where(
      and(
        isNull(assistantTurns.textClearedAt),
        olderThan ? lt(assistantTurns.createdAt, olderThan) : undefined,
      ),
    )
    .returning({ id: assistantTurns.id });
  return rows.length;
}

// MEM-9: the daily tidy-up clears the words of turns older than 90 days.
export const pruneHistory = (db: DbOrTx, now = new Date()) =>
  clearHistory(db, new Date(now.getTime() - LIMITS.historyDays * 86_400_000));

// LIM-5: what Cookie has cost this month, in the home time zone.
export async function monthSpendUsd(db: DbOrTx, now: Date): Promise<number> {
  const tz = await getHomeTimeZone(db);
  const [year, month] = localDate(now, tz).split("-").map(Number);
  const start = zonedToUtc({ year, month, day: 1, hour: 0, minute: 0, second: 0 }, tz);
  const [row] = await db
    .select({ total: sql<number>`coalesce(sum(${assistantTurns.costUsd}), 0)::float` })
    .from(assistantTurns)
    .where(gte(assistantTurns.createdAt, start));
  return row?.total ?? 0;
}
