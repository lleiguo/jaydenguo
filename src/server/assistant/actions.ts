import { and, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import {
  assistantActions,
  assistantTurns,
  changeLog,
  credentials,
  eventOverrides,
  events,
  sources,
  users,
} from "@db/schema";
import {
  ADD_SCOPE,
  appliedKind,
  CHANGE_LIMITS,
  type ActionState,
  type AppliedKind,
} from "@/domain/assistant-changes";
import type { Undo } from "@/lib/calendar-types";
import { parseMapping, type CategoryMapping } from "@/domain/categories";
import { resolveOwners, type Person } from "@/domain/people";
import { deleteEvent, moveEvent, undoOverride } from "../calendar/mutations";
import type { Db, DbOrTx } from "../db/client";
import { HttpError } from "../errors";
import { unapproveSuggestion } from "../email/suggestions";
import { listPeople } from "../people";
import type { AssistantSettings } from "./settings";

// What Cookie changed when a parent asked her to (intent 0008, ACT-1..4):
// recorded as actions, shown under her answer, and undone from there.

export type DidEvent = {
  // The hub's event; null once it is gone for good.
  id: string | null;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  // People's names.
  owners: string[];
  // adding: in the hub, on its way to the family calendar. added: done
  // (for an email suggestion, in the hub). failed: the family calendar
  // refused it, so it was removed. undone: taken back.
  state: "adding" | "added" | "failed" | "undone";
  // What happened to it: an event she added, or an email suggestion she
  // applied, which can also move or cancel an event (EMS-3, EMS-4).
  change: AppliedKind;
  via: "cookie" | "email";
};

export type Did = {
  kind: "calendar";
  // Until when Undo is offered; null once nothing is left to undo.
  undoUntil: string | null;
  events: DidEvent[];
};

const shown = (state: ActionState, undoneAt: Date | null): DidEvent["state"] =>
  undoneAt ? "undone" : SHOWN[state];

const SHOWN: Record<ActionState, DidEvent["state"]> = {
  pending: "adding",
  done: "added",
  failed: "failed",
  undone: "undone",
};

const undoEnds = (createdAt: Date) => new Date(createdAt.getTime() + CHANGE_LIMITS.undoMinutes * 60_000);

// ACT-1: what each of these turns changed, as the app shows it.
export async function didFor(db: DbOrTx, turnIds: string[], people?: Person[]): Promise<Map<string, Did>> {
  const out = new Map<string, Did>();
  if (!turnIds.length) return out;
  const rows = await db
    .select({ action: assistantActions, event: events, override: eventOverrides })
    .from(assistantActions)
    .leftJoin(events, eq(events.id, assistantActions.eventId))
    .leftJoin(eventOverrides, and(eq(eventOverrides.eventId, events.id), isNull(eventOverrides.clearedAt)))
    .where(inArray(assistantActions.turnId, turnIds))
    .orderBy(assistantActions.createdAt);
  if (!rows.length) return out;
  const everyone = people ?? (await listPeople(db));
  for (const { action, event, override } of rows) {
    if (!action.turnId || !event) continue;
    const did = out.get(action.turnId) ?? { kind: "calendar" as const, undoUntil: null, events: [] };
    const state = action.state as ActionState;
    if ((state === "pending" || state === "done") && !action.undoneAt)
      did.undoUntil = undoEnds(action.createdAt).toISOString();
    const owners = resolveOwners(override?.ownerIds ?? event.ownerIds, everyone);
    const applied = action.kind === "apply_suggestion";
    did.events.push({
      id: event.deletedAt ? null : event.id,
      title: event.title,
      // Where it is now, after a move.
      start: (override?.newStartUtc ?? event.startUtc).toISOString(),
      end: (override?.newEndUtc ?? event.endUtc).toISOString(),
      allDay: event.allDay,
      owners: everyone.filter((p) => owners.includes(p.id)).map((p) => p.name),
      state: shown(state, action.undoneAt),
      change: applied ? appliedKind((action.before as AppliedBefore | null)?.kind ?? "new") : "added",
      via: applied ? "email" : "cookie",
    });
    out.set(action.turnId, did);
  }
  return out;
}

// What Undo needs to take an applied suggestion back.
export type AppliedBefore = {
  kind: string;
  undo: Undo | null;
  // When it was applied, by the clock the event's own changes use.
  at?: string;
};

// The override an Undo would clear, from the URL the calendar handed back.
export const overrideOf = (undo: Undo | null) =>
  undo?.url.match(/^\/api\/v1\/overrides\/([0-9a-f-]{36})\/undo$/)?.[1] ?? null;

export type AddTarget = { sourceId: string; mapping: CategoryMapping; credentialId: string | null };

// GCW-1, GCW-8: the household Google Calendar she adds to: the one chosen
// in Settings → Cookie, or the only Google Calendar source there is.
export async function addTarget(db: DbOrTx, settings: AssistantSettings): Promise<AddTarget | null> {
  const rows = await db
    .select({
      id: sources.id,
      mapping: sources.categoryMapping,
      enabled: sources.enabled,
      credentialId: sources.credentialId,
    })
    .from(sources)
    .where(eq(sources.kind, "google_calendar"));
  const reading = rows.filter((r) => r.enabled);
  const row = settings.addCalendarSourceId
    ? rows.find((r) => r.id === settings.addCalendarSourceId)
    : reading.length === 1
      ? reading[0]
      : undefined;
  return row
    ? { sourceId: row.id, mapping: parseMapping(row.mapping), credentialId: row.credentialId }
    : null;
}

// GCW-8: she can add once there is a household calendar and its Google
// account has granted adding events. ASSISTANT_CALENDAR_ADD=fake skips the
// grant for local development and tests: events then stay "adding".
export async function canAdd(db: DbOrTx, settings: AssistantSettings): Promise<boolean> {
  const target = await addTarget(db, settings);
  if (!target) return false;
  if (fakeAdding()) return true;
  if (!target.credentialId) return false;
  const [cred] = await db
    .select({ scopes: credentials.scopes, status: credentials.status })
    .from(credentials)
    .where(eq(credentials.id, target.credentialId));
  return !!cred && cred.status === "active" && !!cred.scopes?.includes(ADD_SCOPE);
}

export const fakeAdding = () =>
  process.env.ASSISTANT_CALENDAR_ADD === "fake" && !process.env.K_SERVICE && !process.env.CLOUD_RUN_JOB;

// Starts the worker job that writes to Google (none while faking).
export type Launch = (args: string[]) => Promise<void>;

// Settings → Cookie → "Calendar she adds to": it has to be one of the
// hub's Google Calendar sources.
export async function checkAddCalendar(db: DbOrTx, sourceId: string | null | undefined) {
  if (!sourceId) return;
  const [row] = await db
    .select({ id: sources.id })
    .from(sources)
    .where(and(eq(sources.id, sourceId), eq(sources.kind, "google_calendar")));
  if (!row) throw new HttpError(400, "that isn't one of the hub's Google calendars");
}

// CASEC-5: how many changes the family has made through her in a day.
export async function changesSince(db: DbOrTx, since: Date): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(assistantActions)
    .where(gte(assistantActions.createdAt, since));
  return row?.n ?? 0;
}

