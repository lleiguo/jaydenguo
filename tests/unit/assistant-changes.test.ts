import { describe, expect, it } from "vitest";
import {
  addingLine,
  appliedLine,
  asksToAdd,
  asksToAddAfter,
  asksToApply,
  claimsAdding,
  notAddedLine,
  offersToAdd,
  saysAllDay,
  leftBecause,
  unsureFields,
  dayInWords,
  dayProblem,
  eventTimes,
  titleWithNames,
  whoIsIt,
} from "@/domain/assistant-changes";

// Intent 0008: the rules for what Cookie may add.

const people = [
  { id: "p1", name: "Jayden" },
  { id: "p2", name: "Lei" },
  { id: "p3", name: "Sam" },
];

describe("the add gate (ADD-2)", () => {
  it("opens only when the question asks to add something", () => {
    for (const q of [
      "Add a dentist appointment for Sam on Thursday",
      "Put swim practice on the calendar for Friday",
      "Can you schedule a haircut for Lei tomorrow at 3?",
      "Book the dentist for Sam",
      "加一个牙医预约，Sam，周四下午六点",
      "帮我添加 Jayden 周五的 piano lesson",
      "安排一下 Sam 下周一的牙医",
    ])
      expect(asksToAdd(q), q).toBe(true);
    for (const q of [
      "What's on today?",
      "When is the dentist?",
      "Jayden 明天参加什么活动？",
      "Is the address 12 Elm Street?",
      "他周四有牙医吗？",
    ])
      expect(asksToAdd(q), q).toBe(false);
  });

  it("opens for making something an event without the word add", () => {
    for (const q of [
      "Turn this shopping list into a calendar event",
      "make it an event on Saturday",
      "把购物清单放进日历",
      "记在日历上",
    ])
      expect(asksToAdd(q), q).toBe(true);
  });

  it("opens for a yes to her own offer to add, and only then", () => {
    const offer = "Milk, eggs and bread from Costco on Saturday. Add it to the calendar?";
    const zhOffer = "周六去 Costco 买牛奶和鸡蛋。要加到日历吗？";
    for (const yes of ["yes", "Yes please!", "ok", "Sure.", "go ahead", "好的", "可以", "嗯", "好，加吧"])
      expect(asksToAddAfter(yes, yes.match(/[a-z]/i) ? offer : zhOffer), yes).toBe(true);
    // No offer just before, a no, or more than a yes.
    expect(asksToAddAfter("yes", "Costco is open until 8 pm.")).toBe(false);
    expect(asksToAddAfter("yes", null)).toBe(false);
    expect(asksToAddAfter("no", offer)).toBe(false);
    expect(asksToAddAfter("不要", zhOffer)).toBe(false);
    expect(asksToAddAfter("yes, and what time does Costco close?", offer)).toBe(false);
    // An offer in the middle of an answer isn't her last word.
    expect(offersToAdd("Add it to the calendar? It's on Saturday.")).toBe(false);
  });
});

describe("saying it was added (ADD-9)", () => {
  it("spots an answer that says an event is being added", () => {
    for (const a of [
      "Adding: Costco shopping, Saturday Oct 24, all day, for everyone.",
      "Sure! I've added it to the calendar.",
      "正在添加：Costco 购物，周六。",
      "已经加到日历里了。",
    ])
      expect(claimsAdding(a), a).toBe(true);
    for (const a of [
      "Add it to the calendar?",
      "Whose is it?",
      "要加到日历吗？",
      "What time should I add it at?",
    ])
      expect(claimsAdding(a), a).toBe(false);
  });

  it("says nothing was added, in her language", () => {
    expect(notAddedLine("en")).toMatch(/^Nothing was added/);
    expect(notAddedLine("zh")).toMatch(/^还没有加到日历/);
  });
});

