import { and, eq, sql } from "drizzle-orm";
import * as client from "openid-client";
import { auditLog, credentialSessions, credentials, sources } from "@db/schema";
import { CLASSROOM_SCOPES, probeClassroom } from "../adapters/classroom/api";
import { testCommitLogin } from "../adapters/commit-swim";
import { googleAccessToken } from "../adapters/google-calendar";
import { tennisBaseUrl } from "../adapters/tennis-tc";
import { TcLoginError, tcRegistrarClient } from "../adapters/tennis-tc/registrar";
import { testVeracrossLogin } from "../adapters/veracross";
import { normaliseFeedUrl, politeFetch, FetchError } from "../adapters/http";
import { SyncError, type BrowserSession } from "../adapters/types";
import { googleConfig } from "../server/auth/oidc";
import { aadFor } from "../server/credentials/aad";
import { open, rewrap } from "../server/crypto/envelope";
import { defaultKeyWrapper, type KeyWrapper } from "../server/crypto/key-wrapper";
import type { Db } from "../server/db/client";
import { registerSecret } from "../server/log";
import { workerBrowserSession } from "./browser-session";
import type { JobContext } from "./context";

// Worker-only credential operations: the only code that decrypts (CRED-4).
// Every use is audited (CRED-7) and every decrypted value is registered with
// the logger so it can't appear in logs (CRED-5).

export type OpenedCredential = {
  id: string;
  kind: string;
  provider: string;
  username: string | null;
  secret: string;
};

export async function openCredential(
  db: Db,
  id: string,
  purpose: string,
  wrapper: KeyWrapper = defaultKeyWrapper(),
): Promise<OpenedCredential> {
  const [row] = await db.select().from(credentials).where(eq(credentials.id, id));
  if (!row) throw new Error("credential not found");
  const secret = await open(wrapper, row, aadFor(id));
  registerSecret(secret);
  await db
    .update(credentials)
    .set({ lastUsedAt: sql`now()` })
    .where(eq(credentials.id, id));
  await db
    .insert(auditLog)
    .values({ actor: "worker", action: "credential.use", target: id, details: { purpose } });
  return { id, kind: row.kind, provider: row.provider, username: row.username, secret };
}

// Checks a login or link without running a sync. Returns a plain-language
// problem, or null when it works.
// A Veracross login is tested against the portal link of a source that uses
// it (the login page is per school), with its saved browser session so a
// sign-in code can be entered once and remembered.
export async function checkCredential(
  cred: OpenedCredential,
  veracross?: { portalUrl?: string; session?: BrowserSession },
): Promise<string | null> {
  try {
    if (cred.kind === "secret_url") {
      const res = await politeFetch(normaliseFeedUrl(cred.secret));
      if (res.status === 404 || res.status === 410)
        return "The calendar link no longer works. Copy a fresh link.";
      if (!res.ok) return `The calendar site answered with an error (${res.status}).`;
      const body = await res.text();
      if (!body.includes("BEGIN:VCALENDAR")) return "That link doesn't point to a calendar feed.";
      return null;
    }
    if (cred.kind === "oauth" && cred.provider === "google") {
      await client.refreshTokenGrant(await googleConfig(), cred.secret);
      return null;
    }
    if (cred.kind === "password" && cred.provider === "commit_swim") {
      if (!cred.username) return "Add the Commit Swimming email address.";
      await testCommitLogin(cred.username, cred.secret);
      return null;
    }
    if (cred.kind === "password" && cred.provider === "veracross") {
      if (!cred.username) return "Add the Veracross username.";
      await testVeracrossLogin(veracross?.portalUrl, cred.username, cred.secret, veracross?.session);
      return null;
    }
    if (cred.kind === "password" && cred.provider === "tennis_tc") {
      if (!cred.username) return "Add the Tennis Canada username.";
      // Signs in and reads his "My entries" page, as the entry jobs do.
      await tcRegistrarClient(tennisBaseUrl(), cred.username, cred.secret).myEntries();
      return null;
    }
    return `There's no automatic test for ${cred.provider} logins yet. It will be checked on the next sync.`;
  } catch (err) {
    if (err instanceof FetchError || err instanceof SyncError || err instanceof TcLoginError)
      return err.message;
    if (err instanceof client.ResponseBodyError && err.error === "invalid_grant") {
      return "Google access was revoked or expired. Reconnect the Google account.";
    }
    return "The test failed. Try again later.";
  }
}

