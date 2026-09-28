import { and, eq, gt, lt, sql } from "drizzle-orm";
import * as client from "openid-client";
import { credentials, oauthRequests } from "@db/schema";
import { googleConfig } from "../auth/oidc";
import type { SessionUser } from "../auth/session";
import { sessionIdFor } from "../auth/tokens";
import { appUrl, authSecret } from "../config";
import { seal } from "../crypto/envelope";
import { defaultKeyWrapper, type KeyWrapper } from "../crypto/key-wrapper";
import type { Db } from "../db/client";
import { CLASSROOM_SCOPES, googleErrorCode, probeClassroom } from "../../adapters/classroom/api";
import { listGoogleCalendars, type GoogleCalendarInfo } from "../../adapters/google-calendar";
import { aadFor } from "./aad";
import { audit } from "./store";

// Connecting a Google account as a data source (CRED-2): an offline grant
// whose refresh token is sealed straight away. Scopes are asked for only when
// a feature needs them (plan M1.3); Google adds them to earlier grants
// (include_granted_scopes). The account chooser is always shown, since
// Classroom uses Jayden's school account, not the owner's (plan M4.1).

export const GOOGLE_SCOPES = {
  calendar: ["https://www.googleapis.com/auth/calendar.readonly"],
  classroom: CLASSROOM_SCOPES,
  // Coach and club emails, read-only; only allow-listed senders and labels
  // are fetched (SRC-4, EML-1).
  gmail: ["https://www.googleapis.com/auth/gmail.readonly"],
  // Video reviews (VID-2, F-4): read a Drive file the owner links, and the
  // video the owner picks in Google Photos.
  videos: [
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/photospicker.mediaitems.readonly",
  ],
} as const satisfies Record<string, readonly string[]>;
export type GoogleFeature = keyof typeof GOOGLE_SCOPES;

const REQUEST_TTL_MS = 10 * 60_000;
export const CONNECT_CALLBACK = "/accounts/google/callback";

export async function startGoogleConnect(
  db: Db,
  session: SessionUser,
  features: GoogleFeature[],
  returnTo: string,
): Promise<URL> {
  const config = await googleConfig();
  const state = client.randomState();
  const nonce = client.randomNonce();
  const codeVerifier = client.randomPKCECodeVerifier();
  const scopes = ["openid", "email", ...new Set(features.flatMap((f) => GOOGLE_SCOPES[f]))];
  await db.delete(oauthRequests).where(lt(oauthRequests.expiresAt, sql`now()`));
  await db.insert(oauthRequests).values({
    id: sessionIdFor(state, authSecret()),
    sessionId: session.sessionId,
    nonce,
    codeVerifier,
    scopes,
    returnTo,
    expiresAt: new Date(Date.now() + REQUEST_TTL_MS),
  });
  return client.buildAuthorizationUrl(config, {
    redirect_uri: new URL(CONNECT_CALLBACK, appUrl()).href,
    scope: scopes.join(" "),
    state,
    nonce,
    code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "select_account consent",
    include_granted_scopes: "true",
  });
}

// Google sent the owner back without a grant: cancelled, or refused by the
// account's admin (e.g. "admin_policy_enforced" on a school account, F-5).
export class GoogleConnectRefused extends Error {
  constructor(readonly code: string | null) {
    super(`Google refused the connection (${code ?? "unknown"})`);
  }
}

export async function finishGoogleConnect(
  db: Db,
  session: SessionUser,
  incoming: URL,
  wrapper: KeyWrapper = defaultKeyWrapper(),
): Promise<string> {
  const state = incoming.searchParams.get("state") ?? "";
  const [request] = await db
    .delete(oauthRequests)
    .where(
      and(
        eq(oauthRequests.id, sessionIdFor(state, authSecret())),
        eq(oauthRequests.sessionId, session.sessionId),
        gt(oauthRequests.expiresAt, sql`now()`),
      ),
    )
    .returning();
  if (!request) throw new Error("unknown or expired connection request");
  if (incoming.searchParams.has("error")) {
    throw new GoogleConnectRefused(googleErrorCode(incoming.searchParams.get("error")));
  }

  const tokens = await client.authorizationCodeGrant(
    await googleConfig(),
    new URL(`${CONNECT_CALLBACK}${incoming.search}`, appUrl()),
    {
      pkceCodeVerifier: request.codeVerifier,
      expectedState: state,
      expectedNonce: request.nonce,
      idTokenExpected: true,
    },
  );
  const email = tokens.claims()?.email;
  if (typeof email !== "string") throw new Error("no account email in the ID token");
  if (!tokens.refresh_token) throw new Error("Google returned no refresh token");
  const granted = (tokens.scope ?? request.scopes.join(" ")).split(" ").filter(Boolean);

  // While the access token is at hand, note the account's calendars so the
  // Sources page can offer them (the web app can't use the refresh token).
  let calendars: GoogleCalendarInfo[] | undefined;
  if (granted.includes(GOOGLE_SCOPES.calendar[0])) {
    calendars = await listGoogleCalendars(tokens.access_token).catch(() => undefined);
  }
  // SP-5: can the school account's Classroom be read? The answer, or the
  // exact refusal, is kept on the credential and shown on the Accounts page.
  const classroom = CLASSROOM_SCOPES.some((s) => granted.includes(s))
    ? await probeClassroom(tokens.access_token)
    : undefined;
  const meta = { ...(calendars ? { calendars } : {}), ...(classroom ? { classroom } : {}) };

  // One credential per Google account: reconnecting replaces the token.
  const [existing] = await db
    .select({ id: credentials.id })
    .from(credentials)
    .where(and(eq(credentials.provider, "google"), eq(credentials.username, email.toLowerCase())));
  const id = existing?.id ?? crypto.randomUUID();
  const sealed = await seal(wrapper, tokens.refresh_token, aadFor(id));
  if (existing) {
    await db
      .update(credentials)
      .set({ ...sealed, scopes: granted, meta, status: "active", updatedAt: new Date(), lastError: null })
      .where(eq(credentials.id, id));
  } else {
    await db.insert(credentials).values({
      id,
      kind: "oauth",
      provider: "google",
      label: `Google (${email.toLowerCase()})`,
      username: email.toLowerCase(),
      scopes: granted,
      meta,
      ...sealed,
    });
  }
  await audit(db, session.email, existing ? "credential.update" : "credential.create", id, {
    provider: "google",
    scopes: granted,
  });
  return request.returnTo;
}
