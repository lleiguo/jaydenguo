import { and, eq, sql } from "drizzle-orm";
import { credentials, credentialSessions } from "@db/schema";
import type { BrowserSession } from "../adapters/types";
import { sessionAadFor } from "../server/credentials/aad";
import { open, seal } from "../server/crypto/envelope";
import { defaultKeyWrapper, type KeyWrapper } from "../server/crypto/key-wrapper";
import type { Db } from "../server/db/client";
import { registerSecret } from "../server/log";

// The worker's side of BrowserSession (plan M4.2): the site's cookies stay
// sealed in credential_sessions between runs, and a sign-in code comes from
// the Accounts page. While waiting, `meta.codeRequestedAt` tells the page to
// show the code box; the code row is deleted as soon as it's read.

const waitMs = () => Number(process.env.SIGNIN_CODE_WAIT_MS ?? 8 * 60_000);
const POLL_MS = 2_000;

async function markWaiting(db: Db, id: string, since: Date | null) {
  await db
    .update(credentials)
    .set({
      meta: since
        ? sql`${credentials.meta} || ${JSON.stringify({ codeRequestedAt: since.toISOString() })}::jsonb`
        : sql`${credentials.meta} - 'codeRequestedAt'`,
    })
    .where(eq(credentials.id, id));
}

async function take(db: Db, id: string, kind: "browser" | "code", wrapper: KeyWrapper) {
  const [row] = await db
    .select()
    .from(credentialSessions)
    .where(and(eq(credentialSessions.credentialId, id), eq(credentialSessions.kind, kind)));
  if (!row) return null;
  const value = await open(wrapper, row, sessionAadFor(id, kind));
  registerSecret(value);
  return value;
}

export function workerBrowserSession(
  db: Db,
  credentialId: string,
  // True when the owner started the run and can type a code.
  interactive: boolean,
  wrapper: KeyWrapper = defaultKeyWrapper(),
): BrowserSession {
  const dropCode = () =>
    db
      .delete(credentialSessions)
      .where(and(eq(credentialSessions.credentialId, credentialId), eq(credentialSessions.kind, "code")));
  return {
    load: () => take(db, credentialId, "browser", wrapper),
    async save(state) {
      const sealed = await seal(wrapper, state, sessionAadFor(credentialId, "browser"));
      await db
        .insert(credentialSessions)
        .values({ credentialId, kind: "browser", ...sealed })
        .onConflictDoUpdate({
          target: [credentialSessions.credentialId, credentialSessions.kind],
          set: { ...sealed, updatedAt: new Date() },
        });
    },
    waitForCode: interactive
      ? async () => {
          await dropCode();
          await markWaiting(db, credentialId, new Date());
          try {
            const deadline = Date.now() + waitMs();
            while (Date.now() < deadline) {
              const code = await take(db, credentialId, "code", wrapper);
              if (code) return code;
              await new Promise((r) => setTimeout(r, POLL_MS));
            }
            return null;
          } finally {
            await dropCode();
            await markWaiting(db, credentialId, null);
          }
        }
      : null,
  };
}
