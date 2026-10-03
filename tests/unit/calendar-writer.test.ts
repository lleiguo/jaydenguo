import { afterEach, describe, expect, it, vi } from "vitest";
import { googleCalendarWriter, WriteFailed } from "@/adapters/google-calendar/writer";
import { googleBody } from "@/worker/assistant-actions";

// Intent 0008, GCW-2: what the writer asks Google for, and nothing more.

describe("the household calendar writer", () => {
  const seen: { method: string; url: string; body?: unknown }[] = [];
  const answer = (status: number, body: unknown = {}) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL, init?: RequestInit) => {
        seen.push({
          method: init?.method ?? "GET",
          url: String(url),
          body: init?.body && JSON.parse(String(init.body)),
        });
        return new Response(status === 204 ? null : JSON.stringify(body), { status });
      }),
    );
  afterEach(() => {
    vi.unstubAllGlobals();
    seen.length = 0;
  });
  const writer = () => googleCalendarWriter("token", "house hold@group.calendar.google.com");

  it("adds to its one calendar, tagged with the action, and finds that tag again", async () => {
    answer(200, { id: "e1", start: {}, end: {} });
    await writer().add("a1", {
      summary: "Sam dentist",
      start: { date: "2026-12-03" },
      end: { date: "2026-12-04" },
    });
    expect(seen[0].method).toBe("POST");
    expect(seen[0].url).toBe(
      "https://www.googleapis.com/calendar/v3/calendars/house%20hold%40group.calendar.google.com/events",
    );
    expect(seen[0].body).toMatchObject({
      summary: "Sam dentist",
      extendedProperties: { private: { hubAction: "a1" } },
    });

    answer(200, { items: [{ id: "e1", status: "confirmed" }] });
    expect(await writer().findAdded("a1")).toMatchObject({ id: "e1" });
    expect(seen[1].url).toContain("privateExtendedProperty=hubAction%3Da1");
  });

  it("deletes by the ID it was given, and counts gone as removed", async () => {
    answer(204);
    await writer().remove("e1");
    expect(seen[0]).toMatchObject({ method: "DELETE" });
    expect(seen[0].url).toMatch(/\/events\/e1$/);
    answer(410);
    await expect(writer().remove("e1")).resolves.toBeUndefined();
  });

  it("says whether a refusal is worth trying again", async () => {
    answer(503);
    await expect(writer().findAdded("a1")).rejects.toMatchObject({ status: 503, retry: true });
    answer(403);
    const refused = await writer()
      .add("a1", { summary: "x", start: { date: "2026-12-03" }, end: { date: "2026-12-04" } })
      .catch((e) => e);
    expect(refused).toBeInstanceOf(WriteFailed);
    expect(refused).toMatchObject({ status: 403, retry: false });
  });
});

describe("the event Google is sent", () => {
  it("sends a timed event in UTC with the home time zone named", () => {
    expect(
      googleBody(
        {
          title: "Sam dentist",
          locationName: "Elm Clinic",
          startUtc: new Date("2026-12-04T02:00:00Z"),
          endUtc: new Date("2026-12-04T03:00:00Z"),
          allDay: false,
        },
        "America/Vancouver",
      ),
    ).toEqual({
      summary: "Sam dentist",
      location: "Elm Clinic",
      start: { dateTime: "2026-12-04T02:00:00.000Z", timeZone: "America/Vancouver" },
      end: { dateTime: "2026-12-04T03:00:00.000Z", timeZone: "America/Vancouver" },
    });
  });

  it("sends an all-day event as its day, with Google's exclusive end", () => {
    expect(
      googleBody(
        {
          title: "family day",
          locationName: null,
          startUtc: new Date("2026-12-24T00:00:00Z"),
          endUtc: new Date("2026-12-25T00:00:00Z"),
          allDay: true,
        },
        "America/Vancouver",
      ),
    ).toEqual({ summary: "family day", start: { date: "2026-12-24" }, end: { date: "2026-12-25" } });
  });
});
