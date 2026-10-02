import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  allowCall,
  answerLength,
  asksToForget,
  asksToRemember,
  barkLine,
  capState,
  checkGrounding,
  clipProblem,
  fetchUrlProblem,
  isPublicAddress,
  linksIn,
  webQueryProblem,
  compact,
  fitResult,
  languageOf,
  LIMITS,
  looksSecret,
  mp4Seconds,
  noCalls,
  spokenText,
  VOICE_LIMITS,
} from "@/domain/assistant";
import { fakeAssistant } from "@/server/assistant/default-model";
import { declarations, SYSTEM_PROMPT, systemPrompt } from "@/server/assistant/prompt";
import { googleSpeech, speechCostUsd, voiceFor } from "@/server/assistant/speech";
import { errorKind } from "@/server/assistant/quiet";
import { ALL_TOOLS } from "@/server/assistant/tools";
import { stamp } from "@/server/assistant/tools/types";
import { FetchRefused, guardedFetch, publicLookup, type Transport } from "@/server/assistant/web";
import { geminiAssistant } from "@/server/assistant/model";
import { geminiTranscriber } from "@/server/assistant/transcribe";
import type { Generate } from "@/server/llm/gemini";
import { costUsd } from "@/server/llm/pricing";
import { LlmError } from "@/server/llm/types";

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

describe("memory rules (MEM-1, MEM-5, MEM-6)", () => {
  it("knows when a question asks her to remember", () => {
    for (const q of [
      "Remember that his shoe size is 4",
      "Cookie, please remember: recycling goes out on Tuesday",
      "Don't forget that the coach is called Sam",
      "记住奶奶的生日是三月五号",
      "帮我记一下 Jayden 的 locker number 是 12",
    ])
      expect(asksToRemember(q), q).toBe(true);
    for (const q of [
      "What's on today?",
      "他的鞋码是多少？",
      "Do you remember the plan?".replace("remember", "know"),
    ])
      expect(asksToRemember(q), q).toBe(false);
  });

  it("knows when a question asks her to forget", () => {
    for (const q of [
      "Forget his shoe size",
      "Delete what you know about the key",
      "忘掉奶奶的生日",
      "把那条删掉",
    ])
      expect(asksToForget(q), q).toBe(true);
    for (const q of ["What's on today?", "When is practice?"]) expect(asksToForget(q), q).toBe(false);
  });

  it("spots passwords, codes and card numbers", () => {
    for (const t of [
      "The wifi password is tulip-7781",
      "garage passcode 4410",
      "家里的密码是 8891",
      "card 4111 1111 1111 1111",
      "the verification code was 993311",
    ])
      expect(looksSecret(t), t).toBe(true);
    for (const t of ["His shoe size is 4", "Locker 12, second floor", "Grandma's number is 555-0142"])
      expect(looksSecret(t), t).toBe(false);
  });
});

