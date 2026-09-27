import { NextResponse } from "next/server";
import { setSessionCookie } from "@/server/auth/cookies";
import { buildAuthorizationRequest } from "@/server/auth/oidc";
import { allowLoginAttempt, clientIp } from "@/server/auth/rate-limit";
import { startLogin } from "@/server/auth/session";
import { LOGIN_TTL_MS } from "@/server/auth/tokens";
import { appUrl } from "@/server/config";
import { getDb } from "@/server/db";
import { safeReturnTo } from "@/lib/routes";

export const dynamic = "force-dynamic";

// Step 1 of Google sign-in: remember state, nonce and PKCE verifier in a
// pre-login session, then send the browser to Google.
export async function GET(request: Request) {
  const db = await getDb();
  if (!(await allowLoginAttempt(db, clientIp(request.headers)))) {
    return NextResponse.redirect(new URL("/login?error=rate_limited", appUrl()), 303);
  }
  const returnTo = safeReturnTo(new URL(request.url).searchParams.get("next"));
  const auth = await buildAuthorizationRequest(new URL("/auth/google/callback", appUrl()).href);
  const token = await startLogin(
    db,
    { state: auth.state, nonce: auth.nonce, codeVerifier: auth.codeVerifier, returnTo },
    request.headers.get("user-agent"),
  );
  const res = NextResponse.redirect(auth.url, 303);
  setSessionCookie(res, token, new Date(Date.now() + LOGIN_TTL_MS));
  return res;
}
