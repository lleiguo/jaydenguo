import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/server/auth/cookies";
import { revokeAllSessions } from "@/server/auth/session";
import { api } from "@/server/http";

// "Sign out everywhere" (AUTH-4), including this device.
export const POST = api(async ({ db, session }) => {
  const revoked = await revokeAllSessions(db, session);
  const res = NextResponse.json({ revoked });
  clearSessionCookie(res);
  return res;
});
