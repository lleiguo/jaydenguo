import { createHmac, randomBytes } from "node:crypto";

// The only cookie Firebase Hosting forwards to Cloud Run (spec F-14).
export const SESSION_COOKIE = "__session";

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // AUTH-4: 30 days
export const LOGIN_TTL_MS = 10 * 60 * 1000;

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
