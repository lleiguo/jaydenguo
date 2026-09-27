import { and, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { auditLog, sessions, users, type LoginState } from "@db/schema";
import { allowedEmails, authSecret } from "../config";
import type { Db } from "../db/client";
import { LOGIN_TTL_MS, SESSION_TTL_MS, isWellFormedToken, newSessionToken, sessionIdFor } from "./tokens";

export type SessionUser = { sessionId: string; userId: string; email: string };

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
    .select({ sessionId: sessions.id, userId: users.id, email: users.email, lastSeenAt: sessions.lastSeenAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, id), isNull(sessions.revokedAt), gt(sessions.expiresAt, sql`now()`)))
    .limit(1);
  if (!row || !isAllowed(row.email)) return null;
  // Record use at most once a minute, for the devices list.
  if (!row.lastSeenAt || Date.now() - row.lastSeenAt.getTime() > 60_000) {
    await db
      .update(sessions)
      .set({ lastSeenAt: sql`now()` })
      .where(eq(sessions.id, id));
  }
  return { sessionId: row.sessionId, userId: row.userId, email: row.email };
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

// Creates a fresh session (a new token, so a pre-login cookie can't be
// fixated into a signed-in one) for an allow-listed email.
export async function createSession(
  db: Db,
  email: string,
  userAgent: string | null,
): Promise<{ token: string; expiresAt: Date }> {
  const normalised = email.trim().toLowerCase();
  if (!isAllowed(normalised)) throw new Error("not allow-listed");
  const [user] = await db
    .insert(users)
    .values({ email: normalised })
    .onConflictDoUpdate({ target: users.email, set: { email: normalised } })
    .returning({ id: users.id });
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db
    .insert(sessions)
    .values({ id: sessionIdFor(token, authSecret()), userId: user.id, userAgent, expiresAt });
  await db.insert(auditLog).values({ actor: normalised, action: "auth.sign_in" });
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
  return rows.map(({ id, ...rest }) => ({ ...rest, current: id === session.sessionId }));
}
