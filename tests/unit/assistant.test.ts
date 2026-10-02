import { describe, expect, it } from "vitest";
import {
  allowCall,
  answerLength,
  barkLine,
  capState,
  checkGrounding,
  compact,
  fitResult,
  languageOf,
  LIMITS,
  noCalls,
} from "@/domain/assistant";
import { fakeAssistant } from "@/server/assistant/default-model";
import { declarations, SYSTEM_PROMPT } from "@/server/assistant/prompt";
import { HUB_TOOLS } from "@/server/assistant/tools";
import { stamp } from "@/server/assistant/tools/types";
import { costUsd } from "@/server/llm/pricing";

// intent 0007: Cookie's pure rules.

describe("grounding (CHR-3)", () => {
  it("accepts a source whose tool ran", () => {
    expect(checkGrounding(["hub"], ["hub"], false)).toEqual({ ok: true });
    expect(checkGrounding(["hub", "self"], ["hub"], false)).toEqual({ ok: true });
  });

  it("refuses a source whose tool didn't run", () => {
    expect(checkGrounding(["hub"], [], false).ok).toBe(false);
    expect(checkGrounding(["web"], ["hub"], true).ok).toBe(false);
    expect(checkGrounding(["memory", "hub"], ["hub"], true).ok).toBe(false);
  });

  it("needs earlier turns for `conversation`", () => {
    expect(checkGrounding(["conversation"], [], false).ok).toBe(false);
    expect(checkGrounding(["conversation"], [], true).ok).toBe(true);
  });

  it("lets `self` stand alone, and refuses no source at all", () => {
    expect(checkGrounding(["self"], [], false).ok).toBe(true);
    expect(checkGrounding([], ["hub"], true).ok).toBe(false);
  });
});

describe("limits (LIM-1, LIM-5)", () => {
  it("stops at five tool calls", () => {
    const counts = noCalls();
    for (let i = 0; i < LIMITS.toolCalls; i++) expect(allowCall(counts, "calendar")).toBe(true);
    expect(allowCall(counts, "calendar")).toBe(false);
  });

  it("allows one web search and one page fetch", () => {
    const counts = noCalls();
    expect(allowCall(counts, "web_search")).toBe(true);
    expect(allowCall(counts, "web_search")).toBe(false);
    expect(allowCall(counts, "web_fetch")).toBe(true);
    expect(allowCall(counts, "web_fetch")).toBe(false);
    expect(counts.total).toBe(2);
  });

  it("turns speech off at 80% of the cap and stops at the cap", () => {
    expect(capState(7.99, 10)).toBe("ok");
    expect(capState(8, 10)).toBe("speech_off");
    expect(capState(10, 10)).toBe("over");
    expect(capState(0, 0)).toBe("over");
  });
});

describe("tool results (TOOL-15)", () => {
  it("drops nulls, empty strings and empty lists", () => {
    expect(
      compact({ a: 1, b: null, c: "", d: [], e: { f: null }, g: false, h: [{ i: null, j: 2 }] }),
    ).toEqual({
      a: 1,
      e: {},
      g: false,
      h: [{ j: 2 }],
    });
  });

  it("trims the longest list until the result fits, and says there was more", () => {
    const events = Array.from({ length: 200 }, (_, i) => ({ title: `Practice number ${i}`, place: "Pool" }));
    const text = fitResult({ count: 200, events }, 1000);
    expect(text.length).toBeLessThanOrEqual(1000);
    const parsed = JSON.parse(text) as { count: number; more: boolean; events: unknown[] };
    expect(parsed.more).toBe(true);
    expect(parsed.count).toBe(200);
    expect(parsed.events.length).toBeGreaterThan(5);
    expect(parsed.events.length).toBeLessThan(200);
  });

  it("leaves a small result alone", () => {
    expect(fitResult({ events: [{ title: "Swim" }] })).toBe('{"events":[{"title":"Swim"}]}');
  });

  it("cuts a result with nothing to trim", () => {
    const text = fitResult({ note: "x".repeat(5000) }, 500);
    expect(text.length).toBeLessThanOrEqual(500);
    expect(JSON.parse(text)).toMatchObject({ more: true });
  });
});

