import { NextResponse, type NextRequest } from "next/server";
import { openHandoff } from "@/server/auth/device";
import { setSessionCookie } from "@/server/auth/cookies";
import { APP_DONE_URL } from "@/server/auth/tokens";
import { appUrl } from "@/server/config";
import { getDb } from "@/server/db";

export const dynamic = "force-dynamic";

// intent 0004, API-5: the app opens its handoff link here in a browser sheet;
// a short web session is set and the flow continues. A used or expired link
// goes straight back to the app.
export async function GET(request: NextRequest) {
  const opened = await openHandoff(
    await getDb(),
    request.nextUrl.searchParams.get("code"),
    request.headers.get("user-agent"),
  );
  if (!opened) return NextResponse.redirect(`${APP_DONE_URL}?error=expired`, 303);
  const res = NextResponse.redirect(new URL(opened.returnTo, appUrl()), 303);
  setSessionCookie(res, opened.token, opened.expiresAt);
  return res;
}
