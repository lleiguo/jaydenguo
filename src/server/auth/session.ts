import { and, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { authCodes, auditLog, sessions, users, type LoginState } from "@db/schema";
import { allowedEmails, authSecret } from "../config";
import type { Db } from "../db/client";
import {
  CODE_TTL_MS,
  LOGIN_TTL_MS,
  SESSION_TTL_MS,
  isWellFormedToken,
  newSessionToken,
  sessionIdFor,
} from "./tokens";

// browser: a cookie; device: the iPhone app's bearer token; handoff: a short
// web session the app opened for a browser-only flow (intent 0004).
export type SessionKind = "browser" | "device" | "handoff";

export type SessionUser = { sessionId: string; userId: string; email: string; kind: SessionKind };

export function isAllowed(email: string): boolean {
  return allowedEmails().includes(email.trim().toLowerCase());
}

// Looks up a signed-in session. Returns null for anything that isn't a live
// session of an allow-listed user, so removing someone from the allow-list
// locks them out at once (AUTH-1).
export async function findSession(db: Db, token: string | undefined): Promise<SessionUser | null> {
  if (!isWellFormedToken(token)) return null;
  const id = sessionIdFor(token, authSecret());
  const [row] = await db
    .select({
      sessionId: sessions.id,
      userId: users.id,
      email: users.email,
      kind: sessions.kind,
      lastSeenAt: sessions.lastSeenAt,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), isNull(sessions.revokedAt), gt(sessions.expiresAt, sql`now()`)))
    .limit(1);
  if (!row || !isAllowed(row.email)) return null;
  const kind = row.kind as SessionKind;
  // Record use at most once a minute, for the devices list. The app's token
  // stays valid for 30 days after its last use (spec N-6), not after sign-in.
  if (!row.lastSeenAt || Date.now() - row.lastSeenAt.getTime() > 60_000) {
    await db
      .update(sessions)
      .set({
        lastSeenAt: sql`now()`,
        ...(kind === "device" && { expiresAt: new Date(Date.now() + SESSION_TTL_MS) }),
      })
      .where(eq(sessions.id, id));
  }
  return { sessionId: row.sessionId, userId: row.userId, email: row.email, kind };
}

export async function startLogin(db: Db, state: LoginState, userAgent: string | null): Promise<string> {
  const token = newSessionToken();
  await db.insert(sessions).values({
    id: sessionIdFor(token, authSecret()),
    loginState: state,
    userAgent,
    expiresAt: new Date(Date.now() + LOGIN_TTL_MS),
  });
  // Housekeeping: pre-login rows are only useful for ten minutes.
  await db.delete(sessions).where(and(isNull(sessions.userId), lt(sessions.expiresAt, sql`now()`)));
  return token;
}

// Single use: the pre-login row is deleted whether or not sign-in succeeds.
export async function takeLogin(db: Db, token: string | undefined): Promise<LoginState | null> {
  if (!isWellFormedToken(token)) return null;
  const [row] = await db
    .delete(sessions)
    .where(and(eq(sessions.id, sessionIdFor(token, authSecret())), isNull(sessions.userId)))
    .returning({ loginState: sessions.loginState, expiresAt: sessions.expiresAt });
  if (!row?.loginState || row.expiresAt.getTime() < Date.now()) return null;
  return row.loginState;
}

type NewSession = { kind?: SessionKind; deviceName?: string | null; ttlMs?: number };

// Creates a fresh session (a new token, so a pre-login cookie can't be
// fixated into a signed-in one) for an allow-listed email.
export async function createSession(
  db: Db,
  email: string,
  userAgent: string | null,
  { kind = "browser", deviceName = null, ttlMs = SESSION_TTL_MS }: NewSession = {},
): Promise<{ token: string; expiresAt: Date }> {
  const normalised = email.trim().toLowerCase();
  if (!isAllowed(normalised)) throw new Error("not allow-listed");
  const [user] = await db
    .insert(users)
    .values({ email: normalised })
    .onConflictDoUpdate({ target: users.email, set: { email: normalised } })
    .returning({ id: users.id });
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + ttlMs);
  await db.insert(sessions).values({
    id: sessionIdFor(token, authSecret()),
    userId: user.id,
    userAgent,
    kind,
    deviceName: kind === "device" ? deviceName : null,
    expiresAt,
  });
  await db
    .insert(auditLog)
    .values({ actor: normalised, action: "auth.sign_in", ...(kind !== "browser" && { details: { kind } }) });
  return { token, expiresAt };
}

