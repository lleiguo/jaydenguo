import { NextResponse, type NextRequest } from "next/server";
import { currentSession } from "@/server/auth/current";
import { finishGoogleConnect, GoogleConnectRefused } from "@/server/credentials/google-connect";
import { appUrl } from "@/server/config";
import { getDb } from "@/server/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await currentSession();
  if (!session) return NextResponse.redirect(new URL("/login", appUrl()), 303);
  try {
    const returnTo = await finishGoogleConnect(await getDb(), session, request.nextUrl);
    return NextResponse.redirect(new URL(returnTo, appUrl()), 303);
  } catch (err) {
    console.error(
      JSON.stringify({ severity: "WARNING", message: "google connect failed", error: String(err) }),
    );
    // A flow the iPhone app handed off (intent 0004, API-5) reports back to it.
    const back = new URL(
      session.kind === "handoff" ? "/auth/app-done?error=google" : "/settings/accounts?error=google",
      appUrl(),
    );
    if (err instanceof GoogleConnectRefused && err.code) back.searchParams.set("reason", err.code);
    return NextResponse.redirect(back, 303);
  }
}
