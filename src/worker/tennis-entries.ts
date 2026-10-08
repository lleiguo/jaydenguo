import { tennisTestNow } from "../adapters/tennis-tc";
import { getHomeTimeZone } from "../server/settings";
import { routesDriveTimer } from "../server/tennis/drive";
import {
  runAcceptance,
  runDrawWatch,
  runEnter,
  tennisSources,
  type EntryContext,
} from "../server/tennis/entries";
import type { JobContext } from "./context";
import { syncSource } from "./sync";
import { tennisRegistrar } from "./tennis-registrar";

// Worker jobs for tournament entries (TEN-9..11). Cloud Scheduler starts
// them (infra/scheduler.tf); each runs every enabled Tennis Canada source.

async function entryContext(ctx: JobContext): Promise<EntryContext> {
  const db = await ctx.db();
  return { db, log: ctx.log, now: tennisTestNow() ?? new Date(), timeZone: await getHomeTimeZone(db) };
}

// `tennis:enter`, Thursday noon.
export async function tennisEnterJob(_args: string[], ctx: JobContext) {
  const ectx = await entryContext(ctx);
  const drive = routesDriveTimer();
  for (const source of await tennisSources(ectx.db)) {
    const registrar = await tennisRegistrar(ectx.db, source, ctx.log);
    const result = await runEnter(ectx, source, { drive, registrar });
    if ("skipped" in result)
      ctx.log("tennis entries skipped", { source: source.name, reason: result.skipped });
  }
}

// `tennis:acceptance`, Friday 10:00.
export async function tennisAcceptanceJob(_args: string[], ctx: JobContext) {
  const ectx = await entryContext(ctx);
  for (const source of await tennisSources(ectx.db))
    await runAcceptance(ectx, source, { registrar: await tennisRegistrar(ectx.db, source, ctx.log) });
}

// `tennis:draw-watch`, hourly on draw days.
export async function tennisDrawWatchJob(_args: string[], ctx: JobContext) {
  const ectx = await entryContext(ctx);
  for (const source of await tennisSources(ectx.db))
    await runDrawWatch(
      ectx,
      source,
      async (id) => (await syncSource(ectx.db, id, "scheduled", ctx.log)).status,
    );
}
