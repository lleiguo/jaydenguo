import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/server/auth/cookies";
import { revokeSession } from "@/server/auth/session";
import { api } from "@/server/http";

// Ends this session: the iPhone app's token (intent 0004, SEC-3), or the
// browser's cookie.
export const POST = api(async ({ db, session }) => {
  await revokeSession(db, session);
  const res = new NextResponse(null, { status: 204 });
  if (session.kind !== "device") clearSessionCookie(res);
  return res;
});