// "pat@example.com (Cookie)": who an event's history names (ACT-2).
export async function cookieActor(db: DbOrTx, userId: string): Promise<string> {
  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
  return `${user?.email ?? "someone"} (Cookie)`;
}

// The question's turn now exists: its actions are tied to it.
export async function claimActions(db: DbOrTx, actionIds: string[], turnId: string) {
  if (!actionIds.length) return;
  await db.update(assistantActions).set({ turnId }).where(inArray(assistantActions.id, actionIds));
}

// ACT-3, ACT-4: Undo, for the account that asked, within ten minutes, and
// only if nothing has touched the events since. An event not yet in Google
// leaves the hub and is never written; one already there leaves the hub
// now, and the worker deletes it from Google.
export async function undoTurn(
  db: Db,
  userId: string,
  turnId: string,
  now = new Date(),
  launch?: Launch,
): Promise<Did> {
  const [turn] = await db
    .select({ id: assistantTurns.id })
    .from(assistantTurns)
    .where(and(eq(assistantTurns.id, turnId), eq(assistantTurns.userId, userId)));
  if (!turn) throw new HttpError(404, "not found");
  const rows = await db
    .select({ action: assistantActions, event: events })
    .from(assistantActions)
    .leftJoin(events, eq(events.id, assistantActions.eventId))
    .where(eq(assistantActions.turnId, turnId));
  if (!rows.length) throw new HttpError(404, "not found");
  const open = rows.filter(
    (r) => (r.action.state === "pending" || r.action.state === "done") && !r.action.undoneAt,
  );
  if (!open.length) throw new HttpError(409, "There is nothing left to undo.");
  if (open.some((r) => now > undoEnds(r.action.createdAt)))
    throw new HttpError(409, "It's too late to undo that here. Change the event on the calendar.");
  for (const { action, event } of open) {
    if (!(await unchangedSince(db, action, event)))
      throw new HttpError(409, "That event has been changed since, so it was left as it is.");
  }
  const actor = await cookieActor(db, userId);
  let toGoogle = false;
  for (const { action, event } of open) {
    if (action.kind === "apply_suggestion") {
      await unapply(db, actor, action, event!, now);
      continue;
    }
    if (action.state === "pending") {
      // Claimed first, so the worker never writes an event being undone.
      const [mine] = await db
        .update(assistantActions)
        .set({ state: "undone", undoneAt: now })
        .where(and(eq(assistantActions.id, action.id), eq(assistantActions.state, "pending")))
        .returning({ id: assistantActions.id });
      if (mine) {
        await deleteEvent(db, actor, event!.id);
        continue;
      }
    }
    // In Google already (or written while this ran): out of the hub now,
    // and the worker takes it out of Google.
    await db.transaction(async (tx) => {
      await tx
        .update(assistantActions)
        .set({ undoneAt: now })
        .where(and(eq(assistantActions.id, action.id), eq(assistantActions.state, "done")));
      await tx.update(events).set({ deletedAt: now, updatedAt: now }).where(eq(events.id, event!.id));
      await tx.insert(changeLog).values({ kind: "event", refId: event!.id });
    });
    toGoogle = true;
  }
  if (toGoogle) await launch?.(["assistant:actions"]).catch(() => undefined);
  return (await didFor(db, [turnId])).get(turnId)!;
}

