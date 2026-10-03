import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { assistantActions, assistantTurns, events, sources, users } from "@db/schema";
import { CHANGE_LIMITS, type ActionState } from "@/domain/assistant-changes";
import { parseMapping, type CategoryMapping } from "@/domain/categories";
import { resolveOwners, type Person } from "@/domain/people";
import { deleteEvent } from "../calendar/mutations";
import type { Db, DbOrTx } from "../db/client";
import { HttpError } from "../errors";
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
  // adding: in the hub, on its way to the family calendar. added: in both.
  // failed: the family calendar refused it, so it was removed. undone:
  // taken back.
  state: "adding" | "added" | "failed" | "undone";
};

export type Did = {
  kind: "added";
  // Until when Undo is offered; null once nothing is left to undo.
  undoUntil: string | null;
  events: DidEvent[];
};

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
    .select({ action: assistantActions, event: events })
    .from(assistantActions)
    .leftJoin(events, eq(events.id, assistantActions.eventId))
    .where(and(inArray(assistantActions.turnId, turnIds), eq(assistantActions.kind, "add_event")))
    .orderBy(assistantActions.createdAt);
  if (!rows.length) return out;
  const everyone = people ?? (await listPeople(db));
  for (const { action, event } of rows) {
    if (!action.turnId || !event) continue;
    const did = out.get(action.turnId) ?? { kind: "added" as const, undoUntil: null, events: [] };
    const state = action.state as ActionState;
    if (state === "pending" || state === "done") did.undoUntil = undoEnds(action.createdAt).toISOString();
    const owners = resolveOwners(event.ownerIds, everyone);
    did.events.push({
      id: event.deletedAt ? null : event.id,
      title: event.title,
      start: event.startUtc.toISOString(),
      end: event.endUtc.toISOString(),
      allDay: event.allDay,
      owners: everyone.filter((p) => owners.includes(p.id)).map((p) => p.name),
      state: SHOWN[state],
    });
    out.set(action.turnId, did);
  }
  return out;
}

export type AddTarget = { sourceId: string; mapping: CategoryMapping };

// GCW-1, GCW-8: the household Google Calendar she adds to: the one chosen
// in Settings → Cookie, or the only Google Calendar source there is.
export async function addTarget(db: DbOrTx, settings: AssistantSettings): Promise<AddTarget | null> {
  const rows = await db
    .select({ id: sources.id, mapping: sources.categoryMapping, enabled: sources.enabled })
    .from(sources)
    .where(eq(sources.kind, "google_calendar"));
  const reading = rows.filter((r) => r.enabled);
  const row = settings.addCalendarSourceId
    ? rows.find((r) => r.id === settings.addCalendarSourceId)
    : reading.length === 1
      ? reading[0]
      : undefined;
  return row ? { sourceId: row.id, mapping: parseMapping(row.mapping) } : null;
}

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
// only if nothing has touched the events since.
export async function undoTurn(db: Db, userId: string, turnId: string, now = new Date()): Promise<Did> {
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
  const open = rows.filter((r) => r.action.state === "pending" || r.action.state === "done");
  if (!rows.length) throw new HttpError(404, "not found");
  if (!open.length) throw new HttpError(409, "There is nothing left to undo.");
  if (open.some((r) => now > undoEnds(r.action.createdAt)))
    throw new HttpError(409, "It's too late to undo that here. Change the event on the calendar.");
  // Written to Google already: the worker has to take it back (plan E2).
  if (open.some((r) => r.action.state === "done"))
    throw new HttpError(409, "That is on the family calendar now. Remove it there.");
  for (const { action, event } of open) {
    if (!event || event.deletedAt || event.updatedAt.getTime() > action.createdAt.getTime() + 2000)
      throw new HttpError(409, "That event has been changed since, so it was left as it is.");
  }
  const actor = await cookieActor(db, userId);
  for (const { action, event } of open) {
    // Claimed first, so the worker never writes an event that is being undone.
    const [mine] = await db
      .update(assistantActions)
      .set({ state: "undone", undoneAt: now })
      .where(and(eq(assistantActions.id, action.id), eq(assistantActions.state, "pending")))
      .returning({ id: assistantActions.id });
    if (!mine) throw new HttpError(409, "That is on the family calendar now. Remove it there.");
    await deleteEvent(db, actor, event!.id);
  }
  return (await didFor(db, [turnId])).get(turnId)!;
}
