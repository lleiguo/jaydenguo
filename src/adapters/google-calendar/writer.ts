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