type ActionRow = typeof assistantActions.$inferSelect;
type EventRow = typeof events.$inferSelect;

// ACT-4: nobody has touched the event since she changed it. For a move or a
// cancellation, the override she wrote is still the one in force.
async function unchangedSince(db: DbOrTx, action: ActionRow, event: EventRow | null): Promise<boolean> {
  if (!event || event.deletedAt) return false;
  const before = action.before as AppliedBefore | null;
  const overrideId = action.kind === "apply_suggestion" ? overrideOf(before?.undo ?? null) : null;
  if (overrideId) {
    const [o] = await db
      .select({ id: eventOverrides.id })
      .from(eventOverrides)
      .where(and(eq(eventOverrides.eventId, event.id), isNull(eventOverrides.clearedAt)));
    return o?.id === overrideId;
  }
  // The last time she touched the event: when the worker wrote it to
  // Google, when the suggestion was applied, or when it was added. Not
  // when the question began: the model takes seconds before it adds.
  const touched =
    action.kind === "add_event"
      ? (action.doneAt ?? event.createdAt)
      : before?.at
        ? new Date(before.at)
        : (action.doneAt ?? event.createdAt);
  return event.updatedAt.getTime() <= touched.getTime() + 2000;
}

// ACT-3 for an applied email suggestion: the event it added leaves the
// hub, a move or a cancellation is reversed, and the suggestion waits on
// the Suggestions page again. Nothing of it was in Google (EMS-6).
async function unapply(db: Db, actor: string, action: ActionRow, event: EventRow, now: Date) {
  const before = action.before as AppliedBefore | null;
  const overrideId = overrideOf(before?.undo ?? null);
  if (before?.kind === "new") {
    await db.transaction(async (tx) => {
      // A new external ID, so approving it again later can add it again.
      await tx
        .update(events)
        .set({ deletedAt: now, updatedAt: now, externalId: `${event.externalId}:undone:${action.id}` })
        .where(eq(events.id, event.id));
      await tx.insert(changeLog).values({ kind: "event", refId: event.id });
    });
  } else if (overrideId) {
    await undoOverride(db, actor, overrideId);
  } else if (before?.undo?.body) {
    // An event added on this site moved directly: move it back.
    const back = before.undo.body as { start: string; end: string };
    await moveEvent(db, actor, event.id, { start: new Date(back.start), end: new Date(back.end) });
  }
  if (action.suggestionId) await unapproveSuggestion(db, action.suggestionId);
  await db
    .update(assistantActions)
    .set({ state: "undone", undoneAt: now })
    .where(eq(assistantActions.id, action.id));
}
