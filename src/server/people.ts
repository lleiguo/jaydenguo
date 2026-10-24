import { and, arrayOverlaps, asc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { changeLog, eventOverrides, events, eventSeries, people, sources, users } from "@db/schema";
import { parseMapping, personWithEmail } from "../domain/categories";
import type { Person } from "../domain/people";
import type { Db, DbOrTx } from "./db/client";
import { HttpError } from "./errors";

// People whose events the calendar holds (owner, 2026-09-28): added,
// renamed and removed in Settings. The primary person can be renamed but
// not removed.

export const personInput = z.object({ name: z.string().trim().min(1).max(40) });

// Intent 0024, OWN-6: a person's Google emails, so an event they made with
// no name in it is theirs.
export const emailsInput = z.object({
  emails: z.array(z.string().trim().toLowerCase().pipe(z.email("that isn't an email address"))).max(5),
});

export async function listPeopleEmails(db: DbOrTx): Promise<{ id: string; emails: string[] }[]> {
  return db.select({ id: people.id, emails: people.emails }).from(people);
}

// The person a signed-in parent is, by their email (OWN-4).
export async function personOfUser(db: DbOrTx, userId: string): Promise<string | null> {
  const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
  return personWithEmail(u?.email, await listPeopleEmails(db));
}

export async function setEmails(db: Db, id: string, emails: string[]) {
  const unique = [...new Set(emails)];
  const [other] = unique.length
    ? await db
        .select({ name: people.name })
        .from(people)
        .where(and(ne(people.id, id), arrayOverlaps(people.emails, unique)))
    : [];
  if (other) throw new HttpError(409, `that email is already ${other.name}'s`);
  const [p] = await db
    .update(people)
    .set({ emails: unique })
    .where(eq(people.id, id))
    .returning({ id: people.id });
  if (!p) throw new HttpError(404, "not found");
  await db.insert(changeLog).values({ kind: "people", refId: id });
}

export async function listPeople(db: DbOrTx): Promise<Person[]> {
  return db
    .select({ id: people.id, name: people.name, isPrimary: people.isPrimary })
    .from(people)
    .orderBy(sql`${people.isPrimary} desc`, asc(people.sortOrder), asc(people.createdAt));
}

async function checkFree(db: DbOrTx, name: string, except?: string) {
  const [other] = await db
    .select({ id: people.id })
    .from(people)
    .where(sql`lower(${people.name}) = lower(${name})`);
  if (other && other.id !== except) throw new HttpError(409, `there's already someone called ${name}`);
}

export async function addPerson(db: Db, name: string) {
  await checkFree(db, name);
  const [p] = await db.insert(people).values({ name }).returning({ id: people.id });
  await db.insert(changeLog).values({ kind: "people", refId: p.id });
  return p.id;
}

export async function renamePerson(db: Db, id: string, name: string) {
  await checkFree(db, name, id);
  const [p] = await db.update(people).set({ name }).where(eq(people.id, id)).returning({ id: people.id });
  if (!p) throw new HttpError(404, "not found");
  await db.insert(changeLog).values({ kind: "people", refId: id });
}

// Their events go back to the primary person (or to their other owners),
// and sources stop naming them.
export async function removePerson(db: Db, id: string) {
  await db.transaction(async (tx) => {
    const [p] = await tx.select().from(people).where(eq(people.id, id));
    if (!p) throw new HttpError(404, "not found");
    if (p.isPrimary)
      throw new HttpError(409, `${p.name} is the person this site is about and can't be removed`);
    await tx.update(events).set({ ownerIds: sql`array_remove(${events.ownerIds}, ${id}::uuid)` });
    await tx.update(eventSeries).set({ ownerIds: sql`array_remove(${eventSeries.ownerIds}, ${id}::uuid)` });
    await tx
      .update(eventOverrides)
      .set({ ownerIds: sql`array_remove(${eventOverrides.ownerIds}, ${id}::uuid)` })
      .where(sql`${eventOverrides.ownerIds} is not null`);
    for (const s of await tx.select({ id: sources.id, mapping: sources.categoryMapping }).from(sources)) {
      const m = parseMapping(s.mapping);
      const named = m.owners?.includes(id) || m.rules?.some((r) => r.owner === id);
      if (!named) continue;
      const next = {
        ...m,
        owners: m.owners?.filter((o) => o !== id),
        // A rule that only gave events to them goes; others just lose the owner.
        rules: m.rules
          ?.map((r) => (r.owner === id ? { ...r, owner: undefined } : r))
          .filter((r) => r.category || r.attendance || r.owner),
      };
      await tx.update(sources).set({ categoryMapping: next }).where(eq(sources.id, s.id));
    }
    await tx.delete(people).where(eq(people.id, id));
    await tx.insert(changeLog).values({ kind: "people", refId: id });
  });
}
