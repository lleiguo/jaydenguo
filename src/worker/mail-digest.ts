import { notifyMail } from "../server/mail/notify";
import { digestSourceIds } from "../server/mail/view";
import { getHomeTimeZone } from "../server/settings";
import type { JobContext } from "./context";
import { syncSource } from "./sync";

// `mail:digest` (intent 0025, MD-1, MA-4): reads the email source, which
// writes today's mail after its suggestions, then sends the morning
// notification. Only the 06:30 schedule starts it; a pull to refresh is a
// plain sync and sends nothing.
export async function mailDigestJob(_args: string[], ctx: JobContext) {
  const db = await ctx.db();
  const results: Record<string, string> = {};
  for (const id of await digestSourceIds(db))
    results[id] = (await syncSource(db, id, "scheduled", ctx.log)).status;
  await notifyMail(db, { now: new Date(), homeTimeZone: await getHomeTimeZone(db), log: ctx.log });
  ctx.log("mail digest job done", { results });
}
