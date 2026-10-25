import { and, desc, eq, gte, isNotNull, isNull } from "drizzle-orm";
import { mailItems, mailTodos, notifications } from "@db/schema";
import { localDate } from "../../domain/time";
import type { Db } from "../db/client";
import type { Logger } from "../log";
import { notify, type NotifyDeps } from "../push/notify";

// The morning notification (intent 0025, MA-4, MT-4): sent by the 06:30
// `mail:digest` run when mail was summarized since the last one, to every
// parent's phone that has "Today's mail" on. The 05:00 daily sync may have
// summarized the night's mail already, so "new" means since the last
// morning push (or the last day), not since this run.

const DAY_MS = 86_400_000;

export type MailNotice = { title: string; body: string } | null;

export async function mailNotice(db: Db, now: Date, homeTimeZone: string): Promise<MailNotice> {
  const [last] = await db
    .select({ at: notifications.createdAt })
    .from(notifications)
    .where(eq(notifications.kind, "mail"))
    .orderBy(desc(notifications.createdAt))
    .limit(1);
  const since =
    last && now.getTime() - last.at.getTime() < DAY_MS ? last.at : new Date(now.getTime() - DAY_MS);
  // Mail worth reading: summarized, not routine.
  const fresh = await db
    .select({ id: mailItems.id })
    .from(mailItems)
    .where(and(gte(mailItems.createdAt, since), eq(mailItems.routine, false), isNotNull(mailItems.summary)));
  if (!fresh.length) return null;
  const today = localDate(now, homeTimeZone);
  const open = await db.select({ dueOn: mailTodos.dueOn }).from(mailTodos).where(isNull(mailTodos.doneAt));
  const overdue = open.filter((t) => t.dueOn && t.dueOn < today).length;
  const parts = [
    `${fresh.length} ${fresh.length === 1 ? "email" : "emails"}`,
    `${open.length} to do`,
    ...(overdue ? [`${overdue} overdue`] : []),
  ];
  return { title: "Today's mail", body: parts.join(", ") };
}

export async function notifyMail(
  db: Db,
  opts: { now: Date; homeTimeZone: string; log: Logger } & Pick<NotifyDeps, "sender">,
) {
  const notice = await mailNotice(db, opts.now, opts.homeTimeZone);
  if (!notice) {
    opts.log("mail notification skipped", { reason: "no new mail" });
    return null;
  }
  // One a day, whatever reruns the job.
  return notify(
    db,
    { kind: "mail", dedupKey: `mail:${localDate(opts.now, opts.homeTimeZone)}`, target: "mail", ...notice },
    { log: opts.log, now: opts.now, sender: opts.sender },
  );
}