export async function revokeSession(db: Db, session: SessionUser) {
  await db
    .update(sessions)
    .set({ revokedAt: sql`now()` })
    .where(eq(sessions.id, session.sessionId));
  await db.insert(auditLog).values({ actor: session.email, action: "auth.sign_out" });
}

// AUTH-4 "sign out everywhere". Takes effect on the next request of every
// device, because each request checks the database.
export async function revokeAllSessions(db: Db, session: SessionUser): Promise<number> {
  const revoked = await db
    .update(sessions)
    .set({ revokedAt: sql`now()` })
    .where(and(eq(sessions.userId, session.userId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  await db.insert(auditLog).values({
    actor: session.email,
    action: "auth.sign_out_everywhere",
    details: { sessions: revoked.length },
  });
  return revoked.length;
}

export async function listSessions(db: Db, session: SessionUser) {
  const rows = await db
    .select({
      id: sessions.id,
      kind: sessions.kind,
      deviceName: sessions.deviceName,
      userAgent: sessions.userAgent,
      createdAt: sessions.createdAt,
      lastSeenAt: sessions.lastSeenAt,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, session.userId),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, sql`now()`),
      ),
    )
    .orderBy(sessions.createdAt);
  return rows.map(({ id, kind, ...rest }) => ({
    ...rest,
    kind: kind as SessionKind,
    current: id === session.sessionId,
  }));
}

// --- Single-use codes (intent 0004, API-1, API-5) ---------------------------

export type DeviceCode = { purpose: "device"; challenge: string; deviceName: string | null };
export type HandoffCode = { purpose: "handoff"; returnTo: string };

// Issues a code for a signed-in user (by email or id). The code itself is
// returned once and only its HMAC is stored.
export async function issueCode(
  db: Db,
  user: { email: string },
  code: DeviceCode | HandoffCode,
): Promise<string> {
  const email = user.email.trim().toLowerCase();
  if (!isAllowed(email)) throw new Error("not allow-listed");
  const [row] = await db
    .insert(users)
    .values({ email })
    .onConflictDoUpdate({ target: users.email, set: { email } })
    .returning({ id: users.id });
  const value = newSessionToken();
  await db.insert(authCodes).values({
    id: sessionIdFor(value, authSecret()),
    purpose: code.purpose,
    userId: row.id,
    challenge: code.purpose === "device" ? code.challenge : null,
    deviceName: code.purpose === "device" ? code.deviceName : null,
    returnTo: code.purpose === "handoff" ? code.returnTo : null,
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  });
  // Housekeeping: expired codes are useless.
  await db.delete(authCodes).where(lt(authCodes.expiresAt, sql`now()`));
  return value;
}

// Single use: the row is deleted whether or not the caller then succeeds.
// Null for an unknown, expired or wrong-purpose code, or a user no longer on
// the allow-list.
async function takeCodeRow(db: Db, value: string | null | undefined, purpose: "device" | "handoff") {
  if (!value || !isWellFormedToken(value)) return null;
  const [row] = await db
    .delete(authCodes)
    .where(and(eq(authCodes.id, sessionIdFor(value, authSecret())), eq(authCodes.purpose, purpose)))
    .returning();
  if (!row || row.expiresAt.getTime() < Date.now()) return null;
  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, row.userId));
  if (!user || !isAllowed(user.email)) return null;
  return { email: user.email, row };
}

export async function takeDeviceCode(db: Db, value: string | null | undefined) {
  const taken = await takeCodeRow(db, value, "device");
  if (!taken?.row.challenge) return null;
  const code: DeviceCode = {
    purpose: "device",
    challenge: taken.row.challenge,
    deviceName: taken.row.deviceName,
  };
  return { email: taken.email, code };
}

export async function takeHandoffCode(db: Db, value: string | null | undefined) {
  const taken = await takeCodeRow(db, value, "handoff");
  if (!taken?.row.returnTo) return null;
  const code: HandoffCode = { purpose: "handoff", returnTo: taken.row.returnTo };
  return { email: taken.email, code };
}
