import { and, desc, eq, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { assistantMemories, users } from "@db/schema";
import { looksSecret, MEMORY_LIMITS } from "@/domain/assistant";
import type { DbOrTx } from "../db/client";
import { HttpError } from "../errors";

// Cookie's memory (intent 0007, MEM-1..7): short facts the family told her
// to remember, one list for everyone. A forgotten fact can be restored for
// 30 days, then it is deleted for good.

export type MemoryVia = "voice" | "chat" | "settings";

export type MemoryView = {
  id: string;
  text: string;
  // Who it is about: `people.id`s; empty for the whole family.
  about: string[];
  via: MemoryVia;
  // The account that saved it.
  savedBy: string;
  createdAt: string;
  updatedAt: string | null;
  forgottenAt: string | null;
};

const text = z
  .string()
  .trim()
  .min(1, "say what to remember")
  .max(MEMORY_LIMITS.textChars, `keep it under ${MEMORY_LIMITS.textChars} characters`)
  .refine((t) => !looksSecret(t), "Cookie doesn't keep passwords, card numbers or sign-in codes");

export const memoryInput = z.object({ text, about: z.array(z.string().uuid()).max(10).optional() });
export const memoryPatch = z.object({
  text: text.optional(),
  about: z.array(z.string().uuid()).max(10).optional(),
});
export const memoriesQuery = z.object({ forgotten: z.enum(["true", "false"]).optional() });

const columns = {
  id: assistantMemories.id,
  text: assistantMemories.text,
  about: assistantMemories.about,
  via: assistantMemories.via,
  savedBy: users.email,
  createdAt: assistantMemories.createdAt,
  updatedAt: assistantMemories.updatedAt,
  forgottenAt: assistantMemories.forgottenAt,
};

type Row = {
  id: string;
  text: string;
  about: string[];
  via: string;
  savedBy: string;
  createdAt: Date;
  updatedAt: Date | null;
  forgottenAt: Date | null;
};

const view = (r: Row): MemoryView => ({
  id: r.id,
  text: r.text,
  about: r.about,
  via: r.via as MemoryVia,
  savedBy: r.savedBy,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt?.toISOString() ?? null,
  forgottenAt: r.forgottenAt?.toISOString() ?? null,
});

const select = (db: DbOrTx) =>
  db.select(columns).from(assistantMemories).innerJoin(users, eq(users.id, assistantMemories.createdBy));

// MEM-4: newest first; the forgotten ones only when asked.
export async function listMemories(db: DbOrTx, opts: { forgotten?: boolean } = {}): Promise<MemoryView[]> {
  const rows = await select(db)
    .where(opts.forgotten ? isNotNull(assistantMemories.forgottenAt) : isNull(assistantMemories.forgottenAt))
    .orderBy(desc(sql`coalesce(${assistantMemories.forgottenAt}, ${assistantMemories.createdAt})`));
  return rows.map(view);
}

export async function getMemory(db: DbOrTx, id: string): Promise<MemoryView | null> {
  const [row] = await select(db).where(eq(assistantMemories.id, id));
  return row ? view(row) : null;
}

const tidy = (keywords: string[] | undefined) =>
  [
    ...new Set(
      (keywords ?? []).map((k) => k.trim().toLowerCase()).filter((k) => k.length >= 1 && k.length <= 40),
    ),
  ].slice(0, MEMORY_LIMITS.keywords);

export async function addMemory(
  db: DbOrTx,
  userId: string,
  input: { text: string; about?: string[]; keywords?: string[] },
  via: MemoryVia,
): Promise<MemoryView> {
  const parsed = memoryInput.parse({ text: input.text, about: input.about });
  const [row] = await db
    .insert(assistantMemories)
    .values({
      text: parsed.text,
      about: parsed.about ?? [],
      keywords: tidy(input.keywords),
      via,
      createdBy: userId,
    })
    .returning({ id: assistantMemories.id });
  return (await getMemory(db, row.id))!;
}

export async function updateMemory(
  db: DbOrTx,
  userId: string,
  id: string,
  patch: z.infer<typeof memoryPatch>,
): Promise<MemoryView> {
  const [row] = await db
    .update(assistantMemories)
    .set({
      ...(patch.text !== undefined ? { text: patch.text } : {}),
      ...(patch.about !== undefined ? { about: patch.about } : {}),
      updatedBy: userId,
      updatedAt: new Date(),
    })
    .where(and(eq(assistantMemories.id, id), isNull(assistantMemories.forgottenAt)))
    .returning({ id: assistantMemories.id });
  if (!row) throw new HttpError(404, "not found");
  return (await getMemory(db, id))!;
}

export async function forgetMemory(db: DbOrTx, id: string, now = new Date()): Promise<MemoryView> {
  const [row] = await db
    .update(assistantMemories)
    .set({ forgottenAt: now })
    .where(and(eq(assistantMemories.id, id), isNull(assistantMemories.forgottenAt)))
    .returning({ id: assistantMemories.id });
  if (!row) throw new HttpError(404, "not found");
  return (await getMemory(db, id))!;
}

export async function restoreMemory(db: DbOrTx, id: string): Promise<MemoryView> {
  const [row] = await db
    .update(assistantMemories)
    .set({ forgottenAt: null })
    .where(and(eq(assistantMemories.id, id), isNotNull(assistantMemories.forgottenAt)))
    .returning({ id: assistantMemories.id });
  if (!row) throw new HttpError(404, "not found");
  return (await getMemory(db, id))!;
}

// MEM-3: a fact matches a search word when the word is in its text or in
// one of its keywords (saved in both languages), or a keyword is in the
// word. Most matched words first, then newest. A family's memory is tens
// to a few hundred rows, so this is done in memory.
export async function searchMemories(db: DbOrTx, words: string[], aboutId?: string): Promise<MemoryView[]> {
  const wanted = tidy(words);
  if (!wanted.length) return [];
  const rows = await db
    .select({ ...columns, keywords: assistantMemories.keywords })
    .from(assistantMemories)
    .innerJoin(users, eq(users.id, assistantMemories.createdBy))
    .where(isNull(assistantMemories.forgottenAt))
    .orderBy(desc(assistantMemories.createdAt));
  return rows
    .map((r) => {
      const body = r.text.toLowerCase();
      const hits = wanted.filter(
        (w) => body.includes(w) || r.keywords.some((k) => k.includes(w) || (k.length >= 2 && w.includes(k))),
      ).length;
      // A fact about the person asked after counts for a little more.
      return { r, score: hits + (hits && aboutId && r.about.includes(aboutId) ? 0.5 : 0) };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MEMORY_LIMITS.results)
    .map((x) => view(x.r));
}

// MEM-4: the daily tidy-up deletes facts forgotten more than 30 days ago.
export async function pruneMemories(db: DbOrTx, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - MEMORY_LIMITS.restoreDays * 86_400_000);
  const rows = await db
    .delete(assistantMemories)
    .where(lt(assistantMemories.forgottenAt, cutoff))
    .returning({ id: assistantMemories.id });
  return rows.length;
}
