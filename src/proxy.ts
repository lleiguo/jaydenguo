import { NextResponse, type NextRequest } from "next/server";
import { isApiPath, isPublicPath, isSameOriginMutation } from "./lib/routes";
import { contentSecurityPolicy, newNonce } from "./lib/security-headers";
import { findSession } from "./server/auth/session";
import { SESSION_COOKIE } from "./server/auth/tokens";
import { appUrl } from "./server/config";
import { getDb } from "./server/db";

// Runs before every route (plan M1.1):
// - a per-request CSP nonce (no 'unsafe-inline');
// - `Cache-Control: private, no-store`, because Firebase Hosting is a CDN;
// - CSRF check on mutations;
// - the sign-in gate for every page and API route (AUTH-2). Route handlers
//   and pages check the session again themselves.
export async function proxy(request: NextRequest) {
  const nonce = newNonce();
  const csp = contentSecurityPolicy(nonce, process.env.NODE_ENV === "development");
  const finish = (res: NextResponse) => {
    res.headers.set("Content-Security-Policy", csp);
    res.headers.set("Cache-Control", "private, no-store");
    return res;
  };
  const { pathname, search } = request.nextUrl;

  if (!isSameOriginMutation(request.method, request.headers, appUrl().origin)) {
    return finish(NextResponse.json({ error: "forbidden" }, { status: 403 }));
  }

  if (!isPublicPath(pathname)) {
    const session = await findSession(await getDb(), request.cookies.get(SESSION_COOKIE)?.value);
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
