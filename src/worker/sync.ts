import { and, desc, eq, lt, sql } from "drizzle-orm";
import { sources, syncRuns } from "@db/schema";
import { adapterFor } from "../adapters/registry";
import { SyncError, type AdapterContext } from "../adapters/types";
import { ownersFor, parseMapping } from "../domain/categories";
import type { Db } from "../server/db/client";
import type { Logger } from "../server/log";
import { extendAllSeries } from "../server/calendar/mutations";
import { listPeople } from "../server/people";
import { getHomeTimeZone } from "../server/settings";
import { syncSwim } from "../server/swim/apply";
import { syncTennis } from "../server/tennis/apply";
import { runRefresh, syncEntries } from "../server/tennis/entries";
import { routesDriveTimer } from "../server/tennis/drive";
import { tennisTestNow } from "../adapters/tennis-tc";
import { localDate } from "../domain/time";
import { claudeExplainer, explainNextMatches } from "../server/tennis/explain";
import { syncRecords } from "../server/sync/apply";
import { defaultEmailExtractor, syncEmails } from "../server/email/apply";
import { FAILURE_ALERT_THRESHOLD, SOURCE_TIMEOUT_MS, STALE_RUN_MS, minGapMs } from "../server/sync/policy";
import { notifyClashes, notifyNextMatches, notifySuggestions, notifySyncFailed } from "../server/push/kinds";
import { pruneNotifications } from "../server/push/notify";
import type { JobContext } from "./context";
import { workerBrowserSession } from "./browser-session";
import { calendarCopyJob } from "./calendar-copy";
import { openCredential } from "./credentials";

// Runs one source's sync (spec §5.1, SYNC-1..5): lock, fetch, normalise,
// upsert, record the run. One source failing never affects another.