describe("the day (ADD-4)", () => {
  const today = "2026-10-02";

  it("accepts a day whose weekday matches what was said, or when none was said", () => {
    expect(dayProblem("2026-12-03", "Thursday", today)).toBeNull();
    expect(dayProblem("2026-12-03", "thu", today)).toBeNull();
    expect(dayProblem("2026-12-03", "周四", today)).toBeNull();
    expect(dayProblem("2026-12-03", undefined, today)).toBeNull();
    expect(dayProblem(today, null, today)).toBeNull();
  });

  it("asks when the weekday and the date disagree: the owner's own example", () => {
    // "Monday 6 pm, December 3rd": in 2026 that is a Thursday.
    const said = dayProblem("2026-12-03", "Monday", today);
    expect(said).toContain("Thursday, December 3, 2026 is a Thursday, not a Monday");
    expect(said).toContain("add nothing");
    expect(dayProblem("2026-12-03", "星期一", today)).toContain("not a Monday");
  });

  it("asks about a day that has passed, is far ahead, or isn't a day", () => {
    expect(dayProblem("2026-10-01", null, today)).toContain("has passed");
    expect(dayProblem("2028-06-01", null, today)).toContain("18 months");
    expect(dayProblem("2026-02-30", null, today)).toContain("isn't a date");
    expect(dayProblem("next week", null, today)).toContain("isn't a date");
    expect(dayProblem("2026-12-03", "Someday", today)).toContain("isn't a weekday");
  });

  it("says a day in words", () => {
    expect(dayInWords("2026-12-03")).toBe("Thursday, December 3, 2026");
  });
});

describe("the time (ADD-5)", () => {
  const tz = "America/Toronto";

  it("makes a timed event an hour long unless an end was said", () => {
    const hour = eventTimes({ date: "2026-12-03", start: "18:00" }, tz);
    expect(hour).toEqual({
      start: new Date("2026-12-03T23:00:00Z"),
      end: new Date("2026-12-04T00:00:00Z"),
      allDay: false,
    });
    const longer = eventTimes({ date: "2026-12-03", start: "9:30", end: "11:00" }, tz);
    expect(longer).toMatchObject({
      start: new Date("2026-12-03T14:30:00Z"),
      end: new Date("2026-12-03T16:00:00Z"),
    });
  });

  it("makes an all-day event the way the calendar stores one", () => {
    expect(eventTimes({ date: "2026-12-03", allDay: true }, tz)).toEqual({
      start: new Date("2026-12-03T00:00:00Z"),
      end: new Date("2026-12-04T00:00:00Z"),
      allDay: true,
    });
  });

  it("asks when no time was given, and refuses times that aren't", () => {
    expect(eventTimes({ date: "2026-12-03" }, tz)).toEqual({
      problem: "no time was given; ask what time, or whether it is all day",
    });
    expect(eventTimes({ date: "2026-12-03", start: "6pm" }, tz)).toHaveProperty("problem");
    expect(eventTimes({ date: "2026-12-03", start: "18:00", end: "17:00" }, tz)).toHaveProperty("problem");
  });
});

describe("whose it is (ADD-3, GCW-6)", () => {
  it("takes names from People only, and asks when there are none", () => {
    expect(whoIsIt(["sam"], people)).toEqual({ everyone: false, ids: ["p3"], names: ["Sam"] });
    expect(whoIsIt(["Jayden", "Sam", "jayden"], people)).toMatchObject({ ids: ["p1", "p3"] });
    expect(whoIsIt([], people)).toHaveProperty("problem");
    // Intent 0024, OWN-4: nobody named is the asker's, when they're one of People.
    expect(whoIsIt([], people, "p2")).toEqual({ everyone: false, ids: ["p2"], names: [people[1].name] });
    expect(whoIsIt([], people, "someone-else")).toHaveProperty("problem");
    expect(whoIsIt(["  "], people)).toHaveProperty("problem");
    const stranger = whoIsIt(["Alex"], people);
    expect(stranger).toHaveProperty("problem");
    expect((stranger as { problem: string }).problem).toContain("Jayden, Lei, Sam");
    // Part of a name isn't the name.
    expect(whoIsIt(["Sa"], people)).toHaveProperty("problem");
  });

  it("understands everyone", () => {
    for (const word of ["everyone", "family", "大家", "全家"])
      expect(whoIsIt([word], people)).toMatchObject({ everyone: true, ids: ["p1", "p2", "p3"] });
  });

  it("puts the names in the title the family calendar will hold", () => {
    const sam = { everyone: false, ids: ["p3"], names: ["Sam"] };
    expect(titleWithNames("dentist appointment", sam)).toBe("Sam dentist appointment");
    // Already named: not twice. "Samantha" doesn't name Sam.
    expect(titleWithNames("Sam's dentist", sam)).toBe("Sam's dentist");
    expect(titleWithNames("Samantha's party", sam)).toBe("Sam Samantha's party");
    expect(
      titleWithNames("  piano   lesson ", { everyone: false, ids: ["p1", "p3"], names: ["Jayden", "Sam"] }),
    ).toBe("Jayden & Sam piano lesson");
    expect(
      titleWithNames("family dinner", { everyone: true, ids: [], names: ["Jayden", "Lei", "Sam"] }),
    ).toBe("family dinner");
    expect(titleWithNames("x".repeat(300), sam).length).toBeLessThanOrEqual(124);
  });
});

