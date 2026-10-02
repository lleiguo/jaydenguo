import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assistantTurns, credentials, emailMessages, sources, users } from "@db/schema";
import { fitResult, LIMITS } from "@/domain/assistant";
import { ask, type AskDeps } from "@/server/assistant/ask";
import { scriptedAssistant, type AssistantScript, type ModelCall } from "@/server/assistant/model";
import { getAssistantSettings, saveAssistantSettings } from "@/server/assistant/settings";
import { HUB_TOOLS, type ToolContext } from "@/server/assistant/tools";
import { clearHistory, listTurns, monthSpendUsd } from "@/server/assistant/turns";
import { createEvent } from "@/server/calendar/mutations";
import { loadCosts } from "@/server/costs";
import { createDb, createPool, type PoolHandle } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { LlmError } from "@/server/llm/types";
import { listPeople } from "@/server/people";
import { getHomeTimeZone } from "@/server/settings";

// intent 0007, plan K1: Cookie's question loop against a real database, with
// a scripted model. No words reach Vertex AI.

const actor = "owner@example.test";
// Far in the future so other tests' data doesn't interfere; 19:00 UTC is the
// same local date in every North American time zone.
const now = new Date("2033-03-09T19:00:00Z");

const answer = (text: string, sources: string[], heard = "q"): ModelCall => ({
  name: "answer",
  args: { heard, language: "en", text, sources },
});
const barkCall = (text = "Woof! I couldn't find that."): ModelCall => ({
  name: "bark",
  args: { heard: "q", language: "en", text },
});

