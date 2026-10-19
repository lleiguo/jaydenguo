import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { credentials, settings, sources } from "@db/schema";
import { ADD_SCOPE } from "../domain/assistant-changes";
import { saveCopySettings } from "./calendar-copy";
import type { DbOrTx } from "./db/client";
import { HttpError } from "./errors";
import type { JobLauncher } from "./jobs/launcher";

// Two-way sync with the household Google Calendar (intent 0020): the
// switch (TWO-9), what a dry run would do, a held run (TWSEC-2) and the last
// run. The worker job `household:sync` reads and writes these.

const KEY = "household_sync";

export const HOUSEHOLD_MODES = ["off", "dry_run", "on"] as const;
export type HouseholdMode = (typeof HOUSEHOLD_MODES)[number];

// One line of a plan, as the owner reads it.
export type PlanLine = { title: string; start: string };
export type PlanSummary = {
  create: PlanLine[];
  update: PlanLine[];
  link: PlanLine[];
  remove: PlanLine[];
  unlink: PlanLine[];
};

export type HouseholdSyncSettings = {
  mode: HouseholdMode;
  // The household source it writes to; null = the only Google Calendar source.
  sourceId: string | null;
  // TWSEC-2: the first run after switching On waits for "Apply".
  holdNext: boolean;
  // The owner pressed "Apply": the next run goes ahead past the brake.
  applyOnce: boolean;
  held: { reason: string; at: string; plan: PlanSummary } | null;
  dryRun: { at: string; plan: PlanSummary } | null;
  lastRunAt: string | null;
  lastError: string | null;
  last: {
    created: number;
    updated: number;
    linked: number;
    deleted: number;
    unlinked: number;
    // Changes read back from Google (BACK); runs before H3 have none.
    fromGoogle?: number;
  } | null;
  // When the web app last started the job, and when a run last began: a
  // job that hasn't begun yet will see later changes too.
  requestedAt: string | null;
  runStartedAt: string | null;
  // When the switch last went On. A household event deleted in the hub
  // before then was deleted while Off or Dry run, so it stays in Google
  // (intent 0022, DEL-4). Null for a switch turned On before 0022: every
  // delete counts, as before.
  onSince: string | null;
};

const EMPTY: HouseholdSyncSettings = {
  mode: "off",
  sourceId: null,
  holdNext: false,
  applyOnce: false,
  held: null,
  dryRun: null,
  lastRunAt: null,
  lastError: null,
  last: null,
  requestedAt: null,
  runStartedAt: null,
  onSince: null,
};

export async function getHouseholdSync(db: DbOrTx): Promise<HouseholdSyncSettings> {
  const [row] = await db.select().from(settings).where(eq(settings.key, KEY));
  return { ...EMPTY, ...((row?.value as Partial<HouseholdSyncSettings> | undefined) ?? {}) };
}

export async function saveHouseholdSync(db: DbOrTx, patch: Partial<HouseholdSyncSettings>) {
  const value = { ...(await getHouseholdSync(db)), ...patch };
  await db
    .insert(settings)
    .values({ key: KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
  return value;
}

// The Google Calendar sources it could write to, and whether each one's
// Google account allows writing (TWSEC-3: the grant "Let Cookie add events").
export async function householdSources(db: DbOrTx) {
  const rows = await db
    .select({ id: sources.id, name: sources.name, scopes: credentials.scopes, status: credentials.status })
    .from(sources)
    .leftJoin(credentials, eq(credentials.id, sources.credentialId))
    .where(and(eq(sources.kind, "google_calendar"), eq(sources.enabled, true)));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    canWrite: r.status === "active" && !!r.scopes?.includes(ADD_SCOPE),
  }));
}

export const householdSyncInput = z.object({
  mode: z.enum(HOUSEHOLD_MODES),
  sourceId: z.uuid().nullable().optional(),
});

export async function setHouseholdSync(
  db: DbOrTx,
  input: z.infer<typeof householdSyncInput>,
  launcher: JobLauncher,
) {
  const current = await getHouseholdSync(db);
  const sourceId = input.sourceId === undefined ? current.sourceId : input.sourceId;
  if (input.mode !== "off") {
    const all = await householdSources(db);
    const source = sourceId ? all.find((s) => s.id === sourceId) : all.length === 1 ? all[0] : undefined;
    if (!source) throw new HttpError(400, "Choose the household Google calendar first.");
    if (input.mode === "on" && !source.canWrite)
      throw new HttpError(
        400,
        'Its Google account can\'t write yet: press "Let Cookie add events" on the Accounts page first.',
      );
  }
  const turningOn = input.mode === "on" && current.mode !== "on";
  const saved = await saveHouseholdSync(db, {
    mode: input.mode,
    sourceId,
    holdNext: turningOn ? true : input.mode === "on" && current.holdNext,
    applyOnce: false,
    held: input.mode === "on" ? current.held : null,
    dryRun: input.mode === "dry_run" ? current.dryRun : null,
    lastError: null,
    ...(turningOn && { onSince: new Date().toISOString() }),
  });
  // TWO-8: Household holds everything now, so the one-way copy stops.
  if (turningOn) await saveCopySettings(db, { enabled: false });
  if (input.mode !== "off") await launcher.start(["household:sync"]);
  return saved;
}

// "Apply" on a held run (TWSEC-2).
export async function applyHeld(db: DbOrTx, launcher: JobLauncher) {
  const current = await getHouseholdSync(db);
  if (current.mode !== "on" || !current.held) throw new HttpError(409, "There's no run waiting.");
  const saved = await saveHouseholdSync(db, { applyOnce: true });
  await launcher.start(["household:sync"]);
  return saved;
}

// TWO-3: after a change on the calendar, start the job, unless one was
// started and hasn't begun yet (it will see this change too). A start that
// never began is retried after five minutes.
export async function nudgeHouseholdSync(db: DbOrTx, launcher: JobLauncher, now = new Date()) {
  const current = await getHouseholdSync(db);
  if (current.mode === "off") return false;
  const requested = current.requestedAt ? Date.parse(current.requestedAt) : 0;
  const began = current.runStartedAt ? Date.parse(current.runStartedAt) : 0;
  if (requested > began && now.getTime() - requested < 5 * 60_000) return false;
  await saveHouseholdSync(db, { requestedAt: now.toISOString() });
  await launcher.start(["household:sync"]);
  return true;
}
