import { and, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { assistantActions, credentials, eventOverrides, events, householdLinks, sources } from "@db/schema";
import { googleAccessToken } from "../adapters/google-calendar";
import {
  Fenced,
  householdWriter,
  WriteFailed,
  type HouseholdWriter,
} from "../adapters/google-calendar/writer";
import { SyncError } from "../adapters/types";
import { ADD_SCOPE } from "../domain/assistant-changes";
import type { Category } from "../domain/constants";
import { HOUSEHOLD_KINDS, hiddenDuplicates } from "../domain/duplicates";
import {
  planHousehold,
  WINDOW_DAYS,
  type HouseholdLink,
  type HouseholdPlan,
  type PlanItem,
} from "../domain/household-sync";
import { resolveOwners } from "../domain/people";
import { repeatKey } from "../domain/repeats";
import type { Db } from "../server/db/client";
import {
  getHouseholdSync,
  saveHouseholdSync,
  type PlanLine,
  type PlanSummary,
} from "../server/household-sync";
import { registerSecret, type Logger } from "../server/log";
import { listPeople } from "../server/people";
import { notify, type NotifyDeps } from "../server/push/notify";
import { getHomeTimeZone } from "../server/settings";
import type { JobContext } from "./context";
import { openCredential } from "./credentials";

// `household:sync` (intent 0020, H2): writes the hub's events into the
// household Google Calendar so it holds everything once (TWO), after a dry
// run the owner checked (TWO-9) and past the brake (TWSEC-2). Started after
// changes on the calendar, after every sync, and on "Apply". Reading
// Google edits back is H3.

const PAST_DAYS = 30;
const LINES = 50;

export class HouseholdSyncError extends SyncError {}

export type HouseholdDeps = {
  log: Logger;
  now?: () => Date;
  // The real Google, or a stand-in in tests.
  writerFor?: (
    db: Db,
    credentialId: string,
    calendarId: string,
    opts: { now: Date; untagged: Set<string> },
  ) => Promise<HouseholdWriter>;
  notifyDeps?: NotifyDeps;
};

async function googleWriter(
  db: Db,
  credentialId: string,
  calendarId: string,
  opts: { now: Date; untagged: Set<string> },
) {
  const [row] = await db
    .select({ scopes: credentials.scopes, status: credentials.status })
    .from(credentials)
    .where(eq(credentials.id, credentialId));
  // TWSEC-3: the grant Cookie already uses, nothing wider.
  if (!row || row.status !== "active" || !row.scopes?.includes(ADD_SCOPE))
    throw new HouseholdSyncError(
      "The household calendar's Google account can't write: press \"Let Cookie add events\" on the Accounts page.",
    );
  const cred = await openCredential(db, credentialId, "two-way sync with the household calendar");
  const token = await googleAccessToken(cred.secret);
  registerSecret(token);
  return householdWriter(token, calendarId, opts);
}

async function householdSource(db: Db, sourceId: string | null) {
  const rows = await db
    .select()
    .from(sources)
    .where(and(eq(sources.kind, "google_calendar"), eq(sources.enabled, true)));
  const source = sourceId ? rows.find((r) => r.id === sourceId) : rows.length === 1 ? rows[0] : undefined;
  const calendarId = (source?.config as { calendarId?: unknown } | undefined)?.calendarId;
  if (!source || typeof calendarId !== "string" || !source.credentialId)
    throw new HouseholdSyncError("The household Google calendar isn't set up. Choose it in Settings.");
  return { source, calendarId, credentialId: source.credentialId };
}

// Every event the plan needs: the window, plus anything already linked.
async function loadItems(db: Db, links: HouseholdLink[], now: Date): Promise<PlanItem[]> {
  const people = await listPeople(db);
  const lo = new Date(now.getTime() - PAST_DAYS * 86_400_000);
  const hi = new Date(now.getTime() + WINDOW_DAYS * 86_400_000);
  const effStart = sql<Date>`coalesce(${eventOverrides.newStartUtc}, ${events.startUtc})`;
  const effEnd = sql<Date>`coalesce(${eventOverrides.newEndUtc}, ${events.endUtc})`;
  const linkedIds = links.map((l) => l.hubKey).filter((k) => /^[0-9a-f-]{36}$/i.test(k));
  const rows = await db
    .select({ event: events, override: eventOverrides, kind: sources.kind })
    .from(events)
    .leftJoin(eventOverrides, and(eq(eventOverrides.eventId, events.id), isNull(eventOverrides.clearedAt)))
    .leftJoin(sources, eq(sources.id, events.sourceId))
    .where(
      and(
        or(
          and(lt(effStart, hi), gt(effEnd, lo)),
          linkedIds.length ? inArray(events.id, linkedIds) : sql`false`,
        ),
        // An event Cookie is still adding goes to Google through her own
        // job (0008 GCW-5); it comes back as a household event.
        sql`not exists (
          select 1 from ${assistantActions}
          where ${assistantActions.eventId} = ${events.id} and ${assistantActions.state} = 'pending'
        )`,
      ),
    );
  const items: PlanItem[] = rows.map(({ event: e, override: o, kind }) => ({
    id: e.id,
    sourceKind: kind ?? null,
    title: e.title,
    category: e.category as Category,
    owners: resolveOwners(o?.ownerIds ?? e.ownerIds, people),
    start: (o?.newStartUtc ?? e.startUtc).toISOString(),
    end: (o?.newEndUtc ?? e.endUtc).toISOString(),
    allDay: e.allDay,
    locationName: e.locationName,
    notes: e.notes,
    active: e.status === "active" && !e.deletedAt && !o?.skip,
    repeats: !!repeatKey({ ...e, sourceKind: kind ?? null }),
    createdAt: e.createdAt,
    googleEventId: kind && HOUSEHOLD_KINDS.includes(kind) ? e.externalId : null,
  }));
  // An email event that repeats a feed's shows once on the calendar
  // (0013 DUP-5), so it goes to Household once too. Household twins stay:
  // the plan links them (DUP2-2).
  const hidden = hiddenDuplicates(
    items.filter((i) => i.active).map((i) => ({ ...i, start: new Date(i.start), end: new Date(i.end) })),
  );
  return items.map((i) =>
    hidden.has(i.id) && !(i.sourceKind && HOUSEHOLD_KINDS.includes(i.sourceKind))
      ? { ...i, active: false }
      : i,
  );
}

function summarise(plan: HouseholdPlan, items: PlanItem[]): PlanSummary {
  const byId = new Map(items.map((i) => [i.id, i]));
  const line = (hubKey: string): PlanLine => {
    if (hubKey.startsWith("school:")) return { title: "School", start: hubKey.slice(7, 17) };
    const i = byId.get(hubKey);
    return i ? { title: i.title, start: i.start } : { title: "(an event no longer in the hub)", start: "" };
  };
  const lines = (xs: { hubKey: string }[]) => xs.slice(0, LINES).map((x) => line(x.hubKey));
  return {
    create: lines(plan.create),
    update: lines(plan.update),
    link: lines(plan.link),
    remove: lines(plan.remove),
    unlink: lines(plan.unlink),
  };
}

async function write(db: Db, sourceId: string, writer: HouseholdWriter, plan: HouseholdPlan, log: Logger) {
  const counts = { created: 0, updated: 0, linked: 0, deleted: 0, unlinked: 0 };
  const upsert = (
    hubKey: string,
    googleEventId: string,
    origin: "hub" | "twin",
    hash: string,
    updated?: string,
  ) =>
    db
      .insert(householdLinks)
      .values({
        sourceId,
        hubKey,
        googleEventId,
        origin,
        hash,
        googleUpdatedAt: updated ? new Date(updated) : null,
      })
      .onConflictDoUpdate({
        target: [householdLinks.sourceId, householdLinks.hubKey],
        set: {
          googleEventId,
          origin,
          hash,
          googleUpdatedAt: updated ? new Date(updated) : null,
          updatedAt: new Date(),
        },
      });
  const drop = (hubKey: string) =>
    db
      .delete(householdLinks)
      .where(and(eq(householdLinks.sourceId, sourceId), eq(householdLinks.hubKey, hubKey)));
  const gone = (err: unknown) => err instanceof WriteFailed && (err.status === 404 || err.status === 410);
  const fenced = (err: unknown, hubKey: string) => {
    if (!(err instanceof Fenced)) return false;
    log("household sync: fenced", { hubKey, reason: err.message }, "WARNING");
    return true;
  };

  for (const c of plan.create) {
    // DUP2-3: a run that died after Google took it finds it by its tag; an
    // empty hash makes the next run send the body again.
    const found = await writer.findTagged(c.hubKey);
    const g = found ?? (await writer.create(c.body));
    await upsert(c.hubKey, g.id, "hub", found ? "" : c.hash, g.updated);
    counts.created++;
  }
  for (const u of plan.update) {
    const [link] = await db
      .select({ origin: householdLinks.origin })
      .from(householdLinks)
      .where(and(eq(householdLinks.sourceId, sourceId), eq(householdLinks.hubKey, u.hubKey)));
    try {
      const g = await writer.patch(u.googleEventId, u.body);
      await upsert(u.hubKey, g.id, link?.origin === "twin" ? "twin" : "hub", u.hash, g.updated);
      counts.updated++;
    } catch (err) {
      // Deleted in Google, or no longer the hub's to change: the link goes,
      // and the next run adds it again if it is still wanted. (H3 reads a
      // Google delete of a feed's event as "skip", BACK-3.)
      if (!gone(err) && !fenced(err, u.hubKey)) throw err;
      await drop(u.hubKey);
    }
  }
  for (const l of plan.link) {
    try {
      const g = await writer.patch(l.googleEventId, l.body);
      await upsert(l.hubKey, g.id, "twin", l.hash, g.updated);
      counts.linked++;
    } catch (err) {
      if (!gone(err) && !fenced(err, l.hubKey)) throw err;
    }
  }
  for (const r of plan.remove) {
    try {
      await writer.remove(r.googleEventId);
      counts.deleted++;
    } catch (err) {
      if (!fenced(err, r.hubKey)) throw err;
    }
    await drop(r.hubKey);
  }
  for (const r of plan.unlink) {
    try {
      await writer.untag(r.googleEventId);
      counts.unlinked++;
    } catch (err) {
      if (!fenced(err, r.hubKey)) throw err;
    }
    await drop(r.hubKey);
  }
  return counts;
}

export async function runHouseholdSync(db: Db, deps: HouseholdDeps) {
  const now = (deps.now ?? (() => new Date()))();
  if ((await getHouseholdSync(db)).mode === "off") return { skipped: "switched off" as const };
  const settings = await saveHouseholdSync(db, { runStartedAt: now.toISOString() });
  const { source, calendarId, credentialId } = await householdSource(db, settings.sourceId);

  // DUP2-4: the household read and this job take turns (0001 SYNC-2's lock).
  const lockClient = await db.$client.connect();
  const lockKey = `sync-run:${source.id}`;
  try {
    await lockClient.query("select pg_advisory_lock(hashtext($1))", [lockKey]);
    try {
      const links = (
        await db.select().from(householdLinks).where(eq(householdLinks.sourceId, source.id))
      ).map((l) => ({ ...l, origin: l.origin as HouseholdLink["origin"] }));
      const items = await loadItems(db, links, now);
      const plan = planHousehold({
        items,
        people: await listPeople(db),
        links,
        timeZone: await getHomeTimeZone(db),
        now,
        overrideBrake: settings.applyOnce,
      });
      const summary = summarise(plan, items);
      if (settings.mode === "dry_run") {
        await saveHouseholdSync(db, { dryRun: { at: now.toISOString(), plan: summary }, held: null });
        return { dryRun: true as const };
      }
      const reason =
        settings.holdNext && !settings.applyOnce
          ? "The first run after switching on waits for you to check it."
          : plan.held;
      const nothing =
        !plan.create.length &&
        !plan.update.length &&
        !plan.link.length &&
        !plan.remove.length &&
        !plan.unlink.length;
      if (reason && !nothing) {
        await saveHouseholdSync(db, { held: { reason, at: now.toISOString(), plan: summary } });
        await notify(
          db,
          {
            kind: "sync_failed",
            dedupKey: `household_held:${now.toISOString().slice(0, 10)}`,
            title: "Household calendar: a run is waiting",
            body: `${reason} Check the list in Settings and press Apply.`,
            target: "settings",
          },
          deps.notifyDeps,
        );
        return { held: reason };
      }
      const untagged = new Set(plan.link.map((l) => l.googleEventId));
      const writer = await (deps.writerFor ?? googleWriter)(db, credentialId, calendarId, { now, untagged });
      const counts = await write(db, source.id, writer, plan, deps.log);
      await saveHouseholdSync(db, { held: null, holdNext: false, applyOnce: false, last: counts });
      return counts;
    } finally {
      await lockClient.query("select pg_advisory_unlock(hashtext($1))", [lockKey]);
    }
  } finally {
    lockClient.release();
  }
}

export async function householdSyncJob(_args: string[], ctx: JobContext) {
  const db = await ctx.db();
  try {
    const result = await runHouseholdSync(db, { log: ctx.log });
    if (!("skipped" in result))
      await saveHouseholdSync(db, { lastRunAt: new Date().toISOString(), lastError: null });
    ctx.log("household sync", result);
  } catch (err) {
    const message =
      err instanceof SyncError
        ? err.message
        : err instanceof WriteFailed
          ? `Google Calendar answered ${err.status}. It will be tried again.`
          : "The household calendar sync failed unexpectedly. It will be tried again.";
    await saveHouseholdSync(db, { lastRunAt: new Date().toISOString(), lastError: message });
    ctx.log("household sync failed", { error: err }, "WARNING");
  }
}
