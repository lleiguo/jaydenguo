import { NextResponse, type NextRequest } from "next/server";
import { auditLog } from "@db/schema";
import { clearSessionCookie, setSessionCookie } from "@/server/auth/cookies";
import { completeAuthorization } from "@/server/auth/oidc";
import { createSession, isAllowed, issueCode, takeLogin } from "@/server/auth/session";
import { APP_AUTH_URL, SESSION_COOKIE } from "@/server/auth/tokens";
import { appUrl } from "@/server/config";
import { getDb } from "@/server/db";

export const dynamic = "force-dynamic";

// Step 2 of Google sign-in: check the response against the pre-login
// session, then create a real session for an allow-listed account only.
// A sign-in from the iPhone app (intent 0004, API-1) gets a single-use code
// at jaydenguohub://auth instead of a cookie.
export async function GET(request: NextRequest) {
  const db = await getDb();
  const incoming = request.nextUrl;
  const login = await takeLogin(db, request.cookies.get(SESSION_COOKIE)?.value);

  const fail = (reason: string) => {
    const res = NextResponse.redirect(
      login?.app ? `${APP_AUTH_URL}?error=${reason}` : new URL(`/login?error=${reason}`, appUrl()),
      303,
    );
    clearSessionCookie(res);
    return res;
  };
  if (!login) return fail("expired");
  if (incoming.searchParams.has("error")) return fail("cancelled");

  let email: string;
  try {
    // Rebuild the URL on the public origin: that is the registered
    // redirect URI, whatever host Cloud Run saw.
    const callbackUrl = new URL(`/auth/google/callback${incoming.search}`, appUrl());
    ({ email } = await completeAuthorization(callbackUrl, login));
  } catch (err) {
    console.error(JSON.stringify({ severity: "WARNING", message: "sign-in failed", error: String(err) }));
    return fail("failed");
  }

  if (!isAllowed(email)) {
    await db.insert(auditLog).values({ actor: email.toLowerCase(), action: "auth.refused" });
    return fail("not_authorised");
  }
  if (login.app) {
    const code = await issueCode(db, { email }, { purpose: "device", ...login.app });
    const res = NextResponse.redirect(`${APP_AUTH_URL}?code=${code}`, 303);
    clearSessionCookie(res);
    return res;
  }
  const session = await createSession(db, email, request.headers.get("user-agent"));
  const res = NextResponse.redirect(new URL(login.returnTo, appUrl()), 303);
  setSessionCookie(res, session.token, session.expiresAt);
  return res;
}