describe("Cookie", () => {
  let handle: PoolHandle;
  let db: ReturnType<typeof createDb>;
  let userId: string;
  const lines: Record<string, unknown>[] = [];

  // Each question a second after the last, so turns have an order.
  let clock = 0;
  const deps = (script: AssistantScript): AskDeps & { model: ReturnType<typeof scriptedAssistant> } => ({
    model: scriptedAssistant(script),
    now: new Date(now.getTime() + ++clock * 1000),
    log: (fields) => lines.push(fields),
  });

  beforeAll(async () => {
    await runMigrations();
    handle = await createPool();
    db = createDb(handle.pool);
    await db.execute(
      sql`truncate conflicts, event_overrides, event_revisions, events, event_series, change_log, assistant_turns, assistant_memories restart identity cascade`,
    );
    await db.execute(sql`delete from settings where key = 'assistant'`);
    [{ id: userId }] = await db
      .insert(users)
      .values({ email: "cookie-test@example.test" })
      .onConflictDoUpdate({ target: users.email, set: { email: "cookie-test@example.test" } })
      .returning();
    await createEvent(db, actor, {
      title: "Swim practice",
      category: "swimming",
      attendance: "required",
      start: new Date("2033-03-09T22:30:00Z"),
      end: new Date("2033-03-10T00:00:00Z"),
      allDay: false,
      notes: null,
      locationName: "Aquatic Centre",
    });
    await createEvent(db, actor, {
      title: "Chess club",
      category: "other",
      attendance: "required",
      start: new Date("2033-03-11T23:00:00Z"),
      end: new Date("2033-03-12T00:00:00Z"),
      allDay: false,
      notes: null,
      locationName: null,
    });
  });

  beforeEach(async () => {
    lines.length = 0;
    await db.execute(sql`delete from rate_limits where key like 'assistant:%'`);
  });

  afterAll(async () => {
    await handle.close();
  });

  it("looks in the hub, then answers with where it came from", async () => {
    const d = deps((_, round) =>
      round === 1
        ? [{ name: "today", args: {} }]
        : [answer("Swim practice is at the Aquatic Centre.", ["hub"])],
    );
    const result = await ask(db, d, { userId, text: "What's on today?" });
    expect(result).toMatchObject({
      outcome: "answer",
      heard: "What's on today?",
      text: "Swim practice is at the Aquatic Centre.",
      sources: [{ kind: "hub", label: "Today" }],
    });
    // The second round saw the tool's result: today's event, not Friday's.
    const second = d.model.requests[1];
    const sent = JSON.stringify(second.contents.at(-1));
    expect(sent).toContain("Swim practice");
    expect(sent).toContain("Aquatic Centre");
    expect(sent).not.toContain("Chess club");
    // The question went in with the date and the people, and nothing else.
    const question = second.contents[0].parts![0].text!;
    expect(question).toMatch(/^\[Now: 2033-03-09 Wed \d\d:\d\d \(.+\)\. People: .+\.\]\nWhat's on today\?$/);

    const [row] = await db
      .select()
      .from(assistantTurns)
      .where(sql`id = ${result.turnId}`);
    expect(row).toMatchObject({
      outcome: "answer",
      mode: "text",
      inputTokens: 2000,
      outputTokens: 100,
      costUsd: 0.002,
      model: "assistant-scripted",
    });
    // Which tools ran is kept; what they returned is not (CSEC-7).
    expect(row.tools).toMatchObject([{ name: "today" }]);
    expect(JSON.stringify(row.tools)).not.toContain("Swim");
  });

  it("reads a range of days from the calendar, for one person or everyone", async () => {
    const d = deps((_, round) =>
      round === 1
        ? [{ name: "calendar", args: { from: "2033-03-10", to: "2033-03-12" } }]
        : [answer("Chess club is on Friday.", ["hub"])],
    );
    const result = await ask(db, d, { userId, text: "What's on later this week?" });
    expect(result.sources).toEqual([{ kind: "hub", label: "Calendar" }]);
    const sent = JSON.stringify(d.model.requests[1].contents.at(-1));
    expect(sent).toContain("Chess club");
    expect(sent).toContain('"count":1');
  });

  it("passes the model's bark through (CHR-2)", async () => {
    const result = await ask(
      db,
      deps(() => [barkCall("Woof! I don't know his shoe size.")]),
      { userId, text: "What's his shoe size?" },
    );
    expect(result).toMatchObject({ outcome: "bark", text: "Woof! I don't know his shoe size.", sources: [] });
  });

  it("turns an answer with no tool behind it into a bark (CHR-3)", async () => {
    const result = await ask(
      db,
      deps(() => [answer("Practice is at 5.", ["hub"])]),
      { userId, text: "When is practice?" },
    );
    expect(result).toMatchObject({ outcome: "bark", text: "Woof! I don't know that one." });
    expect(lines.at(-1)).toMatchObject({ outcome: "bark", why: "no hub tool ran" });
  });

  it("barks in Mandarin for a Mandarin question", async () => {
    const result = await ask(
      db,
      deps(() => [answer("下午五点。", ["hub"])]),
      { userId, text: "明天几点游泳？" },
    );
    expect(result).toMatchObject({ outcome: "bark", language: "zh", text: "汪！这个我不知道。" });
  });

  it("doesn't count a tool that found nothing as a source", async () => {
    const result = await ask(
      db,
      deps((_, round) =>
        round === 1
          ? [{ name: "calendar", args: { from: "2033-03-10", to: "2033-06-10" } }]
          : [answer("Nothing on.", ["hub"])],
      ),
      { userId, text: "What's on this spring?" },
    );
    expect(result.outcome).toBe("bark");
  });

  it("tells the model what was wrong with a tool's input, and lets it try again", async () => {
    const d = deps((_, round) =>
      round === 1
        ? [{ name: "calendar", args: { from: "tomorrow", to: "2033-03-10" } }]
        : round === 2
          ? [{ name: "calendar", args: { from: "2033-03-10", to: "2033-03-10" } }]
          : [answer("Nothing on tomorrow.", ["hub"])],
    );
    const result = await ask(db, d, { userId, text: "What's on tomorrow?" });
    expect(result.outcome).toBe("answer");
    expect(JSON.stringify(d.model.requests[1].contents.at(-1))).toContain("bad input (from: use YYYY-MM-DD)");
  });

  it("allows `self` for a greeting, with no tool", async () => {
    const result = await ask(
      db,
      deps(() => [answer("Woof! I'm Cookie.", ["self"])]),
      { userId, text: "Hi Cookie" },
    );
    expect(result).toMatchObject({ outcome: "answer", sources: [{ kind: "self", label: "Cookie" }] });
  });

  it("stops after four rounds (LIM-1)", async () => {
    const d = deps(() => [{ name: "today", args: {} }]);
    const result = await ask(db, d, { userId, text: "Keep looking" });
    expect(result.outcome).toBe("bark");
    expect(d.model.requests).toHaveLength(LIMITS.rounds);
    expect(lines.at(-1)).toMatchObject({ why: "round limit" });
  });

  it("stops after five tool calls (LIM-1)", async () => {
    const d = deps(() => Array.from({ length: 3 }, () => ({ name: "today", args: {} })));
    const result = await ask(db, d, { userId, text: "Look everywhere" });
    expect(result.outcome).toBe("bark");
    expect(d.model.requests).toHaveLength(2);
    expect(lines.at(-1)).toMatchObject({ why: "tool limit" });
  });

  it("says so when the model can't be reached", async () => {
    const result = await ask(
      db,
      {
        model: {
          round: async () => {
            throw new LlmError("quota", "busy");
          },
        },
        now,
        log: (f) => lines.push(f),
      },
      { userId, text: "Anyone there?" },
    );
    expect(result).toMatchObject({
      outcome: "error",
      text: "Cookie can't answer right now. Try again in a moment.",
    });
  });

  it("carries earlier turns of the conversation into a follow-up (MEM-8)", async () => {
    const first = await ask(
      db,
      deps((_, round) =>
        round === 1 ? [{ name: "today", args: {} }] : [answer("Swim practice at 2:30 pm.", ["hub"])],
      ),
      { userId, text: "What's next today?" },
    );
    const d = deps(() => [answer("It ends at 4 pm.", ["conversation"])]);
    const followUp = await ask(db, d, {
      userId,
      conversationId: first.conversationId,
      text: "And when does it end?",
    });
    expect(followUp).toMatchObject({
      outcome: "answer",
      conversationId: first.conversationId,
      sources: [{ kind: "conversation", label: "Earlier in this chat" }],
    });
    const sent = d.model.requests[0].contents;
    expect(sent.map((c) => c.role)).toEqual(["user", "model", "user"]);
    expect(sent[0].parts![0].text).toBe("What's next today?");
    expect(sent[1].parts![0].text).toBe("Swim practice at 2:30 pm.");

    // A new conversation has no history, so "conversation" isn't a source.
    const fresh = await ask(
      db,
      deps(() => [answer("It ends at 4 pm.", ["conversation"])]),
      { userId, text: "And when does it end?" },
    );
    expect(fresh.outcome).toBe("bark");
  });

  it("rests after 20 questions in 5 minutes (LIM-4)", async () => {
    const d = deps(() => [answer("Woof!", ["self"])]);
    for (let i = 0; i < LIMITS.perAccount.limit; i++)
      expect((await ask(db, d, { userId, text: "Hi" })).outcome).toBe("answer");
    const result = await ask(db, d, { userId, text: "Hi" });
    expect(result).toMatchObject({
      outcome: "limit",
      text: "Cookie needs a rest. Try again in a few minutes.",
    });
    // The model wasn't asked.
    expect(d.model.requests).toHaveLength(LIMITS.perAccount.limit);
  });

  it("stops at the monthly cap, and starts again when it is raised (LIM-5)", async () => {
    // The questions above cost a fraction of a cent each.
    expect(await monthSpendUsd(db, now)).toBeLessThan(0.1);
    await db.insert(assistantTurns).values({
      conversationId: "00000000-0000-4000-8000-000000000001",
      userId,
      mode: "text",
      outcome: "answer",
      costUsd: 2,
      createdAt: new Date("2033-03-05T19:00:00Z"),
    });
    await saveAssistantSettings(db, { monthlyCapUsd: 2 });
    const d = deps(() => [answer("Woof!", ["self"])]);
    expect(await ask(db, d, { userId, text: "Hi" })).toMatchObject({
      outcome: "limit",
      text: "Cookie has reached this month's limit.",
    });
    expect(d.model.requests).toHaveLength(0);
    await saveAssistantSettings(db, { monthlyCapUsd: 5 });
    expect((await ask(db, d, { userId, text: "Hi" })).outcome).toBe("answer");
    expect(await getAssistantSettings(db)).toMatchObject({ monthlyCapUsd: 5, speak: true, web: false });
  });

  it("shows up on the Costs page as its own feature (LIM-6)", async () => {
    const costs = await loadCosts(db, now);
    expect(costs.features.month.assistant).toBeGreaterThanOrEqual(2);
    expect(costs.features.month.assistant).toBeLessThan(2.1);
    expect(costs.features.days.find((d) => d.day === "2033-03-05")).toMatchObject({ assistant: 2 });
  });

  it("logs numbers and names, never words (CSEC-7)", async () => {
    await ask(
      db,
      deps((_, round) => (round === 1 ? [{ name: "today", args: {} }] : [answer("Swim practice.", ["hub"])])),
      { userId, text: "What's on today, Cookie?" },
    );
    const line = lines.at(-1)!;
    expect(line).toMatchObject({ outcome: "answer", tools: ["today"], inputTokens: 2000 });
    expect(JSON.stringify(line)).not.toMatch(/Swim|Cookie|today,/);
  });

  it("never puts credentials, sign-in names or inbox text in a tool result (CSEC-5)", async () => {
    const [credential] = await db
      .insert(credentials)
      .values({
        kind: "password",
        provider: "veracross",
        label: "LABEL-SECRET-1",
        username: "LOGIN-SECRET-2",
        ciphertext: Buffer.from("CIPHER-SECRET-3"),
        wrappedDek: Buffer.from("DEK-SECRET-4"),
        keyVersion: "test",
      })
      .returning();
    const [source] = await db
      .insert(sources)
      .values({
        kind: "gmail",
        name: "Coach emails",
        credentialId: credential.id,
        config: { feed: "CONFIG-SECRET-5" },
      })
      .returning();
    await db.insert(emailMessages).values({
      sourceId: source.id,
      gmailMessageId: `cookie-${Date.now()}`,
      receivedAt: now,
      fromAddress: "FROM-SECRET-6@example.test",
      subject: "SUBJECT-SECRET-7",
    });

    // The made-up credential can't be opened, so it mustn't outlive this test.
    try {
      const ctx: ToolContext = { db, now, timeZone: await getHomeTimeZone(db), people: await listPeople(db) };
      const inputs: Record<string, unknown[]> = {
        today: [{}],
        calendar: [{ from: "2033-03-01", to: "2033-03-31" }],
        tennis: [
          { view: "upcoming" },
          { view: "results" },
          { view: "player", player: "a" },
          { view: "tournament", tournament: "a" },
        ],
        swimming: [
          { view: "meets" },
          { view: "results" },
          { view: "pbs" },
          { view: "event", event: "50 free" },
        ],
        school: [{}, { date: "2033-03-09" }],
        videos: [{}],
        costs: [{}],
      };
      expect(Object.keys(inputs).sort()).toEqual(HUB_TOOLS.map((t) => t.name).sort());
      for (const tool of HUB_TOOLS) {
        for (const input of inputs[tool.name]) {
          const text = fitResult(await tool.run(ctx, tool.input.parse(input)));
          expect(text.length, tool.name).toBeLessThanOrEqual(LIMITS.resultChars);
          expect(text, tool.name).not.toMatch(/SECRET/);
        }
      }
    } finally {
      await db.execute(sql`delete from email_messages where source_id = ${source.id}`);
      await db.execute(sql`delete from sources where id = ${source.id}`);
      await db.execute(sql`delete from credentials where id = ${credential.id}`);
    }
  });

  it("keeps each account's history, and clears the words but not the costs (MEM-9)", async () => {
    const before = await listTurns(db, userId, { limit: 100 });
    expect(before.turns.length).toBeGreaterThan(10);
    expect(before.turns.at(-1)).toMatchObject({ heard: "What's on today, Cookie?", text: "Swim practice." });
    // Oldest first.
    const times = before.turns.map((t) => t.createdAt);
    expect(times).toEqual([...times].sort());

    const page = await listTurns(db, userId, { limit: 3 });
    expect(page.turns).toHaveLength(3);
    expect(page.more).toBe(true);

    const spent = await monthSpendUsd(db, now);
    await clearHistory(db);
    expect((await listTurns(db, userId)).turns).toEqual([]);
    const [row] = await db
      .select({ words: sql<number>`count(heard) + count(answer)`, rows: sql<number>`count(*)` })
      .from(assistantTurns);
    expect(Number(row.words)).toBe(0);
    expect(Number(row.rows)).toBeGreaterThan(10);
    expect(await monthSpendUsd(db, now)).toBe(spent);
  });
});
