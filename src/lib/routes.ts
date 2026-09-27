// Which paths can be reached without signing in (spec AUTH-2). Everything
// else needs a session; the list is deliberately short and exact.
const PUBLIC_EXACT = new Set([
  "/login",
  "/auth/google/start",
  "/auth/google/callback",
  "/auth/dev", // answers 404 outside `next dev`
  "/api/healthz",
  "/robots.txt",
  "/manifest.webmanifest",
  "/sw.js",
  "/favicon.ico",
]);
const PUBLIC_PREFIXES = ["/_next/static/", "/icons/"];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_EXACT.has(pathname) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
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
