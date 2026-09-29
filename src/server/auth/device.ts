import { z } from "zod";
import { HttpError } from "../errors";
import type { Db } from "../db/client";
import { hit } from "./rate-limit";
import { createSession, issueCode, takeDeviceCode, takeHandoffCode, type SessionUser } from "./session";
import { HANDOFF_TTL_MS, verifierMatches } from "./tokens";

// The iPhone app's sign-in (intent 0004, API-1) and web handoff (API-5).

export const deviceTokenInput = z.object({
  code: z.string().max(100),
  verifier: z.string().max(200),
});

// Swaps the single-use code from jaydenguohub://auth, with the app's PKCE
// verifier, for a device token. Every failure looks the same.
export async function exchangeDeviceCode(
  db: Db,
  input: z.infer<typeof deviceTokenInput>,
  clientIp: string,
  userAgent: string | null,
): Promise<{ token: string; expiresAt: string }> {
  if (!(await hit(db, `device:ip:${clientIp}`, 20, 10 * 60_000)))
    throw new HttpError(429, "Too many tries. Wait a few minutes.");
  const taken = await takeDeviceCode(db, input.code);
  if (!taken || !verifierMatches(input.verifier, taken.code.challenge)) {
    throw new HttpError(401, "Sign-in didn't finish. Try again.");
  }
  const session = await createSession(db, taken.email, userAgent, {
    kind: "device",
    deviceName: taken.code.deviceName,
  });
  return { token: session.token, expiresAt: session.expiresAt.toISOString() };
}

// Browser-only flows the app may hand off to (API-5): connecting a Google
// account. Anything else is refused, so a handoff can't open arbitrary pages.
const HANDOFF_PATHS = ["/accounts/google/connect"];

export const handoffInput = z.object({
  next: z
    .string()
    .max(500)
    .refine((next) => {
      try {
        const url = new URL(next, "https://x.invalid");
        return url.origin === "https://x.invalid" && HANDOFF_PATHS.includes(url.pathname);
      } catch {
        return false;
      }
    }, "that page can't be opened from the app"),
});

export async function startHandoff(
  db: Db,
  session: SessionUser,
  input: z.infer<typeof handoffInput>,
  origin: string,
): Promise<{ url: string; expiresAt: string }> {
  const code = await issueCode(db, session, { purpose: "handoff", returnTo: input.next });
  const url = new URL("/auth/handoff", origin);
  url.searchParams.set("code", code);
  return { url: url.href, expiresAt: new Date(Date.now() + 60_000).toISOString() };
}

// Opens a handoff link: a short web session (an hour) and where to go.
export async function openHandoff(
  db: Db,
  code: string | null,
  userAgent: string | null,
): Promise<{ token: string; expiresAt: Date; returnTo: string } | null> {
  const taken = await takeHandoffCode(db, code);
  if (!taken) return null;
  const session = await createSession(db, taken.email, userAgent, { kind: "handoff", ttlMs: HANDOFF_TTL_MS });
  return { ...session, returnTo: taken.code.returnTo };
}
