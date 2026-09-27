import { NextResponse } from "next/server";
import { setSessionCookie } from "@/server/auth/cookies";
import { createSession } from "@/server/auth/session";
import { allowedEmails, appUrl } from "@/server/config";
import { getDb } from "@/server/db";

export const dynamic = "force-dynamic";

// Dev-only sign-in shortcut (spec §5.2): signs in as the first allow-listed
// account without Google. NODE_ENV is fixed at build time, so the production
// build contains only the 404 branch; CI checks the marker string below is
// absent from the build output (scripts/check-no-dev-login.mjs).
export async function GET() {
  if (process.env.NODE_ENV !== "development") return new Response("Not found", { status: 404 });
  const marker = "DEV_LOGIN_SHORTCUT_ENABLED";
  const session = await createSession(await getDb(), allowedEmails()[0], marker);
  const res = NextResponse.redirect(new URL("/", appUrl()), 303);
  setSessionCookie(res, session.token, session.expiresAt);
  return res;
}
