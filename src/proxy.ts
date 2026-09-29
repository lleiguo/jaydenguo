import { NextResponse, type NextRequest } from "next/server";
import { isAppTooOld, UPDATE_MESSAGE } from "./lib/app-version";
import { isApiPath, isPublicPath, isSameOriginMutation, isTokenEndpoint } from "./lib/routes";
import { contentSecurityPolicy, newNonce } from "./lib/security-headers";
import { findSession } from "./server/auth/session";
import { bearerToken, SESSION_COOKIE } from "./server/auth/tokens";
import { appUrl } from "./server/config";
import { getDb } from "./server/db";

// Runs before every route (plan M1.1):
// - a per-request CSP nonce (no 'unsafe-inline');
// - `Cache-Control: private, no-store`, because Firebase Hosting is a CDN;
// - CSRF check on mutations;
// - the sign-in gate for every page and API route (AUTH-2). Route handlers
//   and pages check the session again themselves.
// API routes also take the iPhone app's bearer token (intent 0004, API-2):
// a request that sends one is judged by it alone and needs no Origin (a
// browser never adds the header by itself, so CSRF doesn't apply). Pages
// never take bearer tokens.
export async function proxy(request: NextRequest) {
  const nonce = newNonce();
  const csp = contentSecurityPolicy(nonce, process.env.NODE_ENV === "development");
  const finish = (res: NextResponse) => {
    res.headers.set("Content-Security-Policy", csp);
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  };
  const { pathname, search } = request.nextUrl;
  const isApi = isApiPath(pathname);
  const authorization = isApi ? request.headers.get("authorization") : null;

  if (isApi && isAppTooOld(request.headers.get("x-app-version"), process.env.MIN_APP_VERSION)) {
    return finish(NextResponse.json({ error: UPDATE_MESSAGE }, { status: 426 }));
  }

  if (
    authorization === null &&
    !isTokenEndpoint(pathname) &&
    !isSameOriginMutation(request.method, request.headers, appUrl().origin)
  ) {
    return finish(NextResponse.json({ error: "forbidden" }, { status: 403 }));
  }

  if (!isPublicPath(pathname)) {
    const token =
      authorization !== null ? bearerToken(authorization) : request.cookies.get(SESSION_COOKIE)?.value;
    const session = await findSession(await getDb(), token);
    if (!session) {
      if (isApiPath(pathname)) return finish(NextResponse.json({ error: "unauthorised" }, { status: 401 }));
      const login = new URL("/login", appUrl());
      if (pathname !== "/") login.searchParams.set("next", pathname + search);
      return finish(NextResponse.redirect(login, 303));
    }
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  return finish(NextResponse.next({ request: { headers: requestHeaders } }));
}

export const config = {
  // Hashed build assets are public and immutable; everything else goes
  // through the proxy.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
