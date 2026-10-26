import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  assistantEmailReads,
  emailMessages,
  emailSuggestions,
  mailItems,
  mailListenCursors,
  mailTodos,
  sources,
  users,
} from "@db/schema";
import { getAssistantSettings } from "@/server/assistant/settings";
import { emailReadTool } from "@/server/assistant/tools/email-read";
import { EMAIL_TOOLS } from "@/server/assistant/tools";
import { mailDigestTool, mailTodoDoneTool } from "@/server/assistant/tools/mail";
import { newTurn, type ToolContext } from "@/server/assistant/tools/types";
import { createDb, createPool, type PoolHandle } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { clearMail } from "@/server/mail/digest";
import { listPeople } from "@/server/people";

// Intent 0025, ML-1..6: Cookie reads today's mail from what the morning
// digest stored, one email at a time; "next" carries on across questions;
// "tell me more", "add that" and "mark that done" act on the email just read.

const TZ = "America/Toronto";

describe("Cookie reads today's mail (listen mode)", () => {
  let handle: PoolHandle;
  let db: ReturnType<typeof createDb>;
  let userId: string;
  let sourceId: string;
  let suggestionId: string;
  const now = new Date("2031-05-06T14:00:00Z");
  const day = "2031-05-06";
  const ids: Record<string, string> = {};
  const launched: string[][] = [];

  const ctx = async (question: string, conversationId: string, at = now): Promise<ToolContext> => ({
    db,
    now: at,
    timeZone: TZ,
    people: await listPeople(db),
    userId,
    question,
    conversationId,
    turn: newTurn(),
    settings: await getAssistantSettings(db),
    web: { search: async () => ({}) as never, fetch: async () => ({}) as never },
    launch: async (a) => {
      launched.push(a);
    },
  });

  beforeAll(async () => {
    await runMigrations();
    handle = await createPool();
    db = createDb(handle.pool);
    [{ id: userId }] = await db
      .insert(users)
      .values({ email: "mail-listener@example.test" })
      .onConflictDoUpdate({ target: users.email, set: { email: "mail-listener@example.test" } })
      .returning();
    [{ id: sourceId }] = await db
      .insert(sources)
      .values({
        kind: "gmail",
        name: `Listen ${randomUUID()}`,
        enabled: true,
        config: { senders: ["*@school.example"] },
      })
      .returning({ id: sources.id });
  });
  afterAll(async () => {
    await clearMail(db);
    await db.delete(emailSuggestions).where(eq(emailSuggestions.sourceId, sourceId));
    await db.delete(emailMessages).where(eq(emailMessages.sourceId, sourceId));
    await db.delete(sources).where(eq(sources.id, sourceId));
    await handle.close();
  });

  beforeEach(async () => {
    await clearMail(db);
    await db.delete(mailListenCursors);
    await db.delete(assistantEmailReads).where(eq(assistantEmailReads.userId, userId));
    launched.length = 0;
    const [m] = await db
      .insert(emailMessages)
      .values({
        sourceId,
        gmailMessageId: `g-${randomUUID()}`,
        receivedAt: now,
        fromAddress: "coach@school.example",
        subject: "Practice",
      })
      .returning();
    [{ id: suggestionId }] = await db
      .insert(emailSuggestions)
      .values({
        sourceId,
        messageId: m.id,
        gmailMessageId: m.gmailMessageId,
        messageUrl: "https://mail.google.com/x",
        kind: "new",
        extracted: { title: "Extra practice", date: "2031-05-08" },
        confidence: {},
        quote: "extra practice Thursday",
      })
      .returning({ id: emailSuggestions.id });
    const item = async (key: string, over: Partial<typeof mailItems.$inferInsert>) => {
      const [row] = await db
        .insert(mailItems)
        .values({
          sourceId,
          gmailMessageId: `${key}-${randomUUID()}`,
          messageUrl: "https://mail.google.com/y",
          receivedAt: new Date("2031-05-06T12:00:00Z"),
          day,
          senderName: "Someone",
          senderAddress: "someone@school.example",
          subject: key,
          summary: `${key} summary.`,
          language: "en",
          topic: "other",
          ...over,
        })
        .returning({ id: mailItems.id });
      ids[key] = row.id;
    };
    await item("Field trip", {
      topic: "school",
      senderName: "School office",
      senderAddress: "office@school.example",
    });
    await item("Practice", { topic: "soccer", senderName: "Coach Sam", suggestionId });
    await item("Receipt", { topic: "soccer", routine: true });
    await db.insert(mailTodos).values([
      {
        itemId: ids["Field trip"],
        subject: "Field trip",
        messageUrl: "x",
        text: "Sign the form",
        dueOn: "2031-05-09",
      },
      { itemId: ids["Field trip"], subject: "Field trip", messageUrl: "x", text: "Send $5" },
    ]);
  });

  it("is offered with the email tools", () => {
    expect(EMAIL_TOOLS.map((t) => t.name)).toEqual(expect.arrayContaining(["mail_digest", "mail_todo_done"]));
  });

  it("reads one email at a time in the digest's order, and next carries on across questions (ML-1, ML-2, ML-6)", async () => {
    const conv = randomUUID();
    const first = (await mailDigestTool.run(await ctx("Read me today's mail", conv), {})) as {
      total: number;
      number: number;
      email: { subject: string; todos: unknown[] };
    };
    // School before soccer; the routine receipt isn't read.
    expect(first).toMatchObject({ total: 2, number: 1, email: { subject: "Field trip" } });
    expect(first.email.todos).toHaveLength(2);
    const second = await mailDigestTool.run(await ctx("next", conv, new Date(now.getTime() + 60_000)), {
      move: "next",
    });
    expect(second).toMatchObject({
      number: 2,
      email: { subject: "Practice", calendarSuggestion: { id: suggestionId, title: "Extra practice" } },
    });
    const end = await mailDigestTool.run(await ctx("下一个", conv, new Date(now.getTime() + 120_000)), {
      move: "next",
    });
    expect(end).toMatchObject({
      done: true,
      total: 2,
      openTodos: [{ text: "Sign the form" }, { text: "Send $5" }],
    });
    // Another conversation starts from the top.
    expect(await mailDigestTool.run(await ctx("next", randomUUID()), { move: "next" })).toMatchObject({
      number: 1,
    });
    // After 30 minutes "next" starts again too.
    expect(
      await mailDigestTool.run(await ctx("next", conv, new Date(now.getTime() + 40 * 60_000)), {
        move: "next",
      }),
    ).toMatchObject({ number: 1 });
  });

  it("filters by sender words and topic, and marks what it read as read (ML-1, MD-6)", async () => {
    const r = await mailDigestTool.run(await ctx("any email from the school office?", randomUUID()), {
      from: "the school office",
    });
    expect(r).toMatchObject({ total: 1, email: { subject: "Field trip" } });
    const [row] = await db.select().from(mailItems).where(eq(mailItems.id, ids["Field trip"]));
    expect(row.readBy).toContain(userId);
    expect(
      await mailDigestTool.run(await ctx("tennis mail?", randomUUID()), { topic: "tennis" }),
    ).toMatchObject({ total: 0 });
  });

  it("tell me more reads that email again through the worker (ML-3)", async () => {
    const conv = randomUUID();
    await mailDigestTool.run(await ctx("Read me today's mail", conv), {});
    const c = await ctx("tell me more", conv);
    const same = (await mailDigestTool.run(c, { move: "same" })) as { email: { id: string } };
    expect(same.email.id).toBe(ids["Field trip"]);
    expect(await emailReadTool.run(c, { mail_item_id: same.email.id, about: "x" })).toMatchObject({
      checking: true,
    });
    const [read] = await db.select().from(assistantEmailReads).where(eq(assistantEmailReads.userId, userId));
    expect(read).toMatchObject({ about: "Field trip", fromHint: "office@school.example", days: 2 });
    expect(launched[0]).toEqual(["assistant:email", read.id]);
    await db.delete(assistantEmailReads).where(eq(assistantEmailReads.userId, userId));
  });

  it("mark that done ticks the email's to-dos, only when asked (ML-5)", async () => {
    const conv = randomUUID();
    await mailDigestTool.run(await ctx("Read me today's mail", conv), {});
    const same = (await mailDigestTool.run(await ctx("mark that done", conv), { move: "same" })) as {
      email: { todos: { id: string }[] };
    };
    const todoIds = same.email.todos.map((t) => t.id);
    expect(await mailTodoDoneTool.run(await ctx("what's next?", conv), { todo_ids: todoIds })).toMatchObject({
      error: expect.stringMatching(/didn't ask/),
    });
    expect(
      await mailTodoDoneTool.run(await ctx("mark that done", conv), { todo_ids: todoIds }),
    ).toMatchObject({
      done: ["Sign the form", "Send $5"],
    });
    const rows = await db.select().from(mailTodos).where(eq(mailTodos.itemId, ids["Field trip"]));
    expect(rows.every((t) => t.doneAt && t.doneBy === "Cookie")).toBe(true);
  });
});
