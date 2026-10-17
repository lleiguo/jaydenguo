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
import { parseMapping } from "../domain/categories";
import type { Category } from "../domain/constants";
import { EMAIL_KINDS, HOUSEHOLD_KINDS, hiddenDuplicates } from "../domain/duplicates";
import {
  BRAKE,
  planHousehold,
  readBack,
  WINDOW_DAYS,
  type GoogleSeen,
  type HouseholdLink,
  type HouseholdPlan,
  type PlanItem,
} from "../domain/household-sync";
import { resolveOwners } from "../domain/people";
import { repeatKey } from "../domain/repeats";
import { applyGoogleChange, householdEditWritten, noteHubWon } from "../server/calendar/mutations";
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
// changes on the calendar, after every sync, and on "Apply". Before
// writing, it reads back what was changed in Google since (BACK, H3).

const PAST_DAYS = 30;
const LINES = 50;
const ACTOR = "household sync";

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
    hubMade: (!kind && !e.seriesId) || (!!kind && EMAIL_KINDS.includes(kind)),
    changedAt: o && o.createdAt > e.updatedAt ? o.createdAt : e.updatedAt,
    override: o ? { id: o.id, moved: !!o.newStartUtc, skip: o.skip } : null,
    deleted: !!e.deletedAt && e.status === "active",
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
  const edits = (kind: string) =>
    plan.edits.filter((e) => e.kind === kind).map((e) => ({ hubKey: e.eventId }));
  return {
    create: lines(plan.create),
    update: lines([...plan.update, ...edits("patch")]),
    link: lines(plan.link),
    remove: lines([...plan.remove, ...edits("remove")]),
    unlink: lines(plan.unlink),
  };
}

const loadLinks = async (db: Db, sourceId: string): Promise<HouseholdLink[]> =>
  (await db.select().from(householdLinks).where(eq(householdLinks.sourceId, sourceId))).map((l) => ({
    ...l,
    origin: l.origin as HouseholdLink["origin"],
  }));

// BACK-2: what Google holds now of each event the hub wrote that is still
// coming up. One read of the window; an event missing from it (moved out of
// the window, or deleted) is looked up by ID, so only a real delete counts.
async function readGoogle(writer: HouseholdWriter, links: HouseholdLink[], items: PlanItem[], now: Date) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const google = new Map<string, GoogleSeen | "gone">();
  const horizon = new Date(now.getTime() + (WINDOW_DAYS + 1) * 86_400_000);
  for (const e of await writer.listTagged(now, horizon)) google.set(e.id, e as GoogleSeen);
  for (const l of links) {
    const item = byId.get(l.hubKey);
    if (!item?.active || Date.parse(item.end) <= now.getTime() || google.has(l.googleEventId)) continue;
    const e = await writer.get(l.googleEventId);
    google.set(l.googleEventId, e ? (e as GoogleSeen) : "gone");
  }
  return google;
}

async function write(db: Db, sourceId: string, writer: HouseholdWriter, plan: HouseholdPlan, log: Logger) {
  const counts = { created: 0, updated: 0, linked: 0, deleted: 0, unlinked: 0, fromGoogle: 0 };
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
  // TWO-4: household events changed in the hub. Until Google has the
  // change the override stays, so nothing is lost if Google refuses it
  // (SP-T1: an event another account made, say).
  for (const e of plan.edits) {
    try {
      if (e.kind === "patch") await writer.patch(e.googleEventId, e.body);
      else await writer.remove(e.googleEventId);
    } catch (err) {
      if (fenced(err, e.eventId)) continue;
      if (err instanceof WriteFailed && !err.retry) {
        log("household sync: Google refused a change", { eventId: e.eventId, status: err.status }, "WARNING");
        continue;
      }
      throw err;
    }
    await householdEditWritten(db, ACTOR, e);
    if (e.kind === "patch") counts.updated++;
    else counts.deleted++;
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
      const people = await listPeople(db);
      const timeZone = await getHomeTimeZone(db);
      let links = await loadLinks(db, source.id);
      let items = await loadItems(db, links, now);
      // Named untagged events the writer may change (TWSEC-1), filled in
      // once the plan is known.
      const untagged = new Set<string>();
      let writer: HouseholdWriter | null = null;
      let fromGoogle = 0;
      if (settings.mode === "on") {
        writer = await (deps.writerFor ?? googleWriter)(db, credentialId, calendarId, { now, untagged });
        // BACK-2..5: changes made in Google since the last run come first.
        const google = await readGoogle(writer, links, items, now);
        const back = readBack({ items, people, links, google, timeZone, now });
        const deletes = back.changes.filter((c) => c.kind === "delete" || c.kind === "skip");
        if (deletes.length > BRAKE.deletes && !settings.applyOnce) {
          const reason = `${deletes.length} events the hub wrote were deleted in the household calendar; applying takes them out of the hub too.`;
          const byId = new Map(items.map((i) => [i.id, i]));
          const lines = deletes.slice(0, LINES).map((c) => ({
            title: byId.get(c.eventId)?.title ?? "",
            start: byId.get(c.eventId)?.start ?? "",
          }));
          await saveHouseholdSync(db, {
            held: {
              reason,
              at: now.toISOString(),
              plan: { create: [], update: [], link: [], remove: lines, unlink: [] },
            },
          });
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
        const mapping = parseMapping(source.categoryMapping);
        for (const c of back.changes) await applyGoogleChange(db, c, { people, mapping });
        for (const k of back.hubWon) await noteHubWon(db, k);
        const stale = new Set(back.seen.filter((x) => x.stale).map((x) => x.hubKey));
        for (const x of back.seen)
          await db
            .update(householdLinks)
            .set({
              googleUpdatedAt: x.updated ? new Date(x.updated) : null,
              ...(stale.has(x.hubKey) ? { hash: "" } : {}),
              updatedAt: new Date(),
            })
            .where(and(eq(householdLinks.sourceId, source.id), eq(householdLinks.hubKey, x.hubKey)));
        if (back.gone.length)
          await db
            .delete(householdLinks)
            .where(and(eq(householdLinks.sourceId, source.id), inArray(householdLinks.hubKey, back.gone)));
        fromGoogle = back.changes.length;
        if (fromGoogle || stale.size || back.gone.length) {
          links = await loadLinks(db, source.id);
          items = await loadItems(db, links, now);
        }
        if (fromGoogle) deps.log("household sync: changes from Google", { count: fromGoogle });
      }
      const plan = planHousehold({
        items,
        people,
        links,
        timeZone,
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
        !plan.unlink.length &&
        !plan.edits.length;
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
      for (const l of plan.link) untagged.add(l.googleEventId);
      for (const e of plan.edits) untagged.add(e.googleEventId);
      const counts = await write(db, source.id, writer!, plan, deps.log);
      counts.fromGoogle = fromGoogle;
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
