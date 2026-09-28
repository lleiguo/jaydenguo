import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { credentials, settings } from "@db/schema";
import type { DbOrTx } from "./db/client";
import { HttpError } from "./errors";
import type { JobLauncher } from "./jobs/launcher";

// The Google Calendar copy's settings (plan M5.9, GCO-1, GCO-2). The copy
// uses a Google grant with only `calendar.app.created`: Google lets the
// site create its own calendar and write to it, and nothing else, so the
// household calendar can't be written even by mistake.

export const COPY_SCOPE = "https://www.googleapis.com/auth/calendar.app.created";
const KEY = "calendar_copy";

export type CopySettings = {
  enabled: boolean;
  credentialId: string | null;
  // The calendar the site created; null before the first copy.
  calendarId: string | null;
  lastRunAt: string | null;
  lastError: string | null;
  last: { created: number; updated: number; deleted: number } | null;
};

const EMPTY: CopySettings = {
  enabled: false,
  credentialId: null,
  calendarId: null,
  lastRunAt: null,
  lastError: null,
  last: null,
};

export async function getCopySettings(db: DbOrTx): Promise<CopySettings> {
  const [row] = await db.select().from(settings).where(eq(settings.key, KEY));
  return { ...EMPTY, ...((row?.value as Partial<CopySettings> | undefined) ?? {}) };
}

export async function saveCopySettings(db: DbOrTx, patch: Partial<CopySettings>) {
  const value = { ...(await getCopySettings(db)), ...patch };
  await db
    .insert(settings)
    .values({ key: KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
  return value;
}

// Google accounts that granted the copy scope.
export async function copyAccounts(db: DbOrTx) {
  const rows = await db
    .select({ id: credentials.id, label: credentials.label, scopes: credentials.scopes })
    .from(credentials)
    .where(and(eq(credentials.provider, "google"), eq(credentials.status, "active")));
  return rows.filter((r) => r.scopes?.includes(COPY_SCOPE)).map((r) => ({ id: r.id, label: r.label }));
}

export const copyInput = z.discriminatedUnion("enabled", [
  z.object({ enabled: z.literal(true), credentialId: z.uuid() }),
  // GCO-2: switching off stops updates; the owner keeps or deletes it.
  z.object({ enabled: z.literal(false), keep: z.boolean() }),
]);

export async function setCopy(db: DbOrTx, input: z.infer<typeof copyInput>, launcher: JobLauncher) {
  if (input.enabled) {
    if (!(await copyAccounts(db)).some((a) => a.id === input.credentialId))
      throw new HttpError(400, "Connect that Google account for the calendar copy first.");
    const current = await getCopySettings(db);
    // A different account can't reach the old calendar: start a new one.
    const calendarId = current.credentialId === input.credentialId ? current.calendarId : null;
    const saved = await saveCopySettings(db, { enabled: true, credentialId: input.credentialId, calendarId });
    await launcher.start(["calendar:copy"]);
    return saved;
  }
  const saved = await saveCopySettings(db, { enabled: false });
  if (!input.keep && saved.calendarId) await launcher.start(["calendar:copy", "delete"]);
  return saved;
}
