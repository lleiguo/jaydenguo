import { digestSourceIds } from "../server/mail/view";
import type { JobContext } from "./context";
import { syncSource } from "./sync";

// `mail:digest` (intent 0025, MD-1): reads the email source, which writes
// today's mail after its suggestions. The morning schedule starts it; the
// notification comes with MD2.
export async function mailDigestJob(_args: string[], ctx: JobContext) {
  const db = await ctx.db();
  const results: Record<string, string> = {};
  for (const id of await digestSourceIds(db))
    results[id] = (await syncSource(db, id, "scheduled", ctx.log)).status;
  ctx.log("mail digest job done", { results });
}
