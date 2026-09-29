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
//
// ?client=ios answers with a device token as JSON instead, for the iPhone
// app's UI tests against a local server (intent 0004, plan N1.5).
export async function GET(request: Request) {
  if (process.env.NODE_ENV !== "development") return new Response("Not found", { status: 404 });
  const marker = "DEV_LOGIN_SHORTCUT_ENABLED";
  if (new URL(request.url).searchParams.get("client") === "ios") {
    const device = await createSession(await getDb(), allowedEmails()[0], marker, {
      kind: "device",
      deviceName: "UI tests",
    });
    return Response.json({ token: device.token, expiresAt: device.expiresAt.toISOString() });
  }
  const session = await createSession(await getDb(), allowedEmails()[0], marker);
  const res = NextResponse.redirect(new URL("/", appUrl()), 303);
  setSessionCookie(res, session.token, session.expiresAt);
  return res;
}
