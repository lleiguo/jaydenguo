import { and, eq, gte, inArray } from "drizzle-orm";
import { assistantEmailReads } from "@db/schema";
import { gmailQuery, type GmailConfig } from "@/adapters/gmail";
import type { DbOrTx } from "../db/client";

// An email Cookie was asked to read (intent 0009): the web service records
// what to look for and starts the worker, which alone may open the Google
// sign-in (0001 CRED-4); the summary comes back as a follow-up turn.

export const READ_LIMITS = {
  // ERD-6
  perHour: 10,
  // ERD-3
  maxDays: 30,
  defaultDays: 7,
  // ERD-4: candidates read and handed to the summarizer.
  candidates: 5,
  // ERA-5: the app stops waiting after this long.
  waitMs: 3 * 60_000,
} as const;

// What the app shows under an answer while the summary is on its way.
export type Waiting = { kind: "email"; until: string };

const waitingUntil = (createdAt: Date) => new Date(createdAt.getTime() + READ_LIMITS.waitMs).toISOString();

// ERA-1: the turns whose read is still pending, and until when to wait.
export async function waitingFor(
  db: DbOrTx,
  turnIds: string[],
  now = new Date(),
): Promise<Map<string, Waiting>> {
  const out = new Map<string, Waiting>();
  if (!turnIds.length) return out;
  const rows = await db
    .select({ turnId: assistantEmailReads.turnId, createdAt: assistantEmailReads.createdAt })
    .from(assistantEmailReads)
    .where(
      and(
        inArray(assistantEmailReads.turnId, turnIds),
        eq(assistantEmailReads.state, "pending"),
        gte(assistantEmailReads.createdAt, new Date(now.getTime() - READ_LIMITS.waitMs)),
      ),
    );
  for (const r of rows) if (r.turnId) out.set(r.turnId, { kind: "email", until: waitingUntil(r.createdAt) });
  return out;
}

// ERD-6: reads this account started in the last hour.
export async function readsLastHour(db: DbOrTx, userId: string, now: Date): Promise<number> {
  const rows = await db
    .select({ id: assistantEmailReads.id })
    .from(assistantEmailReads)
    .where(
      and(
        eq(assistantEmailReads.userId, userId),
        gte(assistantEmailReads.createdAt, new Date(now.getTime() - 3600_000)),
      ),
    );
  return rows.length;
}

export async function newRead(
  db: DbOrTx,
  read: {
    userId: string;
    conversationId: string;
    about: string;
    fromHint: string | null;
    days: number;
    language: string;
  },
  now: Date,
) {
  const [row] = await db
    .insert(assistantEmailReads)
    .values({ ...read, createdAt: now })
    .returning({ id: assistantEmailReads.id, createdAt: assistantEmailReads.createdAt });
  return { id: row.id, until: waitingUntil(row.createdAt) };
}

// The question's turn now exists: the read belongs to it.
export async function claimRead(db: DbOrTx, readId: string, turnId: string) {
  await db.update(assistantEmailReads).set({ turnId }).where(eq(assistantEmailReads.id, readId));
}

// ERD-2, ERD-3: the Gmail search for a read. The allow-list's own search
// (the same senders and labels the email source reads, over the days asked
// for), narrowed by the parent's words and the sender they named. Gmail's
// search is wider than the list; the worker checks every sender again.
export function readQuery(config: GmailConfig, about: string, fromHint: string | null, days: number): string {
  const words = about
    .replace(/["{}()]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .slice(0, 8)
    .join(" ");
  const from = fromHint?.replace(/["{}()\s]/g, "") ?? "";
  return [gmailQuery({ ...config, lookbackDays: days }), from && `from:${from}`, words]
    .filter(Boolean)
    .join(" ");
}
