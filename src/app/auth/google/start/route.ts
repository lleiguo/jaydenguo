import { NextResponse } from "next/server";
import { setSessionCookie } from "@/server/auth/cookies";
import { buildAuthorizationRequest } from "@/server/auth/oidc";
import { allowLoginAttempt, clientIp } from "@/server/auth/rate-limit";
import { startLogin } from "@/server/auth/session";
import { APP_AUTH_URL, cleanDeviceName, isWellFormedChallenge, LOGIN_TTL_MS } from "@/server/auth/tokens";
import { appUrl } from "@/server/config";
import { getDb } from "@/server/db";
import { safeReturnTo } from "@/lib/routes";

export const dynamic = "force-dynamic";

// Step 1 of Google sign-in: remember state, nonce and PKCE verifier in a
// pre-login session, then send the browser to Google.
//
// From the iPhone app (intent 0004, API-1): ?client=ios&challenge=<S256>&device=<name>.
// The app's own PKCE challenge is kept for the code exchange at
// /api/v1/auth/device.
export async function GET(request: Request) {
  const db = await getDb();
  const params = new URL(request.url).searchParams;
  const fromApp = params.get("client") === "ios";
  const challenge = params.get("challenge");
  if (fromApp && !isWellFormedChallenge(challenge)) {
    return NextResponse.redirect(`${APP_AUTH_URL}?error=bad_request`, 303);
  }
  if (!(await allowLoginAttempt(db, clientIp(request.headers)))) {
    return NextResponse.redirect(
      fromApp ? `${APP_AUTH_URL}?error=rate_limited` : new URL("/login?error=rate_limited", appUrl()),
      303,
    );
  }
  const returnTo = safeReturnTo(params.get("next"));
  const auth = await buildAuthorizationRequest(new URL("/auth/google/callback", appUrl()).href);
  const token = await startLogin(
    db,
    {
      state: auth.state,
      nonce: auth.nonce,
      codeVerifier: auth.codeVerifier,
      returnTo,
      ...(fromApp && { app: { challenge: challenge!, deviceName: cleanDeviceName(params.get("device")) } }),
    },
    request.headers.get("user-agent"),
  );
  const res = NextResponse.redirect(auth.url, 303);
  setSessionCookie(res, token, new Date(Date.now() + LOGIN_TTL_MS));
  return res;
}
