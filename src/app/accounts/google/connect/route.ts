import { NextResponse, type NextRequest } from "next/server";
import { safeReturnTo } from "@/lib/routes";
import { currentSession } from "@/server/auth/current";
import { GOOGLE_SCOPES, startGoogleConnect, type GoogleFeature } from "@/server/credentials/google-connect";
import { appUrl } from "@/server/config";
import { getDb } from "@/server/db";

export const dynamic = "force-dynamic";

// Starts connecting a Google account for the features asked for, e.g.
// /accounts/google/connect?feature=calendar
export async function GET(request: NextRequest) {
  const session = await currentSession();
  if (!session) return NextResponse.redirect(new URL("/login", appUrl()), 303);
  const features = request.nextUrl.searchParams
    .getAll("feature")
    .filter((f): f is GoogleFeature => Object.hasOwn(GOOGLE_SCOPES, f));
  const returnTo = safeReturnTo(request.nextUrl.searchParams.get("next") ?? "/settings/accounts");
  const url = await startGoogleConnect(await getDb(), session, features, returnTo);
  return NextResponse.redirect(url, 303);
}