describe("language and length (VOX-4, CHR-1)", () => {
  it("tells English, Mandarin and mixed apart", () => {
    expect(languageOf("When is swim practice tomorrow?")).toBe("en");
    expect(languageOf("明天几点游泳？")).toBe("zh");
    // One name inside a Chinese sentence is still Chinese.
    expect(languageOf("Jayden 明天几点游泳？")).toBe("zh");
    expect(languageOf("Jayden 明天几点有 swim practice？")).toBe("mixed");
    expect(languageOf("tomorrow 的 swim practice is at what time 呢")).toBe("mixed");
  });

  it("barks in the question's language", () => {
    expect(barkLine("en")).toMatch(/^Woof!/);
    expect(barkLine("zh")).toMatch(/^汪！/);
    expect(barkLine("mixed")).toMatch(/^汪！/);
  });

  it("counts Chinese characters and English words on one scale", () => {
    expect(answerLength("Swim practice is at 5:30 pm tomorrow.")).toBe(7);
    expect(answerLength("明天下午五点半有游泳训练。")).toBe(8);
  });
});

describe("the prompt (TOOL-15, TOOL-17)", () => {
  const tools = declarations(HUB_TOOLS);

  it("stays under the size budget with every tool definition", () => {
    const size = SYSTEM_PROMPT.length + JSON.stringify(tools).length;
    expect(size).toBeLessThanOrEqual(LIMITS.promptChars);
  });

  it("lists the hub tools first, then answer and bark", () => {
    expect(tools.map((t) => t.name)).toEqual([
      "today",
      "calendar",
      "tennis",
      "swimming",
      "school",
      "videos",
      "costs",
      "answer",
      "bark",
    ]);
  });

  it("gives each tool a plain JSON schema, with optional inputs optional", () => {
    const calendar = tools.find((t) => t.name === "calendar")!.parameters as {
      type: string;
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(calendar.type).toBe("object");
    expect(calendar.required).toEqual(["from", "to"]);
    expect(Object.keys(calendar.properties)).toEqual(["from", "to", "person", "category", "text"]);
    expect(JSON.stringify(tools)).not.toMatch(/\$schema|additionalProperties|"pattern"/);
  });

  it("writes times in the home time zone", () => {
    expect(stamp("2026-10-04T00:30:00Z", "America/Toronto")).toBe("2026-10-03 Sat 20:30");
  });
});

describe("the stand-in model (ASSISTANT_LLM=fake)", () => {
  it("looks at today, then answers from what came back", async () => {
    const model = fakeAssistant();
    const first = await model.round({
      system: "",
      tools: [],
      contents: [{ role: "user", parts: [{ text: "[Now: …]\nWhat's on today?" }] }],
    });
    expect(first.calls).toEqual([{ name: "today", args: {} }]);
    const second = await model.round({
      system: "",
      tools: [],
      contents: [
        { role: "user", parts: [{ text: "[Now: …]\nWhat's on today?" }] },
        first.content,
        {
          role: "user",
          parts: [
            { functionResponse: { name: "today", response: { result: { events: [{ title: "Swim" }] } } } },
          ],
        },
      ],
    });
    expect(second.calls[0]).toMatchObject({
      name: "answer",
      args: { text: "Today: Swim.", sources: ["hub"] },
    });
  });

  it("barks at anything else", async () => {
    const { calls } = await fakeAssistant().round({
      system: "",
      tools: [],
      contents: [{ role: "user", parts: [{ text: "[Now: …]\nWhat is his shoe size?" }] }],
    });
    expect(calls[0].name).toBe("bark");
  });
});

describe("the Flash price (LIM-6)", () => {
  it("doubles when the introductory price ends", () => {
    const usage = { input: 1_000_000, output: 1_000_000 };
    expect(costUsd("gemini-3.8-flash", usage, new Date("2026-12-31T12:00:00Z"))).toBe(4.5);
    expect(costUsd("gemini-3.8-flash", usage, new Date("2027-01-01T12:00:00Z"))).toBe(9);
  });
});
