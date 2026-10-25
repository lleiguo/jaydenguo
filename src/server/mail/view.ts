import { and, asc, desc, eq, gte, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { emailSuggestions, mailItems, mailTodos, sources, syncRuns } from "@db/schema";
import { addDays, localDate } from "../../domain/time";
import { emailSource } from "../assistant/email";
import type { Db, DbOrTx } from "../db/client";
import { HttpError } from "../errors";
import type { JobLauncher } from "../jobs/launcher";
import { getHomeTimeZone } from "../settings";
import { requestRefresh } from "../sources";
import { DIGEST_LIMITS } from "./digest";

// What the Mail screen shows (intent 0025, MD-5, MD-6, MT-2, MG-3).

export const mailQuery = z.object({
  days: z.coerce.number().int().min(1).max(DIGEST_LIMITS.keepDays).optional(),
});
export const todoPatch = z.object({ done: z.boolean() });

export type MailTodoView = {
  id: string;
  itemId: string | null;
  subject: string;
  messageUrl: string;
  text: string;
  dueOn: string | null;
  people: string[];
  done: boolean;
  // MT-4: open and its due date has passed.
  overdue: boolean;
};

export type MailItemView = {
  id: string;
  receivedAt: string;
  senderName: string;
  senderAddress: string;
  subject: string;
  messageUrl: string;
  // Null when it wasn't summarized; `skipped` says why (MD-7, MD-8, MSEC-5).
  summary: string | null;
  skipped: "limit" | "cap" | "failed" | null;
  language: string | null;
  routine: boolean;
  newsletter: { picked: string[]; others: string[] } | null;
  people: string[];
  topic: string;
  // MT-3: the suggestion made from the same email.
  suggestion: { id: string; status: string; title: string; date: string | null } | null;
  read: boolean;
  todos: MailTodoView[];
};

export type MailDayView = { day: string; items: MailItemView[] };

export type MailView = {
  // No email source, or one switched off (MS-1).
  connected: boolean;
  today: string;
  days: MailDayView[];
  // Open to-dos from every kept day, soonest due first, undated last (MT-2).
  todos: MailTodoView[];
  // MD-6: today's card.
  unread: number;
  openTodos: number;
  // MD-8: the email source's last run.
  lastRun: { at: string; status: string } | null;
};

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function todoView(t: typeof mailTodos.$inferSelect, today: string): MailTodoView {
  return {
    id: t.id,
    itemId: t.itemId,
    subject: t.subject,
    messageUrl: t.messageUrl,
    text: t.text,
    dueOn: t.dueOn,
    people: t.people,
    done: !!t.doneAt,
    overdue: !t.doneAt && !!t.dueOn && t.dueOn < today,
  };
}

export async function loadMail(
  db: Db,
  userId: string,
  now = new Date(),
  days: number = DIGEST_LIMITS.keepDays,
): Promise<MailView> {
  const tz = await getHomeTimeZone(db);
  const today = localDate(now, tz);
  const from = addDays(today, -(days - 1));
  const source = await emailSource(db);
  const [items, todos, lastRun] = await Promise.all([
    db
      .select({
        item: mailItems,
        suggestion: {
          id: emailSuggestions.id,
          status: emailSuggestions.status,
          extracted: emailSuggestions.extracted,
        },
      })
      .from(mailItems)
      .leftJoin(emailSuggestions, eq(emailSuggestions.id, mailItems.suggestionId))
      .where(gte(mailItems.day, from))
      .orderBy(desc(mailItems.day), desc(mailItems.receivedAt)),
    db
      .select()
      .from(mailTodos)
      // Done ones stay a day (MT-2), so a tick can be undone.
      .where(or(isNull(mailTodos.doneAt), gte(mailTodos.doneAt, new Date(now.getTime() - 86_400_000))))
      .orderBy(sql`${mailTodos.dueOn} asc nulls last`, asc(mailTodos.createdAt)),
    source
      ? db
          .select({ at: syncRuns.startedAt, status: syncRuns.status })
          .from(syncRuns)
          .where(and(eq(syncRuns.sourceId, source.id)))
          .orderBy(desc(syncRuns.startedAt))
          .limit(1)
      : Promise.resolve([]),
  ]);
  const todoViews = todos.map((t) => todoView(t, today));
  const byDay = new Map<string, MailItemView[]>();
  for (const { item, suggestion } of items) {
    const ex = (suggestion?.extracted ?? {}) as { title?: string; date?: string | null };
    const view: MailItemView = {
      id: item.id,
      receivedAt: item.receivedAt.toISOString(),
      senderName: item.senderName,
      senderAddress: item.senderAddress,
      subject: item.subject,
      messageUrl: item.messageUrl,
      summary: item.summary,
      skipped: item.skipped as MailItemView["skipped"],
      language: item.language,
      routine: item.routine,
      newsletter: item.newsletter ?? null,
      people: item.people,
      topic: item.topic,
      suggestion: suggestion?.id
        ? { id: suggestion.id, status: suggestion.status, title: ex.title ?? "", date: ex.date ?? null }
        : null,
      read: item.readBy.includes(userId),
      todos: todoViews.filter((t) => t.itemId === item.id),
    };
    const list = byDay.get(item.day) ?? [];
    list.push(view);
    byDay.set(item.day, list);
  }
  const open = todoViews.filter((t) => !t.done);
  const todays = byDay.get(today) ?? [];
  return {
    connected: !!source?.enabled,
    today,
    days: [...byDay.entries()].map(([day, list]) => ({ day, items: list })),
    todos: todoViews,
    unread: todays.filter((i) => !i.read && !i.routine).length,
    openTodos: open.length,
    lastRun: lastRun[0] ? { at: iso(lastRun[0].at)!, status: lastRun[0].status } : null,
  };
}

// MD-6: read once its summary has been on screen or read aloud.
export async function markMailRead(db: DbOrTx, userId: string, id: string) {
  const rows = await db
    .update(mailItems)
    .set({ readBy: sql`array_append(array_remove(${mailItems.readBy}, ${userId}::uuid), ${userId}::uuid)` })
    .where(eq(mailItems.id, id))
    .returning({ id: mailItems.id });
  if (!rows.length) throw new HttpError(404, "not found");
}

// MT-2: ticked by either parent, for both.
export async function setTodoDone(db: DbOrTx, email: string, id: string, done: boolean, now = new Date()) {
  const [row] = await db
    .update(mailTodos)
    .set(done ? { doneAt: now, doneBy: email } : { doneAt: null, doneBy: null })
    .where(eq(mailTodos.id, id))
    .returning();
  if (!row) throw new HttpError(404, "not found");
  return todoView(row, localDate(now, await getHomeTimeZone(db)));
}

// MD-2: pull to refresh reads the email source again (SYNC-5's limits).
export async function requestMailRefresh(db: Db, launcher: JobLauncher) {
  const source = await emailSource(db);
  if (!source?.enabled)
    throw new HttpError(409, "Gmail isn't set up for reading mail. Add it under Settings → Sources.");
  await requestRefresh(db, source.id, launcher);
}

// The email source the digest reads, for the `mail:digest` job (MD-1).
export async function digestSourceIds(db: Db): Promise<string[]> {
  const rows = await db
    .select({ id: sources.id })
    .from(sources)
    .where(and(eq(sources.kind, "gmail"), eq(sources.enabled, true)));
  return rows.map((r) => r.id);
}
