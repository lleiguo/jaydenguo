// Which paths can be reached without signing in (spec AUTH-2). Everything
// else needs a session; the list is deliberately short and exact.
const PUBLIC_EXACT = new Set([
  "/login",
  "/auth/google/start",
  "/auth/google/callback",
  // The iPhone app (intent 0004): swap a sign-in code for a device token
  // (API-1), and open a handoff link (API-5). Both take single-use codes.
  "/api/v1/auth/device",
  "/auth/handoff",
  "/auth/app-done",
  "/auth/dev", // answers 404 outside `next dev`
  "/api/healthz",
  "/robots.txt",
  "/manifest.webmanifest",
  "/sw.js",
  "/offline.html",
  "/favicon.ico",
]);
const PUBLIC_PREFIXES = ["/_next/static/", "/icons/"];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_EXACT.has(pathname) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

// Public endpoints that take a single-use code instead of a cookie, so the
// CSRF check (which protects cookie-authenticated requests) doesn't apply.
export function isTokenEndpoint(pathname: string): boolean {
  return pathname === "/api/v1/auth/device";
}

export function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

// A post-login destination must be a path on this site, never another origin
// (no open redirects).
export function safeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "/";
  return value;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// CSRF protection for mutations (NFR-2), on top of SameSite=Lax cookies: the
// request must come from a page on this site.
export function isSameOriginMutation(method: string, headers: Headers, appOrigin: string): boolean {
  if (SAFE_METHODS.has(method)) return true;
  const origin = headers.get("origin");
  // With Referrer-Policy: no-referrer, browsers send "Origin: null" on form
  // posts; Sec-Fetch-Site still says where the request came from.
  if (origin && origin !== "null") return origin === appOrigin;
  return headers.get("sec-fetch-site") === "same-origin";
}