describe("what the server says when her own ending can't stand (ADD-7)", () => {
  const event = { title: "Sam dentist", date: "2026-12-03", start: "18:00", names: ["Sam"], everyone: false };

  it("reads the event back with its weekday and whose it is", () => {
    expect(addingLine("en", event)).toBe("Adding: Sam dentist, Thursday, December 3, 2026, 18:00, for Sam.");
    expect(addingLine("zh", event)).toBe("正在添加：Sam dentist，2026-12-03 18:00，Sam。");
    expect(addingLine("en", { ...event, start: null, everyone: true })).toContain("all day, for everyone");
  });
});

describe("all day (ADD-5)", () => {
  it("only when the parent says so", () => {
    for (const q of [
      "Add sports day for Jayden on Friday, all day",
      "Put the all-day trip in",
      "周五全天的活动",
    ])
      expect(saysAllDay(q), q).toBe(true);
    for (const q of ["Put Jayden's haircut on the calendar for tomorrow", "Add a day trip Friday"])
      expect(saysAllDay(q), q).toBe(false);
  });
});

describe("email suggestions (EMS-3, EMS-4)", () => {
  it("applies only when the question asks for it", () => {
    for (const q of [
      "Add the swim meet one",
      "Approve the practice suggestion",
      "Search today's email and update my calendar accordingly",
      "把今天邮件里的更新一下日历",
      "同意那个比赛改时间的建议",
    ])
      expect(asksToApply(q), q).toBe(true);
    for (const q of ["What came in by email?", "邮件里有什么新消息？", "Is Saturday's game still on?"])
      expect(asksToApply(q), q).toBe(false);
  });

  const sure = { overall: "high", title: "high", date: "high", time: "high", location: "high" } as const;

  it("leaves the unsure, the undated and the unmatched for the parent", () => {
    expect(
      leftBecause({ kind: "new", date: "2033-05-04", targetEventId: null, confidence: sure }),
    ).toBeNull();
    expect(
      leftBecause({
        kind: "new",
        date: "2033-05-04",
        targetEventId: null,
        confidence: { ...sure, time: "low", location: "low" },
      }),
    ).toBe("not sure of the time and location");
    // "overall" is a summary, not a field.
    expect(
      leftBecause({
        kind: "new",
        date: "2033-05-04",
        targetEventId: null,
        confidence: { ...sure, overall: "low" },
      }),
    ).toBeNull();
    expect(leftBecause({ kind: "new", date: null, targetEventId: null, confidence: sure })).toBe("no date");
    expect(leftBecause({ kind: "cancel", date: null, targetEventId: null, confidence: sure })).toMatch(
      /isn't on the calendar/,
    );
    expect(
      leftBecause({ kind: "change", date: "2033-05-04", targetEventId: "e1", confidence: sure }),
    ).toBeNull();
    expect(unsureFields({ ...sure, location: "low" })).toEqual(["location"]);
  });

  it("says what was applied in the question's language", () => {
    const applied = [
      { title: "Extra practice", kind: "added" as const },
      { title: "Game vs Green Giants", kind: "moved" as const },
    ];
    expect(appliedLine("en", applied)).toBe(
      "From the email suggestions: Extra practice added; Game vs Green Giants moved.",
    );
    expect(appliedLine("zh", applied)).toBe(
      "按邮件建议，已添加：Extra practice；已改时间：Game vs Green Giants。",
    );
  });
});
