import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { credentials, sources, syncRuns } from "@db/schema";
import { profileIdFromLink } from "../adapters/tennis-tc";
import { portalFrom } from "../adapters/veracross";
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
  tennis_tc: { label: "Tennis Canada tournaments", credentialProvider: null },
  school_dates: { label: "School key dates (public page)", credentialProvider: null },
  veracross: { label: "Veracross (daily schedule)", credentialProvider: "veracross" },
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

const configSchema = z.object({
  calendarId: z.string().min(1).max(300).optional(),
  // tennis_tc: his public profile link on the tournament site.
  profileUrl: z.string().trim().min(1).max(300).optional(),
  // school_dates: the school's public key dates page, and words that mark
  // items that aren't his (comma-separated, e.g. "Sr. School Only").
  pageUrl: z
    .url({ protocol: /^https?$/ })
    .max(300)
    .optional(),
  exclude: z.string().trim().max(300).optional(),
  // veracross: the parent portal link and, with more than one child on the
  // login, which one is his.
  portalUrl: z.string().trim().max(300).optional(),
  studentFirstName: z.string().trim().max(60).optional(),
  // tennis_tc: tournament entries (TEN-9). The home postal code is sent to
  // the tournament site's search and, with the venue, to the routing
  // service for drive times; it's never shown outside the Sources page.
  entry: z
    .object({
      homePostalCode: z
        .string()
        .trim()
        .regex(/^[A-Za-z]\d[A-Za-z] ?\d[A-Za-z]\d$/, "a Canadian postal code, e.g. A1A 1A1")
        .optional(),
      maxDriveMinutes: z.number().int().min(15).max(600).optional(),
      include: z.string().trim().max(200).optional(),
      prefer: z.string().trim().max(200).optional(),
      exclude: z.string().trim().max(200).optional(),
    })
    .optional(),
});

export const createSourceInput = z.object({
  kind: z.enum(["google_calendar", "ical", "commit_swim", "tennis_tc", "school_dates", "veracross"]),
  name: z.string().trim().min(1).max(80),
  // Not needed for tennis_tc and school_dates, which read public pages.
  credentialId: z.uuid().optional(),
  config: configSchema.default({}),
  categoryMapping: mappingSchema,
});

export const updateSourceInput = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  enabled: z.boolean().optional(),
  credentialId: z.uuid().optional(),
  config: configSchema.optional(),
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
  // SYNC-5: only a successful run starts the hour's wait (owner, 2026-09-28).
  const lastOks = ids.length
    ? await db
        .selectDistinctOn([syncRuns.sourceId], { sourceId: syncRuns.sourceId, startedAt: syncRuns.startedAt })
        .from(syncRuns)
        .where(and(inArray(syncRuns.sourceId, ids), eq(syncRuns.status, "succeeded")))
        .orderBy(syncRuns.sourceId, desc(syncRuns.startedAt))
    : [];
  const lastOkBySource = new Map(lastOks.map((r) => [r.sourceId, r.startedAt]));
  return rows.map(({ source: s, credentialLabel }) => {
    const last = lastBySource.get(s.id);
    const lastOk = lastOkBySource.get(s.id);
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
      nextRefreshAt: lastOk ? new Date(lastOk.getTime() + minGapMs()).toISOString() : null,
    };
  });
}

export async function createSource(db: Db, input: z.infer<typeof createSourceInput>) {
  if (input.kind === "google_calendar" && !input.config.calendarId) {
    throw new HttpError(400, "choose a Google calendar");
  }
  if (input.kind === "tennis_tc") {
    const profileUrl = input.config.profileUrl;
    if (!profileIdFromLink(profileUrl))
      throw new HttpError(400, "paste his profile link from tc.tournamentsoftware.com (…/player-profile/…)");
    const [row] = await db
      .insert(sources)
      .values({ ...input, credentialId: null, config: { profileUrl: profileUrl!.trim() } })
      .returning({ id: sources.id });
    return row;
  }
  if (input.kind === "school_dates") {
    const { pageUrl, exclude } = input.config;
    if (!pageUrl) throw new HttpError(400, "paste the link of the school's key dates page");
    const [row] = await db
      .insert(sources)
      .values({ ...input, credentialId: null, config: { pageUrl, ...(exclude && { exclude }) } })
      .returning({ id: sources.id });
    return row;
  }
  if (input.kind === "veracross" && !portalFrom(input.config.portalUrl))
    throw new HttpError(400, "paste the parent portal link (https://portals.veracross.com/…/parent)");
  if (!input.credentialId) throw new HttpError(400, "choose an account");
  const [cred] = await db.select().from(credentials).where(eq(credentials.id, input.credentialId));
  if (!cred) throw new HttpError(400, "unknown account");
  const fits =
    input.kind === "google_calendar"
      ? cred.provider === "google"
      : input.kind === "commit_swim" || input.kind === "veracross"
        ? cred.provider === input.kind && cred.kind === "password"
        : cred.kind === "secret_url";
  if (!fits) throw new HttpError(400, "that account can't be used for this kind of source");
  const [row] = await db.insert(sources).values(input).returning({ id: sources.id });
  return row;
}

export async function updateSource(db: Db, id: string, input: z.infer<typeof updateSourceInput>) {
  if (input.config?.profileUrl !== undefined && !profileIdFromLink(input.config.profileUrl))
    throw new HttpError(400, "paste his profile link from tc.tournamentsoftware.com (…/player-profile/…)");
  if (input.config?.portalUrl !== undefined && !portalFrom(input.config.portalUrl))
    throw new HttpError(400, "paste the parent portal link (https://portals.veracross.com/…/parent)");
  // Config is merged, so saving one setting keeps the others.
  const [current] = await db.select({ config: sources.config }).from(sources).where(eq(sources.id, id));
  if (!current) throw new HttpError(404, "not found");
  const config = input.config
    ? { ...((current.config ?? {}) as Record<string, unknown>), ...input.config }
    : undefined;
  await db
    .update(sources)
    .set({ ...input, ...(config && { config }) })
    .where(eq(sources.id, id));
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
  // Only a successful run starts the hour's wait, so a failing source can be
  // retried straight away.
  const [lastOk] = await db
    .select({ startedAt: syncRuns.startedAt })
    .from(syncRuns)
    .where(and(eq(syncRuns.sourceId, id), eq(syncRuns.status, "succeeded")))
    .orderBy(desc(syncRuns.startedAt))
    .limit(1);
  if (lastOk && Date.now() - lastOk.startedAt.getTime() < minGapMs()) {
    throw new HttpError(429, "Synced recently. Each source refreshes at most once an hour.");
  }
  await launcher.start(["sync", id, "manual"]);
}

export async function requestRefreshAll(launcher: JobLauncher) {
  await launcher.start(["sync", "all", "manual"]);
}
