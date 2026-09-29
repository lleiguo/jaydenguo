import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// The only cookie Firebase Hosting forwards to Cloud Run (spec F-14).
export const SESSION_COOKIE = "__session";

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // AUTH-4: 30 days
export const LOGIN_TTL_MS = 10 * 60 * 1000;

// The iPhone app (intent 0004): its URL scheme, where sign-in returns
// (API-1) and where a browser-only flow ends (API-5).
export const APP_SCHEME = "jaydenguohub";
export const APP_AUTH_URL = `${APP_SCHEME}://auth`;
export const APP_DONE_URL = `${APP_SCHEME}://done`;
// Single-use codes (sign-in and handoff) live a minute.
export const CODE_TTL_MS = 60 * 1000;
// A handoff's web session lasts an hour.
export const HANDOFF_TTL_MS = 60 * 60 * 1000;

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

// Session rows are keyed by an HMAC of the cookie value, never the value
// itself.
export function sessionIdFor(token: string, secret: string): string {
  return createHmac("sha256", secret).update(token).digest("hex");
}

// Rejects anything that isn't shaped like a token before touching the database.
export function isWellFormedToken(token: string | undefined): token is string {
  return !!token && /^[A-Za-z0-9_-]{43}$/.test(token);
}

// `Authorization: Bearer <token>` from the iPhone app (API-2).
export function bearerToken(header: string | null | undefined): string | undefined {
  const m = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header?.trim() ?? "");
  return m?.[1];
}

// PKCE (RFC 7636, S256) between the app and this site (API-1).
export const isWellFormedChallenge = (c: string | null | undefined): c is string =>
  !!c && /^[A-Za-z0-9_-]{43}$/.test(c);
export const isWellFormedVerifier = (v: string | null | undefined): v is string =>
  !!v && /^[A-Za-z0-9._~-]{43,128}$/.test(v);

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function verifierMatches(verifier: string, challenge: string): boolean {
  if (!isWellFormedVerifier(verifier) || !isWellFormedChallenge(challenge)) return false;
  return timingSafeEqual(Buffer.from(pkceChallenge(verifier)), Buffer.from(challenge));
}

// A phone's name as the app sends it, made safe to store and show.
export function cleanDeviceName(name: string | null | undefined): string | null {
  const cleaned = (name ?? "")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .trim()
    .slice(0, 60);
  return cleaned || null;
}