export async function testCredentialJob(args: string[], ctx: JobContext) {
  const db = await ctx.db();
  const id = args[0];
  const cred = await openCredential(db, id, "test");
  const [portalSource] = await db
    .select({ config: sources.config })
    .from(sources)
    .where(and(eq(sources.credentialId, id), eq(sources.kind, "veracross")));
  let problem = await checkCredential(cred, {
    portalUrl: (portalSource?.config as { portalUrl?: string } | undefined)?.portalUrl,
    // The owner pressed "Test connection", so a sign-in code can be typed.
    session: workerBrowserSession(db, id, true),
  });
  if (problem === null) problem = await checkClassroom(db, cred);
  const untested = problem?.startsWith("There's no automatic test");
  await db
    .update(credentials)
    .set({ lastTestAt: sql`now()`, lastTestOk: untested ? null : problem === null, lastError: problem })
    .where(eq(credentials.id, id));
  ctx.log("credential tested", { credentialId: id, ok: problem === null });
}

// A school account connected for Classroom (plan M4.1, SP-5): read its
// course list again and keep the answer, or the school's refusal, on the
// credential for the Accounts page.
async function checkClassroom(db: Db, cred: OpenedCredential): Promise<string | null> {
  if (cred.kind !== "oauth" || cred.provider !== "google") return null;
  const [row] = await db
    .select({ scopes: credentials.scopes, meta: credentials.meta })
    .from(credentials)
    .where(eq(credentials.id, cred.id));
  if (!row?.scopes?.some((s) => CLASSROOM_SCOPES.includes(s))) return null;
  try {
    const classroom = await probeClassroom(await googleAccessToken(cred.secret));
    await db
      .update(credentials)
      .set({ meta: { ...(row.meta as Record<string, unknown>), classroom } })
      .where(eq(credentials.id, cred.id));
    return classroom.ok ? null : `Classroom refused: ${classroom.reason}`;
  } catch (err) {
    return err instanceof SyncError ? err.message : "The Classroom test failed. Try again later.";
  }
}

// Finishes CRED-6 "Remove" for OAuth grants: revoke at Google, then delete
// the ciphertext.
export async function removeCredentialJob(args: string[], ctx: JobContext) {
  const db = await ctx.db();
  const id = args[0];
  const cred = await openCredential(db, id, "revoke");
  if (cred.kind === "oauth" && cred.provider === "google") {
    try {
      await client.tokenRevocation(await googleConfig(), cred.secret);
    } catch (err) {
      // An already-revoked token can't be revoked again; the row still goes.
      ctx.log("revocation failed; deleting anyway", { credentialId: id, error: err }, "WARNING");
    }
  }
  await db.delete(credentials).where(eq(credentials.id, id));
  await db.insert(auditLog).values({ actor: "worker", action: "credential.delete", target: id });
  ctx.log("credential removed", { credentialId: id });
}

// Plan M1.2 rotation command: re-wrap every data key with the current key
// version. Secrets are never decrypted.
export async function rotateKeysJob(
  _args: string[],
  ctx: JobContext,
  wrapper: KeyWrapper = defaultKeyWrapper(),
) {
  const db = await ctx.db();
  const rows = await db.select().from(credentials);
  for (const row of rows) {
    const next = await rewrap(wrapper, row);
    await db
      .update(credentials)
      .set({ wrappedDek: next.wrappedDek, keyVersion: next.keyVersion })
      .where(eq(credentials.id, row.id));
  }
  const extras = await db.select().from(credentialSessions);
  for (const row of extras) {
    const next = await rewrap(wrapper, row);
    await db
      .update(credentialSessions)
      .set({ wrappedDek: next.wrappedDek, keyVersion: next.keyVersion })
      .where(
        and(eq(credentialSessions.credentialId, row.credentialId), eq(credentialSessions.kind, row.kind)),
      );
  }
  await db
    .insert(auditLog)
    .values({ actor: "worker", action: "credential.rotate_keys", details: { count: rows.length } });
  ctx.log("keys rotated", { count: rows.length });
}
