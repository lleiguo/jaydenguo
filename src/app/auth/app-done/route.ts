import { NextResponse, type NextRequest } from "next/server";
import { clearSessionCookie } from "@/server/auth/cookies";
import { currentSession } from "@/server/auth/current";
import { revokeSession } from "@/server/auth/session";
import { APP_DONE_URL } from "@/server/auth/tokens";
import { getDb } from "@/server/db";

export const dynamic = "force-dynamic";

// intent 0004, API-5: the end of a flow the app handed off. The handoff's
// web session ends here and the browser sheet returns to the app with the
// outcome (?error=… passes through).
export async function GET(request: NextRequest) {
  const session = await currentSession();
  if (session?.kind === "handoff") await revokeSession(await getDb(), session);
  const done = new URL(APP_DONE_URL);
  for (const key of ["error", "reason"]) {
    const value = request.nextUrl.searchParams.get(key);
    if (value) done.searchParams.set(key, value.slice(0, 50));
  }
  const res = NextResponse.redirect(done.href, 303);
  clearSessionCookie(res);
  return res;
}
