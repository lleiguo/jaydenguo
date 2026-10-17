import { FetchError, politeFetch } from "../http";
import { googleApiBase, type GoogleEvent } from ".";

// Writing to the household Google Calendar for Cookie (intent 0008,
// GCW-2). A writer is bound to one calendar and can do three things: find
// the event a given action added, add an event, and delete an event by the
// ID the hub recorded when it added it. Nothing else: no edits, no lists
// of the family's events, no other calendar.

export class WriteFailed extends Error {
  constructor(
    readonly status: number,
    // Worth trying again later (Google busy, network), or not (refused).
    readonly retry: boolean,
  ) {
    super(`Google Calendar answered ${status}`);
  }
}

export type NewGoogleEvent = {
  summary: string;
  location?: string;
  start: { date: string } | { dateTime: string; timeZone: string };
  end: { date: string } | { dateTime: string; timeZone: string };
};

export type CalendarWriter = {
  calendarId: string;
  // The event an action already added, if a try got that far before.
  findAdded(actionId: string): Promise<GoogleEvent | null>;
  add(actionId: string, event: NewGoogleEvent): Promise<GoogleEvent>;
  // Gone already counts as removed.
  remove(eventId: string): Promise<void>;
};

const TAG = "hubAction";

export function googleCalendarWriter(token: string, calendarId: string): CalendarWriter {
  const base = `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  const call = async (method: string, path: string, body?: unknown) => {
    let res: Response;
    try {
      res = await politeFetch(new URL(path, googleApiBase()), {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body ? { "content-type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      if (err instanceof FetchError) throw new WriteFailed(0, true);
      throw err;
    }
    return res;
  };
  const fail = (status: number) => new WriteFailed(status, status === 429 || status >= 500);

  return {
    calendarId,
    async findAdded(actionId) {
      const query = new URLSearchParams({ privateExtendedProperty: `${TAG}=${actionId}`, maxResults: "1" });
      const res = await call("GET", `${base}?${query}`);
      if (!res.ok) throw fail(res.status);
      const body = (await res.json()) as { items?: GoogleEvent[] };
      return body.items?.find((e) => e.status !== "cancelled") ?? null;
    },
    async add(actionId, event) {
      // Tagged with the action, so a retry after a lost answer finds it
      // instead of adding it twice.
      const res = await call("POST", base, {
        ...event,
        extendedProperties: { private: { [TAG]: actionId } },
      });
      if (!res.ok) throw fail(res.status);
      return (await res.json()) as GoogleEvent;
    },
    async remove(eventId) {
      const res = await call("DELETE", `${base}/${encodeURIComponent(eventId)}`);
      if (res.ok || res.status === 404 || res.status === 410) return;
      throw fail(res.status);
    },
  };
}

// Two-way sync's writer (intent 0020, TWSEC-1). Bound to the household
// calendar, and fenced: it changes or deletes only events the hub tagged
// with `hubEventId`, or untagged ones the caller names (a twin being linked,
// a household event changed in the hub), and never one that has ended.

export const HUB_TAG = "hubEventId";

export class Fenced extends Error {
  constructor(
    readonly googleEventId: string,
    reason: string,
  ) {
    super(`Refused to change ${googleEventId}: ${reason}`);
  }
}

type Tagged = GoogleEvent & {
  updated?: string;
  extendedProperties?: { private?: Record<string, string> };
};

export type HouseholdWriter = {
  calendarId: string;
  // The event tagged with a hub key, if a run got that far before (DUP2-3).
  findTagged(hubKey: string): Promise<Tagged | null>;
  create(body: object): Promise<Tagged>;
  patch(googleEventId: string, body: object): Promise<Tagged>;
  // Gone already counts as removed.
  remove(googleEventId: string): Promise<void>;
};

const endOf = (e: GoogleEvent) =>
  Date.parse(e.end?.dateTime ?? (e.end?.date ? `${e.end.date}T00:00:00Z` : "")) || 0;

export function householdWriter(
  token: string,
  calendarId: string,
  opts: { now: Date; untagged?: ReadonlySet<string> },
): HouseholdWriter {
  const base = `/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  const call = async (method: string, path: string, body?: unknown) => {
    try {
      return await politeFetch(new URL(path, googleApiBase()), {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body ? { "content-type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      if (err instanceof FetchError) throw new WriteFailed(0, true);
      throw err;
    }
  };
  const fail = (status: number) => new WriteFailed(status, status === 429 || status >= 500);
  const one = (id: string) => `${base}/${encodeURIComponent(id)}`;

  // TWSEC-1: look before touching.
  async function fence(id: string): Promise<Tagged | null> {
    const res = await call("GET", one(id));
    if (res.status === 404 || res.status === 410) return null;
    if (!res.ok) throw fail(res.status);
    const e = (await res.json()) as Tagged;
    if (e.status === "cancelled") return null;
    if (!e.extendedProperties?.private?.[HUB_TAG] && !opts.untagged?.has(id))
      throw new Fenced(id, "not an event the hub manages");
    if (endOf(e) <= opts.now.getTime()) throw new Fenced(id, "it has ended");
    return e;
  }

  return {
    calendarId,
    async findTagged(hubKey) {
      const query = new URLSearchParams({ privateExtendedProperty: `${HUB_TAG}=${hubKey}`, maxResults: "1" });
      const res = await call("GET", `${base}?${query}`);
      if (!res.ok) throw fail(res.status);
      const body = (await res.json()) as { items?: Tagged[] };
      return body.items?.find((e) => e.status !== "cancelled") ?? null;
    },
    async create(body) {
      const res = await call("POST", base, body);
      if (!res.ok) throw fail(res.status);
      return (await res.json()) as Tagged;
    },
    async patch(id, body) {
      if (!(await fence(id))) throw new WriteFailed(404, false);
      const res = await call("PATCH", one(id), body);
      if (!res.ok) throw fail(res.status);
      return (await res.json()) as Tagged;
    },
    async remove(id) {
      if (!(await fence(id))) return;
      const res = await call("DELETE", one(id));
      if (res.ok || res.status === 404 || res.status === 410) return;
      throw fail(res.status);
    },
  };
}
