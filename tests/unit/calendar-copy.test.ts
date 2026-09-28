import { describe, expect, it } from "vitest";
import { bodyHash, googleEventBody, planCopy, type CopySource } from "@/domain/calendar-copy";

const event = (over: Partial<CopySource> = {}): CopySource => ({
  id: "e1",
  title: "Swim practice",
  category: "swimming",
  start: "2030-03-04T22:00:00.000Z",
  end: "2030-03-04T23:30:00.000Z",
  allDay: false,
  locationName: "Aquatic centre",
  notes: null,
  ...over,
});

describe("googleEventBody", () => {
  it("copies a timed event with its place and the hub's ID", () => {
    expect(googleEventBody(event(), "America/Toronto")).toEqual({
      summary: "Swim practice",
      description: "Swimming\n\nCopied from the family hub.",
      location: "Aquatic centre",
      start: { dateTime: "2030-03-04T22:00:00.000Z", timeZone: "America/Toronto" },
      end: { dateTime: "2030-03-04T23:30:00.000Z", timeZone: "America/Toronto" },
      extendedProperties: { private: { hubEventId: "e1" } },
    });
  });

  it("copies an all-day event as dates, with an exclusive end after the start", () => {
    const b = googleEventBody(
      event({
        allDay: true,
        category: "school_closure",
        start: "2030-03-06T00:00:00.000Z",
        end: "2030-03-06T00:00:00.000Z",
      }),
      "America/Toronto",
    );
    expect(b.start).toEqual({ date: "2030-03-06" });
    expect(b.end).toEqual({ date: "2030-03-07" });
    expect(b.description.startsWith("School closure")).toBe(true);
  });
});

describe("planCopy", () => {
  const d = (id: string, title = "x") => {
    const body = googleEventBody(event({ id, title }), "America/Toronto");
    return { eventId: id, body, hash: bodyHash(body) };
  };

  it("creates new ones, changes changed ones and removes gone ones", () => {
    const a = d("a");
    const b = d("b", "changed");
    const plan = planCopy(
      [a, b, d("c")],
      [
        { eventId: "a", googleEventId: "ga", hash: a.hash },
        { eventId: "b", googleEventId: "gb", hash: "old" },
        { eventId: "z", googleEventId: "gz", hash: "h" },
      ],
    );
    expect(plan.create.map((x) => x.eventId)).toEqual(["c"]);
    expect(plan.update.map((x) => [x.eventId, x.googleEventId])).toEqual([["b", "gb"]]);
    expect(plan.remove.map((x) => x.eventId)).toEqual(["z"]);
  });

  it("does nothing when nothing changed", () => {
    const a = d("a");
    expect(planCopy([a], [{ eventId: "a", googleEventId: "ga", hash: a.hash }])).toEqual({
      create: [],
      update: [],
      remove: [],
    });
  });
});