describe("web rules (CSEC-3, CSEC-4)", () => {
  it("refuses a search that names someone or something private", () => {
    const words = ["Robin", "Sam", "Maple School", "小明"];
    expect(webQueryProblem("pool opening hours Saturday", words)).toBeNull();
    expect(webQueryProblem("the same day delivery", words)).toBeNull(); // "Sam" isn't in "same"
    expect(webQueryProblem("Robin tennis ranking", words)).toMatch(/private/);
    expect(webQueryProblem("maple school term dates", words)).toMatch(/private/);
    expect(webQueryProblem("小明的比赛", words)).toMatch(/private/);
    expect(webQueryProblem("x".repeat(121), words)).toMatch(/under 120/);
    expect(webQueryProblem("  ", words)).toMatch(/empty/);
  });

  it("finds only the https links written in a question", () => {
    expect(linksIn("What does https://pool.example/hours?day=sat say, and http://old.example?")).toEqual([
      "https://pool.example/hours?day=sat",
    ]);
    expect(linksIn("看看 https://pool.example/时间。")).toEqual(["https://pool.example/时间"]);
    expect(linksIn("no links here")).toEqual([]);
  });

  it("allows public addresses only", () => {
    for (const ip of ["8.8.8.8", "93.184.216.34", "2606:4700:4700::1111"])
      expect(isPublicAddress(ip), ip).toBe(true);
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254", // the cloud metadata server
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "::1",
      "::",
      "fd00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "::ffff:169.254.169.254",
      // The same addresses written without dots, and other IPv6 forms that carry an IPv4 one.
      "::ffff:7f00:1",
      "::ffff:a9fe:a9fe",
      "::7f00:1",
      "64:ff9b::a9fe:a9fe",
      "2002:a9fe:a9fe::1",
      "2001:0:4136:e378:8000:63bf:3fff:fdd2",
      "not-an-address",
    ])
      expect(isPublicAddress(ip), ip).toBe(false);
  });

  it("allows https links to named public sites only", () => {
    expect(fetchUrlProblem("https://pool.example/hours")).toBeNull();
    for (const url of [
      "http://pool.example/hours",
      "https://pool.example:8443/",
      "https://user:pw@pool.example/",
      "https://127.0.0.1/",
      "https://[::1]/",
      "https://localhost/",
      "https://metadata.google.internal/computeMetadata/v1/",
      "https://printer.local/",
      "ftp://pool.example/",
      "not a link",
    ])
      expect(fetchUrlProblem(url), url).not.toBeNull();
  });
});

