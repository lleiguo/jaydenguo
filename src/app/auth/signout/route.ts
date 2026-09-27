import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/server/auth/cookies";
import { currentSession } from "@/server/auth/current";
import { revokeSession } from "@/server/auth/session";
import { appUrl } from "@/server/config";
import { getDb } from "@/server/db";

export async function POST() {
  const session = await currentSession();
  if (session) await revokeSession(await getDb(), session);
  const res = NextResponse.redirect(new URL("/login", appUrl()), 303);
  clearSessionCookie(res);
  return res;
}
