import { describe, expect, it } from "vitest";
import { schoolBlocks } from "@/domain/school-blocks";

// SCH-1: classes fold into one block per school day.

const tz = "America/Toronto";
const cls = (id: string, start: string, end: string, category = "school_class", allDay = false) => ({
  id,
  category,
  allDay,
  start: new Date(start).toISOString(),
  end: new Date(end).toISOString(),
});

describe("schoolBlocks", () => {
  it("groups a day's classes into one block from the first start to the last end", () => {
    const blocks = schoolBlocks(
      [
        cls("p2", "2028-01-04T09:30:00-05:00", "2028-01-04T10:20:00-05:00"),
        cls("p1", "2028-01-04T08:30:00-05:00", "2028-01-04T09:20:00-05:00"),
        cls("p3", "2028-01-04T14:00:00-05:00", "2028-01-04T15:00:00-05:00"),
        cls("soccer", "2028-01-04T16:00:00-05:00", "2028-01-04T17:00:00-05:00", "soccer"),
      ],
      tz,
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      date: "2028-01-04",
      start: "2028-01-04T13:30:00.000Z",
      end: "2028-01-04T20:00:00.000Z",
    });
    expect(blocks[0].classes.map((c) => c.id)).toEqual(["p1", "p2", "p3"]);
  });

  it("uses the home time zone's date, not UTC's", () => {
    // 19:00 and 20:00 in Toronto are the next day in UTC.
    const blocks = schoolBlocks(
      [
        cls("a", "2028-01-04T19:00:00-05:00", "2028-01-04T19:50:00-05:00"),
        cls("b", "2028-01-04T20:00:00-05:00", "2028-01-04T20:50:00-05:00"),
      ],
      tz,
    );
    expect(blocks.map((b) => b.date)).toEqual(["2028-01-04"]);
  });

  it("leaves single classes and all-day school items alone", () => {
    expect(
      schoolBlocks(
        [
          cls("only", "2028-01-04T08:30:00-05:00", "2028-01-04T15:00:00-05:00"),
          cls("x", "2028-01-05T08:30:00-05:00", "2028-01-05T09:00:00-05:00"),
          cls("allday", "2028-01-05T00:00:00Z", "2028-01-06T00:00:00Z", "school_class", true),
        ],
        tz,
      ),
    ).toEqual([]);
  });
});