describe("the page fetcher (CSEC-4)", () => {
  const html = (body: string) => ({
    status: 200,
    location: null,
    contentType: "text/html; charset=utf-8",
    body: Buffer.from(body),
  });
  const redirect = (location: string) => ({ status: 302, location, contentType: "", body: Buffer.alloc(0) });
  const serving = (pages: Record<string, Awaited<ReturnType<Transport>>>) => {
    const asked: string[] = [];
    const transport: Transport = async (url) => {
      asked.push(url.toString());
      const page = pages[url.toString()];
      if (!page) throw new Error("unreachable");
      return page;
    };
    return { asked, fetch: guardedFetch(transport) };
  };

  it("reads a page as text and never runs its scripts", async () => {
    const { fetch } = serving({
      "https://pool.example/hours": html(
        "<html><head><title>Pool hours</title><script>steal()</script><style>p{}</style></head>" +
          "<body><nav>Menu</nav><main><h1>Hours</h1><p>Open 9 am to 5 pm.</p></main></body></html>",
      ),
    });
    const page = await fetch("https://pool.example/hours");
    expect(page).toMatchObject({ title: "Pool hours", url: "https://pool.example/hours" });
    expect(page.text).toContain("Open 9 am to 5 pm.");
    expect(page.text).not.toMatch(/steal|p\{\}/);
  });

  it("cuts a long page at 8,000 characters", async () => {
    const { fetch } = serving({ "https://pool.example/long": html(`<p>${"word ".repeat(5000)}</p>`) });
    expect((await fetch("https://pool.example/long")).text.length).toBeLessThanOrEqual(8000);
  });

  it("follows a redirect to another public page, checking it again", async () => {
    const { fetch, asked } = serving({
      "https://pool.example/old": redirect("/new"),
      "https://pool.example/new": html("<p>Moved here.</p>"),
    });
    expect((await fetch("https://pool.example/old")).text).toBe("Moved here.");
    expect(asked).toEqual(["https://pool.example/old", "https://pool.example/new"]);
  });

  it("refuses a redirect to a private address, plain http or the metadata server", async () => {
    for (const target of [
      "https://169.254.169.254/latest/meta-data/",
      "http://pool.example/hours",
      "https://metadata.google.internal/",
      "https://10.0.0.5/admin",
    ]) {
      const { fetch, asked } = serving({ "https://pool.example/go": redirect(target) });
      await expect(fetch("https://pool.example/go"), target).rejects.toBeInstanceOf(FetchRefused);
      // The second address was never asked.
      expect(asked).toEqual(["https://pool.example/go"]);
    }
  });

  it("gives up after three redirects", async () => {
    const { fetch } = serving({
      "https://a.example/1": redirect("https://a.example/2"),
      "https://a.example/2": redirect("https://a.example/3"),
      "https://a.example/3": redirect("https://a.example/4"),
      "https://a.example/4": redirect("https://a.example/5"),
      "https://a.example/5": html("<p>too far</p>"),
    });
    await expect(fetch("https://a.example/1")).rejects.toThrow(/too many/);
  });

  it("refuses anything that isn't a page of text, and pages that fail", async () => {
    const { fetch } = serving({
      "https://pool.example/photo": { ...html(""), contentType: "image/png" },
      "https://pool.example/gone": { ...html(""), status: 404 },
    });
    await expect(fetch("https://pool.example/photo")).rejects.toThrow(/isn't a web page/);
    await expect(fetch("https://pool.example/gone")).rejects.toThrow(/404/);
    await expect(fetch("https://pool.example/unknown")).rejects.toThrow(/couldn't be reached/);
  });

  it("refuses a host name that resolves to this machine", async () => {
    const err = await new Promise<Error | null>((resolve) =>
      publicLookup("localhost", {}, (e) => resolve(e as Error | null)),
    );
    expect(err).toBeInstanceOf(FetchRefused);
  });
});

describe("the prompt (TOOL-15, TOOL-17)", () => {
  const tools = declarations(ALL_TOOLS);

  it("stays under the size budget with every tool definition", () => {
    const size = systemPrompt(true).length + JSON.stringify(tools).length;
    expect(size).toBeLessThanOrEqual(LIMITS.promptChars);
    // With the web off, its tools and its paragraph aren't sent at all.
    expect(systemPrompt(false)).toBe(SYSTEM_PROMPT);
    expect(SYSTEM_PROMPT).not.toContain("web_search");
  });

  it("lists the hub tools first, then memory, the web, then answer and bark", () => {
    expect(tools.map((t) => t.name)).toEqual([
      "today",
      "calendar",
      "tennis",
      "swimming",
      "school",
      "videos",
      "costs",
      "memory_search",
      "memory_save",
      "memory_forget",
      "web_search",
      "web_fetch",
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

  it("looks in memory for anything else, and barks when nothing is there", async () => {
    const model = fakeAssistant();
    const question = { role: "user", parts: [{ text: "[Now: …]\nWhat is his shoe size?" }] };
    const first = await model.round({ system: "", tools: [], contents: [question] });
    expect(first.calls).toEqual([
      { name: "memory_search", args: { keywords: ["what", "his", "shoe", "size"] } },
    ]);
    const response = (result: unknown) => ({
      role: "user",
      parts: [{ functionResponse: { name: "memory_search", response: { result } } }],
    });
    const nothing = await model.round({
      system: "",
      tools: [],
      contents: [question, first.content, response({ error: "nothing in memory matches" })],
    });
    expect(nothing.calls[0].name).toBe("bark");
    const found = await model.round({
      system: "",
      tools: [],
      contents: [question, first.content, response({ facts: [{ id: "m1", fact: "His shoe size is 4" }] })],
    });
    expect(found.calls[0]).toMatchObject({
      name: "answer",
      args: { text: "His shoe size is 4.", sources: ["memory"] },
    });
  });

  it("saves what it is told to remember", async () => {
    const { calls } = await fakeAssistant().round({
      system: "",
      tools: [],
      contents: [
        { role: "user", parts: [{ text: "[Now: …]\nRemember that the spare key is under the blue pot." }] },
      ],
    });
    expect(calls[0]).toMatchObject({
      name: "memory_save",
      args: { text: "the spare key is under the blue pot" },
    });
  });
});

describe("the Flash price (LIM-6)", () => {
  it("doubles when the introductory price ends", () => {
    const usage = { input: 1_000_000, output: 1_000_000 };
    expect(costUsd("gemini-3.8-flash", usage, new Date("2026-12-31T12:00:00Z"))).toBe(4.5);
    expect(costUsd("gemini-3.8-flash", usage, new Date("2027-01-01T12:00:00Z"))).toBe(9);
  });
});

describe("voice (VOX-5, LIM-3)", () => {
  // Synthetic speech, about a second of AAC in an MPEG-4 file.
  const clip = readFileSync("tests/fixtures/assistant/question.m4a");

  it("reads how long a clip runs from its header", () => {
    expect(mp4Seconds(clip)).toBeCloseTo(0.96, 2);
    expect(mp4Seconds(Buffer.from("not a recording at all"))).toBeNull();
    expect(mp4Seconds(clip.subarray(0, 40))).toBeNull();
    expect(mp4Seconds(new Uint8Array(0))).toBeNull();
  });

  it("accepts the iPhone's recordings and refuses the rest", () => {
    expect(clipProblem("audio/mp4", clip)).toBeNull();
    expect(clipProblem("audio/x-m4a", clip)).toBeNull();
    expect(clipProblem("audio/mpeg", clip)).toMatch(/can listen to/);
    expect(clipProblem("audio/mp4", Buffer.alloc(VOICE_LIMITS.clipBytes + 1))).toMatch(/too big/);
    expect(clipProblem("audio/mp4", Buffer.from("x".repeat(64)))).toMatch(/can listen to/);
  });

  it("reads an answer without its links, and says when it is from the web", () => {
    expect(spokenText("Swim practice at 5:30 pm.", "en", false)).toBe("Swim practice at 5:30 pm.");
    expect(spokenText("Opens at 9. https://pool.example/hours", "en", true)).toBe(
      "From the web: Opens at 9.",
    );
    expect(spokenText("九点开门。", "zh", true)).toBe("网上说：九点开门。");
    expect(spokenText("**Bold** and `code`", "en", false)).toBe("Bold and code");
    expect(spokenText("  ", "en", true)).toBe("");
    expect(spokenText("a".repeat(900), "en", false)).toHaveLength(VOICE_LIMITS.speechChars);
  });

  it("picks the speaker's Mandarin voice for Chinese and mixed answers", () => {
    expect(voiceFor("Leda", "en")).toEqual({ name: "en-US-Chirp3-HD-Leda", languageCode: "en-US" });
    expect(voiceFor("Leda", "zh")).toEqual({ name: "cmn-CN-Chirp3-HD-Leda", languageCode: "cmn-CN" });
    expect(voiceFor("Leda", "mixed").languageCode).toBe("cmn-CN");
    expect(voiceFor("Wavenet-A", null).name).toBe("en-US-Wavenet-A");
    expect(speechCostUsd("cmn-CN-Chirp3-HD-Leda", 1000)).toBe(0.03);
  });

  it("asks Text-to-Speech for an MP3 and turns a failure into an error the route can catch", async () => {
    const sent: unknown[] = [];
    const speak = googleSpeech(async (body) => {
      sent.push(body);
      return { status: 200, data: { audioContent: Buffer.from("mp3").toString("base64") } };
    });
    const audio = await speak({ text: "汪！", language: "zh", voice: "Kore" });
    expect(audio).toMatchObject({ mimeType: "audio/mpeg", voice: "cmn-CN-Chirp3-HD-Kore", chars: 2 });
    expect(audio.data.toString()).toBe("mp3");
    expect(sent).toEqual([
      {
        input: { text: "汪！" },
        voice: { name: "cmn-CN-Chirp3-HD-Kore", languageCode: "cmn-CN" },
        audioConfig: { audioEncoding: "MP3" },
      },
    ]);
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      googleSpeech(async () => ({ status: 403, data: { error: {} } }))({ text: "Hi", language: "en" }),
    ).rejects.toBeInstanceOf(LlmError);
    quiet.mockRestore();
  });

  it("asks for the words only, with the names to spell", async () => {
    const calls: Parameters<Generate>[0][] = [];
    const generate: Generate = async (params) => {
      calls.push(params);
      return {
        functionCalls: [{ name: "heard", args: { text: " Jayden 明天几点有 swim practice？ " } }],
        usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 12 },
        modelVersion: "gemini-3.8-flash-001",
      } as unknown as Awaited<ReturnType<Generate>>;
    };
    const heard = await geminiTranscriber(generate, "gemini-3.8-flash")(
      { data: clip, mimeType: "audio/mp4" },
      ["Jayden", "Aquatic Centre"],
    );
    expect(heard).toMatchObject({
      text: "Jayden 明天几点有 swim practice？",
      inputTokens: 120,
      outputTokens: 12,
    });
    const parts = (
      calls[0].contents as { parts: { text?: string; inlineData?: { mimeType: string } }[] }[]
    )[0].parts;
    expect(parts[0].text).toContain("Names you may hear: Jayden, Aquatic Centre.");
    expect(parts[1].inlineData?.mimeType).toBe("audio/mp4");
    expect(calls[0].config?.systemInstruction).toBeUndefined();
    // No call, or no text: nothing was heard.
    const none = await geminiTranscriber(
      async () => ({ usageMetadata: {} }) as unknown as Awaited<ReturnType<Generate>>,
      "gemini-3.8-flash",
    )({ data: clip, mimeType: "audio/mp4" }, []);
    expect(none.text).toBe("");
  });
});

describe("what goes wrong, without the words (CSEC-7)", () => {
  it("logs an error's kind, never its message", () => {
    // A database error's message quotes the failed query's values.
    const err = Object.assign(
      new Error('Failed query: insert into "assistant_turns" … params: the alarm code is 4321'),
      {
        name: "DrizzleQueryError",
        cause: Object.assign(new Error("value too long"), { name: "PostgresError", code: "22001" }),
      },
    );
    expect(errorKind(err)).toBe("DrizzleQueryError PostgresError 22001");
    expect(errorKind(err)).not.toContain("4321");
    expect(errorKind("the alarm code is 4321")).toBe("error");
    expect(errorKind(Object.assign(new Error("x"), { name: "the alarm code is 4321" }))).toBe("error");
    expect(errorKind(null)).toBe("error");
  });

  it("says she can't answer when Vertex AI isn't set up, and doesn't crash", async () => {
    const before = process.env.VERTEX_PROJECT;
    delete process.env.VERTEX_PROJECT;
    try {
      const model = geminiAssistant();
      await expect(model.round({ system: "s", tools: [], contents: [] })).rejects.toBeInstanceOf(LlmError);
      await expect(
        geminiTranscriber()({ data: Buffer.from("x"), mimeType: "audio/mp4" }, []),
      ).rejects.toBeInstanceOf(LlmError);
    } finally {
      if (before !== undefined) process.env.VERTEX_PROJECT = before;
    }
  });
});

describe("her last round (LIM-1)", () => {
  it("lets the model call only the tools that end the question", async () => {
    const calls: Parameters<Generate>[0][] = [];
    const generate: Generate = async (params) => {
      calls.push(params);
      return {
        candidates: [{ content: { role: "model", parts: [] } }],
        functionCalls: [{ name: "bark", args: { heard: "q", language: "en", text: "Woof!" } }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
      } as unknown as Awaited<ReturnType<Generate>>;
    };
    const model = geminiAssistant(generate, "gemini-3.8-flash");
    const request = { system: "s", tools: declarations(ALL_TOOLS), contents: [] };
    await model.round(request);
    await model.round({ ...request, only: ["answer", "bark"] });
    const config = (i: number) => calls[i].config?.toolConfig?.functionCallingConfig;
    expect(config(0)?.allowedFunctionNames).toBeUndefined();
    expect(config(1)?.allowedFunctionNames).toEqual(["answer", "bark"]);
    // Every tool is still declared, so the prompt is the same on every round.
    expect(calls[1].config?.tools).toEqual(calls[0].config?.tools);
  });
});
