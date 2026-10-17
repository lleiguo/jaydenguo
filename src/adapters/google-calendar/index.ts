import * as client from "openid-client";
import { categorise } from "../../domain/categories";
import { addDays } from "../../domain/time";
import type { SourceRecord } from "../../domain/upsert";
import { googleConfig } from "../../server/auth/oidc";
import { registerSecret } from "../../server/log";
import { FetchError, politeFetch } from "../http";
import { SyncError, type Adapter, type AdapterContext, type NormalisedBatch } from "../types";

// Household Google Calendar (SRC-1), read-only, through the owner's
// connected Google account. Recurring events come back expanded
// (singleEvents), each with its own stable ID.

const PAST_DAYS = 30;
const FUTURE_DAYS = 400;

export const googleApiBase = () => process.env.GOOGLE_API_BASE ?? "https://www.googleapis.com";

type GoogleTime = { date?: string; dateTime?: string; timeZone?: string };
export type GoogleEvent = {
  id: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  htmlLink?: string;
  start: GoogleTime;
  end: GoogleTime;
  updated?: string;
  extendedProperties?: { private?: Record<string, string>; shared?: Record<string, string> };
};
export type GoogleCalendarRaw = { items: GoogleEvent[]; timeMin: string; timeMax: string };

export async function googleAccessToken(refreshToken: string): Promise<string> {
  try {
    const tokens = await client.refreshTokenGrant(await googleConfig(), refreshToken);
    // CRED-5: an access token is as secret as the grant for its hour.
    registerSecret(tokens.access_token);
    return tokens.access_token;
  } catch (err) {
    if (err instanceof client.ResponseBodyError && err.error === "invalid_grant") {
      throw new SyncError("Google access was revoked or expired. Reconnect Google on the Accounts page.");
    }
    throw new SyncError("Couldn't sign in to Google. Try again later.");
  }
}

export type GoogleCalendarInfo = { id: string; summary: string; primary: boolean };

export async function listGoogleCalendars(accessToken: string): Promise<GoogleCalendarInfo[]> {
  const res = await politeFetch(
    new URL("/calendar/v3/users/me/calendarList?maxResults=250", googleApiBase()),
    {
      headers: { authorization: `Bearer ${accessToken}` },
    },
  );
  if (!res.ok) throw new SyncError(`Google Calendar answered with an error (${res.status}).`);
  const body = (await res.json()) as { items?: { id: string; summary?: string; primary?: boolean }[] };
  return (body.items ?? []).map((c) => ({ id: c.id, summary: c.summary ?? c.id, primary: !!c.primary }));
}

const text = (v: string | undefined) => (v?.trim() ? v.trim().slice(0, 2000) : null);

function toInstant(t: GoogleTime): { at: Date; allDay: boolean } {
  if (t.date) return { at: new Date(`${t.date}T00:00:00Z`), allDay: true };
  return { at: new Date(t.dateTime!), allDay: false };
}

export function normaliseGoogle(raw: GoogleCalendarRaw, ctx: AdapterContext): NormalisedBatch {
  const records: SourceRecord[] = [];
  const warnings: string[] = [];
  for (const e of raw.items) {
    if (e.status === "cancelled") continue;
    // Intent 0020, BACK-2: an event the hub wrote here is the hub's own
    // event, not a new household one.
    if (e.extendedProperties?.private?.hubEventId) continue;
    if (!e.start || (!e.start.date && !e.start.dateTime)) {
      warnings.push(`Skipped an event with no start time (${e.id}).`);
      continue;
    }
    const start = toInstant(e.start);
    const end = toInstant(e.end ?? e.start);
    const title = text(e.summary) ?? "(no title)";
    const { category, attendance } = categorise(title, ctx.source.mapping);
    records.push({
      externalId: e.id,
      title,
      category,
      attendance,
      notes: text(e.description),
      locationName: text(e.location),
      startUtc: start.at,
      endUtc: end.at < start.at ? start.at : end.at,
      allDay: start.allDay,
      sourceUrl: e.htmlLink ?? null,
    });
  }
  return { records, window: { from: new Date(raw.timeMin), to: new Date(raw.timeMax) }, warnings };
}

export const googleCalendarAdapter: Adapter<GoogleCalendarRaw> = {
  kind: "google_calendar",
  label: "Google Calendar",
  credentialKinds: ["oauth"],
  async fetchRaw(ctx) {
    const calendarId = ctx.source.config.calendarId;
    if (typeof calendarId !== "string" || !calendarId)
      throw new SyncError("Choose which Google calendar to read.");
    if (!ctx.credential || ctx.credential.provider !== "google")
      throw new SyncError("Connect a Google account on the Accounts page.");
    const token = await googleAccessToken(ctx.credential.secret);
    const today = ctx.now.toISOString().slice(0, 10);
    const timeMin = `${addDays(today, -PAST_DAYS)}T00:00:00Z`;
    const timeMax = `${addDays(today, FUTURE_DAYS)}T00:00:00Z`;
    const items: GoogleEvent[] = [];
    let pageToken: string | undefined;
    do {
      const url = new URL(`/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, googleApiBase());
      url.search = new URLSearchParams({
        singleEvents: "true",
        orderBy: "startTime",
        timeMin,
        timeMax,
        maxResults: "250",
        ...(pageToken ? { pageToken } : {}),
      }).toString();
      let res: Response;
      try {
        res = await politeFetch(url, { headers: { authorization: `Bearer ${token}` } });
      } catch (err) {
        throw err instanceof FetchError ? new SyncError(err.message) : err;
      }
      if (res.status === 404) throw new SyncError("That Google calendar wasn't found. Choose it again.");
      if (res.status === 401 || res.status === 403)
        throw new SyncError("Google refused access to the calendar. Reconnect Google on the Accounts page.");
      if (!res.ok)
        throw new SyncError(`Google Calendar answered with an error (${res.status}). Try again later.`);
      const body = (await res.json()) as { items?: GoogleEvent[]; nextPageToken?: string };
      items.push(...(body.items ?? []));
      pageToken = body.nextPageToken;
    } while (pageToken && items.length < 10_000);
    return { items, timeMin, timeMax };
  },
  normalise: normaliseGoogle,
};
