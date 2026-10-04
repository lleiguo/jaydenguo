import { eq } from "drizzle-orm";
import { sources } from "@db/schema";
import { googleAccessToken } from "../adapters/google-calendar";
import { parseGmailConfig, unmatchedSenders } from "../adapters/gmail";
import { SyncError } from "../adapters/types";
import type { SourceCheck } from "../server/sources";
import type { Db } from "../server/db/client";
import type { Logger } from "../server/log";
import type { JobContext } from "./context";
import { openCredential } from "./credentials";

// `gmail:check <source-id>`: after an email source's senders are saved, which
// of them had no email in the last 30 days, so a typo shows on the Sources
// page instead of the source quietly finding nothing. Runs in the worker
// because only it may open the Google sign-in (CRED-4).
export async function checkSenders(
  db: Db,
  sourceId: string,
  log: Logger,
  search: (token: string, c: ReturnType<typeof parseGmailConfig>) => Promise<string[]> = unmatchedSenders,
  now = () => new Date(),
): Promise<SourceCheck | null> {
  const [source] = await db.select().from(sources).where(eq(sources.id, sourceId));
  if (!source || source.kind !== "gmail") return null;
  const save = async (check: SourceCheck) => {
    await db.update(sources).set({ senderCheck: check }).where(eq(sources.id, sourceId));
    // Counts only: the list is the owner's, the result is on the page.
    log("sender check", { sourceId, state: check.state, unmatched: check.unmatched.length });
    return check;
  };
  try {
    if (!source.credentialId) throw new SyncError("Connect a Google account with Gmail access first.");
    const cred = await openCredential(db, source.credentialId, `check:${source.name}`);
    const token = await googleAccessToken(cred.secret);
    const unmatched = await search(token, parseGmailConfig(source.config as Record<string, unknown>));
    return await save({ state: "done", checkedAt: now().toISOString(), unmatched });
  } catch (err) {
    return await save({
      state: "failed",
      checkedAt: now().toISOString(),
      unmatched: [],
      error: err instanceof SyncError ? err.message : "Couldn't check the senders.",
    });
  }
}

export async function senderCheckJob(args: string[], ctx: JobContext) {
  const [sourceId] = args;
  if (!sourceId) throw new Error("usage: gmail:check <source-id>");
  await checkSenders(await ctx.db(), sourceId, ctx.log);
}
