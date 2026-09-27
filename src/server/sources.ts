import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { credentials, sources, syncRuns } from "@db/schema";
import { parseMapping } from "../domain/categories";
import { CATEGORIES, ATTENDANCE } from "../domain/constants";
import type { Db } from "./db/client";
import { HttpError } from "./errors";
import type { JobLauncher } from "./jobs/launcher";
import { STALE_RUN_MS, minGapMs } from "./sync/policy";

// Sources page and API (ACT-1, SYNC-1, SYNC-2, SYNC-4).

export const SOURCE_KINDS = {
  google_calendar: { label: "Google Calendar", credentialProvider: "google" },
  ical: { label: "Calendar feed (iCal link)", credentialProvider: null },
  commit_swim: { label: "Commit Swimming", credentialProvider: "commit_swim" },
} as const;

const mappingSchema = z.object({
  default: z.enum(CATEGORIES),
  rules: z
    .array(
      z.object({
        match: z.string().trim().min(1).max(60),
        category: z.enum(CATEGORIES).optional(),
        attendance: z.enum(ATTENDANCE).optional(),
      }),
    )
    .max(50)
    .optional(),
});

export const createSourceInput = z.object({
  kind: z.enum(["google_calendar", "ical", "commit_swim"]),
  name: z.string().trim().min(1).max(80),
  credentialId: z.uuid(),
  config: z.object({ calendarId: z.string().min(1).max(300).optional() }).default({}),
  categoryMapping: mappingSchema,
});

export const updateSourceInput = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  enabled: z.boolean().optional(),
  credentialId: z.uuid().optional(),
  config: z.object({ calendarId: z.string().min(1).max(300).optional() }).optional(),
  categoryMapping: mappingSchema.optional(),
});

export type RunView = {
  id: string;
  trigger: string;
  status: string;
  added: number;
  changed: number;
  cancelled: number;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
};

const runView = (r: typeof syncRuns.$inferSelect): RunView => ({
  id: r.id,
  trigger: r.trigger,
  status: r.status,
  added: r.added,
  changed: r.changed,
  cancelled: r.cancelled,
  errorMessage: r.errorMessage,
  startedAt: r.startedAt.toISOString(),
  finishedAt: r.finishedAt?.toISOString() ?? null,
});

export async function listSources(db: Db) {
  const rows = await db
    .select({ source: sources, credentialLabel: credentials.label })
    .from(sources)
    .leftJoin(credentials, eq(credentials.id, sources.credentialId))
    .orderBy(sources.createdAt);
  const ids = rows.map((r) => r.source.id);
  const lastRuns = ids.length
    ? await db
        .selectDistinctOn([syncRuns.sourceId])
        .from(syncRuns)
        .where(and(inArray(syncRuns.sourceId, ids), ne(syncRuns.status, "skipped")))
        .orderBy(syncRuns.sourceId, desc(syncRuns.startedAt))
    : [];
  const lastBySource = new Map(lastRuns.map((r) => [r.sourceId, r]));
  return rows.map(({ source: s, credentialLabel }) => {
    const last = lastBySource.get(s.id);
    return {
      id: s.id,
      kind: s.kind,
      name: s.name,
      enabled: s.enabled,
      credentialId: s.credentialId,
      credentialLabel,
      config: s.config,
      categoryMapping: parseMapping(s.categoryMapping),
      lastSuccessAt: s.lastSuccessAt?.toISOString() ?? null,
      consecutiveFailures: s.consecutiveFailures,
      lastRun: last ? runView(last) : null,
      running: !!last && last.status === "running" && Date.now() - last.startedAt.getTime() < STALE_RUN_MS,
      nextRefreshAt: last ? new Date(last.startedAt.getTime() + minGapMs()).toISOString() : null,
    };
  });
}

export async function createSource(db: Db, input: z.infer<typeof createSourceInput>) {
  if (input.kind === "google_calendar" && !input.config.calendarId) {
    throw new HttpError(400, "choose a Google calendar");
  }
  const [cred] = await db.select().from(credentials).where(eq(credentials.id, input.credentialId));
  if (!cred) throw new HttpError(400, "unknown account");
  const fits =
    input.kind === "google_calendar"
      ? cred.provider === "google"
      : input.kind === "commit_swim"
        ? cred.provider === "commit_swim" && cred.kind === "password"
        : cred.kind === "secret_url";
  if (!fits) throw new HttpError(400, "that account can't be used for this kind of source");
  const [row] = await db.insert(sources).values(input).returning({ id: sources.id });
  return row;
}

export async function updateSource(db: Db, id: string, input: z.infer<typeof updateSourceInput>) {
  const [row] = await db.update(sources).set(input).where(eq(sources.id, id)).returning({ id: sources.id });
  if (!row) throw new HttpError(404, "not found");
}

export async function sourceRuns(db: Db, id: string): Promise<RunView[]> {
  const rows = await db
    .select()
    .from(syncRuns)
    .where(and(eq(syncRuns.sourceId, id), ne(syncRuns.status, "skipped")))
    .orderBy(desc(syncRuns.startedAt))
    .limit(50);
  return rows.map(runView);
}

// SYNC-2 on-demand refresh, with SYNC-5's one-run-per-hour limit. The
// worker checks again under a lock, so double clicks still give one run.
export async function requestRefresh(db: Db, id: string, launcher: JobLauncher): Promise<void> {
  const [source] = await db.select().from(sources).where(eq(sources.id, id));
  if (!source) throw new HttpError(404, "not found");
  if (!source.enabled) throw new HttpError(409, "This source is switched off.");
  const [last] = await db
    .select()
    .from(syncRuns)
    .where(and(eq(syncRuns.sourceId, id), ne(syncRuns.status, "skipped")))
    .orderBy(desc(syncRuns.startedAt))
    .limit(1);
  if (last?.status === "running" && Date.now() - last.startedAt.getTime() < STALE_RUN_MS) {
    throw new HttpError(409, "A refresh is already running.");
  }
  if (last && Date.now() - last.startedAt.getTime() < minGapMs()) {
    const next = new Date(last.startedAt.getTime() + minGapMs());
    throw new HttpError(429, `Synced recently. The next refresh is possible after ${next.toISOString()}.`);
  }
  await launcher.start(["sync", id, "manual"]);
}

export async function requestRefreshAll(launcher: JobLauncher) {
  await launcher.start(["sync", "all", "manual"]);
}