export type Trigger = "scheduled" | "manual";
export type SyncOutcome =
  | { status: "succeeded"; added: number; changed: number; cancelled: number }
  | { status: "failed"; error: string }
  | { status: "skipped"; reason: string };

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      timer = setTimeout(
        () => reject(new SyncError("The site took too long. It will be tried again next time.")),
        ms,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

export async function syncSource(
  db: Db,
  sourceId: string,
  trigger: Trigger,
  log: Logger,
  now: () => Date = () => new Date(),
): Promise<SyncOutcome> {
  // Session-level advisory lock on a dedicated connection: a second run of
  // the same source while one is going is ignored (SYNC-2).
  const lockClient = await db.$client.connect();
  const lockKey = `sync-run:${sourceId}`;
  try {
    const { rows } = await lockClient.query<{ ok: boolean }>(
      "select pg_try_advisory_lock(hashtext($1)) as ok",
      [lockKey],
    );
    if (!rows[0].ok) return { status: "skipped", reason: "already running" };
    try {
      return await runLocked(db, sourceId, trigger, log, now);
    } finally {
      await lockClient.query("select pg_advisory_unlock(hashtext($1))", [lockKey]);
    }
  } finally {
    lockClient.release();
  }
}

async function runLocked(
  db: Db,
  sourceId: string,
  trigger: Trigger,
  log: Logger,
  now: () => Date,
): Promise<SyncOutcome> {
  const [source] = await db.select().from(sources).where(eq(sources.id, sourceId));
  if (!source) return { status: "skipped", reason: "no such source" };
  if (!source.enabled) return { status: "skipped", reason: "disabled" };

  // Runs that died without finishing are closed off first.
  await db
    .update(syncRuns)
    .set({ status: "failed", finishedAt: sql`now()`, errorMessage: "The sync stopped unexpectedly." })
    .where(
      and(
        eq(syncRuns.sourceId, sourceId),
        eq(syncRuns.status, "running"),
        lt(syncRuns.startedAt, new Date(now().getTime() - STALE_RUN_MS)),
      ),
    );

  // At most one successful run per scraped source per hour (SYNC-5); feeds
  // and failed runs may run again straight away. The lock above stops overlapping runs.
  const [last] = await db
    .select()
    .from(syncRuns)
    .where(and(eq(syncRuns.sourceId, sourceId), eq(syncRuns.status, "succeeded")))
    .orderBy(desc(syncRuns.startedAt))
    .limit(1);
  if (last && now().getTime() - last.startedAt.getTime() < minGapMs(source.kind)) {
    log("sync skipped: ran recently", { sourceId, lastRun: last.startedAt.toISOString() });
    return { status: "skipped", reason: "ran recently" };
  }

  const [run] = await db
    .insert(syncRuns)
    .values({ sourceId, trigger, status: "running", startedAt: now() })
    .returning();
  log("sync started", { sourceId, source: source.name, runId: run.id, trigger });
  try {
    const credential = source.credentialId
      ? await openCredential(db, source.credentialId, `sync:${source.name}`)
      : null;
    const adapter = adapterFor(source.kind);
    const homeTimeZone = await getHomeTimeZone(db);
    const ctx: AdapterContext = {
      source: {
        id: source.id,
        name: source.name,
        config: (source.config ?? {}) as Record<string, unknown>,
        mapping: parseMapping(source.categoryMapping),
      },
      credential,
      now: now(),
      homeTimeZone,
      // Tournaments he's entered (TEN-9..11), so their draws are read early.
      // Veracross remembers this browser between runs. A sign-in code is only
      // ever typed through "Test connection" on the Accounts page, so a sync
      // that meets one stops and says so.
      ...(source.kind === "veracross" &&
        source.credentialId && { browserSession: workerBrowserSession(db, source.credentialId, false) }),
      ...(source.kind === "tennis_tc" && {
        tennisEntries: await syncEntries(db, source.id, localDate(now(), homeTimeZone)),
      }),
    };
    const raw = await withTimeout(adapter.fetchRaw(ctx), SOURCE_TIMEOUT_MS);
    const batch = adapter.normalise(raw, ctx);
    // Whose events, from title rules, names in the title and the source's
    // default owners.
    const people = await listPeople(db);
    const records = batch.records.map((r) => ({
      ...r,
      ownerIds: ownersFor(r.title, ctx.source.mapping, people),
    }));
    const plan = await syncRecords(db, { sourceId }, records, batch.window, {
      actor: "sync",
      syncRunId: run.id,
    });
    const counts = { ...plan.counts };
    if (batch.swim) {
      const swim = await syncSwim(db, sourceId, batch.swim, { actor: "sync", syncRunId: run.id });
      counts.added += swim.added;
      counts.changed += swim.changed;
      counts.cancelled += swim.cancelled;
    }
    if (batch.tennis) {
      const tennis = await syncTennis(db, sourceId, batch.tennis, { actor: "sync", syncRunId: run.id });
      counts.added += tennis.added;
      counts.changed += tennis.changed;
      counts.cancelled += tennis.cancelled;
    }
    if (batch.emails) {
      // EML-2: new suggestions count as added; nothing reaches the calendar
      // until the owner approves.
      const read = await syncEmails(db, sourceId, batch.emails, {
        extractor: defaultEmailExtractor(),
        now: now(),
        homeTimeZone,
        log,
      });
      counts.added += read.suggestions;
      await notifySuggestions(db, source, run.id, read.suggestions, { log, now: now() });
    }
    await db
      .update(syncRuns)
      .set({ status: "succeeded", ...counts, finishedAt: sql`now()` })
      .where(eq(syncRuns.id, run.id));
    await db
      .update(sources)
      .set({ lastSuccessAt: sql`now()`, consecutiveFailures: 0 })
      .where(eq(sources.id, sourceId));
    // Notifications (intent 0004, PUSH-1): new clashes after any source,
    // his next opponents after tennis. Never fails the run.
    await notifyClashes(db, { log, now: now() }).catch((err) =>
      log("clash notifications failed", { error: err }, "WARNING"),
    );
    if (batch.tennis)
      await notifyNextMatches(db, { log, now: now() }).catch((err) =>
        log("match notifications failed", { error: err }, "WARNING"),
      );
    // Tournament entries (TEN-9, TEN-10) on every Tennis refresh: entry
    // lists, matching tournaments not open yet, and skipped ones. Best
    // effort, like the explanations below.
    if (batch.tennis) {
      try {
        await runRefresh(
          { db, log, now: tennisTestNow() ?? now(), timeZone: homeTimeZone },
          { id: source.id, name: source.name, config: source.config },
          { drive: routesDriveTimer() },
        );
      } catch (err) {
        log("tennis entries refresh failed", { error: err }, "WARNING");
      }
    }
    // TEN-6: Claude's paragraph for his next matches' predictions. Best
    // effort, after the run is recorded, so it never fails a sync.
    if (batch.tennis) {
      try {
        const explained = await explainNextMatches(db, claudeExplainer(), log);
        log("tennis explanations", explained);
      } catch (err) {
        log("tennis explanations failed", { error: err }, "WARNING");
      }
    }
    log("sync finished", {
      sourceId,
      runId: run.id,
      ...counts,
      warnings: batch.warnings,
      duplicates: plan.duplicates.length,
    });
    return { status: "succeeded", ...counts };
  } catch (err) {
    const message =
      err instanceof SyncError
        ? err.message
        : "The sync failed unexpectedly. It will be tried again next time.";
    await db
      .update(syncRuns)
      .set({ status: "failed", errorMessage: message, finishedAt: sql`now()` })
      .where(eq(syncRuns.id, run.id));
    const [updated] = await db
      .update(sources)
      .set({ consecutiveFailures: sql`${sources.consecutiveFailures} + 1` })
      .where(eq(sources.id, sourceId))
      .returning({ failures: sources.consecutiveFailures });
    log("sync failed", { sourceId, runId: run.id, error: err, message }, "ERROR");
    // SYNC-4: three failures in a row email the owner. The log line below
    // feeds a log-based metric with an email alert (infra/alerts.tf).
    if (updated.failures === FAILURE_ALERT_THRESHOLD) {
      log(
        "sync failing repeatedly",
        { alert: "sync_failed_repeatedly", source: source.name, message },
        "ERROR",
      );
      await notifySyncFailed(db, source, message, { log, now: now() });
    }
    return { status: "failed", error: message };
  }
}

// `sync <source-id | all> [manual | scheduled]`
export async function syncJob(args: string[], ctx: JobContext) {
  const [target, triggerArg] = args;
  const trigger: Trigger = triggerArg === "manual" ? "manual" : "scheduled";
  if (!target) throw new Error("usage: sync <source-id | all> [manual | scheduled]");
  const db = await ctx.db();
  const ids =
    target === "all"
      ? (await db.select({ id: sources.id }).from(sources).where(eq(sources.enabled, true))).map((s) => s.id)
      : [target];
  const results: Record<string, SyncOutcome["status"]> = {};
  for (const id of ids) results[id] = (await syncSource(db, id, trigger, ctx.log)).status;
  // The daily run also keeps open-ended repeating events written out ahead.
  if (target === "all") ctx.log("series extended", { series: await extendAllSeries(db) });
  // GCO-1: the Google Calendar copy follows the daily sync.
  if (target === "all") await calendarCopyJob([], ctx);
  // Notifications are kept 90 days.
  if (target === "all") ctx.log("notifications pruned", { removed: await pruneNotifications(db) });
  ctx.log("sync job done", { results });
}

// `smoke <source-id>`: a live check of one source (plan §6 "live smoke"):
// fetch and normalise, print counts and the next few events, write nothing.
export async function smokeJob(args: string[], ctx: JobContext) {
  const db = await ctx.db();
  const [source] = await db
    .select()
    .from(sources)
    .where(eq(sources.id, args[0] ?? ""));
  if (!source) throw new Error("usage: smoke <source-id>");
  const credential = source.credentialId ? await openCredential(db, source.credentialId, "smoke") : null;
  const adapter = adapterFor(source.kind);
  const ctx2: AdapterContext = {
    source: {
      id: source.id,
      name: source.name,
      config: (source.config ?? {}) as Record<string, unknown>,
      mapping: parseMapping(source.categoryMapping),
    },
    credential,
    now: new Date(),
    homeTimeZone: await getHomeTimeZone(db),
  };
  const batch = adapter.normalise(await adapter.fetchRaw(ctx2), ctx2);
  const upcoming = batch.records
    .filter((r) => r.startUtc >= ctx2.now)
    .sort((a, b) => +a.startUtc - +b.startUtc)
    .slice(0, 5)
    .map((r) => `${r.startUtc.toISOString()} ${r.category} ${r.title}`);
  ctx.log("smoke test ok", {
    source: source.name,
    records: batch.records.length,
    warnings: batch.warnings,
    upcoming,
    ...(batch.swim && {
      swimMeets: batch.swim.meets.length,
      swimResults: batch.swim.results.length,
      latestSwims: [...batch.swim.results]
        .sort((a, b) => b.swimDate.localeCompare(a.swimDate))
        .slice(0, 5)
        .map((r) => `${r.swimDate} ${r.distance} ${r.stroke} ${r.course} ${r.timeMs ?? "no time"}`),
    }),
    ...(batch.tennis && {
      tennisPlayers: batch.tennis.players.length,
      tennisTournaments: batch.tennis.tournaments.length,
      tennisMatches: batch.tennis.matches.length,
      tennisDraws: batch.tennis.draws.map(
        (d) =>
          `${d.drawName ?? d.drawNo}: ${d.nextMatch?.status ?? "none"}${d.position ? ` line ${d.position}` : ""}`,
      ),
    }),
  });
}
