import { and, desc, eq } from "drizzle-orm";
import { sources, tennisChecks } from "@db/schema";
import type { DbOrTx } from "../db/client";
import type { JobLauncher } from "../jobs/launcher";
import { HttpError } from "../errors";

// The quick check behind pull to refresh on the Tennis screen (intent 0012,
// TPR-2..4): his entries, where he stands on each list, and his draws. The
// worker job `tennis:check <id>` does the work; this starts it and reports
// on it.

// TPR-4: the site is asked at most once every 5 minutes.
export const CHECK_GAP_MS = 5 * 60_000;
// A check still "running" after this long died without saying so.
export const CHECK_STALE_MS = 10 * 60_000;

type CheckRow = typeof tennisChecks.$inferSelect;

export type TennisCheckView = {
  id: string;
  status: "running" | "succeeded" | "failed";
  startedAt: string;
  finishedAt: string | null;
  result: Record<string, number> | null;
  error: string | null;
  // True when this is an earlier check, returned because the last one is
  // under 5 minutes old (or still running): nothing new was started.
  recent: boolean;
};

const view = (r: CheckRow, recent = false): TennisCheckView => ({
  id: r.id,
  status: r.status as TennisCheckView["status"],
  startedAt: r.startedAt.toISOString(),
  finishedAt: r.finishedAt?.toISOString() ?? null,
  result: (r.result as Record<string, number> | null) ?? null,
  error: r.error,
  recent,
});

// What to do with a new pull, given the last check: start one, or answer
// with the last (running, or under 5 minutes old and not failed).
export function checkDecision(last: Pick<CheckRow, "status" | "startedAt"> | null, now: Date) {
  if (!last) return "start" as const;
  const age = now.getTime() - last.startedAt.getTime();
  if (last.status === "running" && age < CHECK_STALE_MS) return "wait" as const;
  if (last.status === "succeeded" && age < CHECK_GAP_MS) return "recent" as const;
  return "start" as const;
}

async function lastCheck(db: DbOrTx) {
  const [last] = await db.select().from(tennisChecks).orderBy(desc(tennisChecks.startedAt)).limit(1);
  return last ?? null;
}

export async function requestCheck(
  db: DbOrTx,
  launcher: JobLauncher,
  now = new Date(),
): Promise<{ check: TennisCheckView; started: boolean }> {
  const [source] = await db
    .select({ id: sources.id })
    .from(sources)
    .where(and(eq(sources.kind, "tennis_tc"), eq(sources.enabled, true)))
    .limit(1);
  if (!source) throw new HttpError(409, "Add a Tennis Canada source on the website's Sources page first.");
  const last = await lastCheck(db);
  const decision = checkDecision(last, now);
  if (decision !== "start") return { check: view(last!, true), started: false };
  if (last?.status === "running")
    await db
      .update(tennisChecks)
      .set({ status: "failed", finishedAt: now, error: "The check stopped unexpectedly." })
      .where(eq(tennisChecks.id, last.id));
  const [row] = await db.insert(tennisChecks).values({ startedAt: now }).returning();
  try {
    await launcher.start(["tennis:check", row.id]);
  } catch (err) {
    await db
      .update(tennisChecks)
      .set({ status: "failed", finishedAt: new Date(), error: "Couldn't start the check. Try again later." })
      .where(eq(tennisChecks.id, row.id));
    throw err;
  }
  return { check: view(row), started: true };
}

export async function getCheck(db: DbOrTx, id: string): Promise<TennisCheckView> {
  const [row] = await db.select().from(tennisChecks).where(eq(tennisChecks.id, id));
  if (!row) throw new HttpError(404, "not found");
  return view(row);
}

// When the last check finished well, for "Checked N min ago".
export async function lastCheckedAt(db: DbOrTx): Promise<string | null> {
  const [row] = await db
    .select({ at: tennisChecks.finishedAt })
    .from(tennisChecks)
    .where(eq(tennisChecks.status, "succeeded"))
    .orderBy(desc(tennisChecks.startedAt))
    .limit(1);
  return row?.at?.toISOString() ?? null;
}
