import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "../db";
import { findSession, type SessionUser } from "./session";
import { bearerToken, SESSION_COOKIE } from "./tokens";

// The signed-in user for this request (the cookie), looked up once per render.
export const currentSession = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return findSession(await getDb(), token);
});

// For /api/v1 route handlers: the iPhone app's bearer token when the request
// has one (intent 0004, API-2), else the cookie. Pages never accept bearer
// tokens.
export const currentApiSession = cache(async (): Promise<SessionUser | null> => {
  const authorization = (await headers()).get("authorization");
  if (authorization !== null) return findSession(await getDb(), bearerToken(authorization));
  return currentSession();
});

// For pages: the proxy already redirects anonymous requests; this is the
// second, independent check.
export async function requirePageSession(): Promise<SessionUser> {
  const session = await currentSession();
  if (!session) redirect("/login");
  return session;
}
