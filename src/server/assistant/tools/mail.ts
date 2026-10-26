import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { emailSuggestions, MAIL_TOPICS, mailItems, mailListenCursors, mailTodos } from "@db/schema";
import { localDate } from "@/domain/time";
import { markMailRead, setTodoDone } from "../../mail/view";
import { dayOf, findPerson, has, problem, stamp, type Tool, type ToolContext } from "./types";

// Listen mode (intent 0025, ML-1..6): today's mail, one email at a time,
// read from what the morning digest stored; no waiting on the worker. Her
// place is kept per conversation for 30 minutes, so "next" carries on
// across questions, typed or spoken.

const CURSOR_MS = 30 * 60_000;
const MAX_TODOS = 8;

const digestInput = z.object({
  move: z
    .enum(["start", "next", "same"])
    .optional()
    .describe('"start" (default), "next", or "same": the one just read'),
  day: z.iso.date().optional().describe("Default today"),
  person: z.string().max(40).optional().describe("Only mail about this person"),
  topic: z.enum(MAIL_TOPICS).optional(),
  from: z.string().max(100).optional().describe("Only mail from this sender"),
});

type Row = typeof mailItems.$inferSelect;

async function itemsFor(
  ctx: ToolContext,
  q: z.infer<typeof digestInput>,
  day: string,
): Promise<Row[] | string> {
  const rows = await ctx.db
    .select()
    .from(mailItems)
    .where(eq(mailItems.day, day))
    .orderBy(asc(mailItems.receivedAt));
  let readable = rows.filter((r) => r.summary && !r.routine);
  if (q.person) {
    const person = findPerson(q.person, ctx.people);
    if (!person)
      return `there's no one called ${q.person}; the people are ${ctx.people.map((p) => p.name).join(", ")}`;
    readable = readable.filter((r) => r.people.includes(person.id));
  }
  if (q.topic) readable = readable.filter((r) => r.topic === q.topic);
  if (q.from) {
    const words = q.from.replace(/^the\s+/i, "");
    readable = readable.filter(
      (r) => has(r.senderName, words) || has(r.senderAddress, words) || has(r.subject, words),
    );
  }
  // The order the spoken digest uses: by topic, then by time.
  const rank = (t: string) => MAIL_TOPICS.indexOf(t as (typeof MAIL_TOPICS)[number]);
  return readable.sort((a, b) => rank(a.topic) - rank(b.topic));
}

async function openTodos(ctx: ToolContext, itemIds?: string[]) {
  const rows = await ctx.db
    .select()
    .from(mailTodos)
    .where(and(isNull(mailTodos.doneAt), itemIds ? inArray(mailTodos.itemId, itemIds) : undefined))
    .orderBy(asc(mailTodos.dueOn), asc(mailTodos.createdAt))
    .limit(MAX_TODOS);
  return rows.map((t) => ({ id: t.id, text: t.text, due: t.dueOn ? dayOf(t.dueOn) : undefined }));
}

async function emailView(ctx: ToolContext, r: Row) {
  const [suggestion] = r.suggestionId
    ? await ctx.db
        .select({
          id: emailSuggestions.id,
          status: emailSuggestions.status,
          extracted: emailSuggestions.extracted,
        })
        .from(emailSuggestions)
        .where(eq(emailSuggestions.id, r.suggestionId))
    : [];
  const ex = (suggestion?.extracted ?? {}) as { title?: string; date?: string | null };
  return {
    id: r.id,
    from: r.senderName,
    subject: r.subject,
    topic: r.topic,
    received: stamp(r.receivedAt, ctx.timeZone),
    summary: r.summary,
    newsletterOthers: r.newsletter?.others.length || undefined,
    todos: await openTodos(ctx, [r.id]),
    // ML-4: "add that" applies this with `suggestion_apply`.
    calendarSuggestion:
      suggestion && suggestion.status === "pending"
        ? { id: suggestion.id, title: ex.title, date: ex.date ? dayOf(ex.date) : undefined }
        : undefined,
  };
}

export const mailDigestTool: Tool<z.infer<typeof digestInput>> = {
  name: "mail_digest",
  kind: "hub",
  label: "Today's mail",
  description: "Today's mail, one email at a time, as the morning digest stored it.",
  input: digestInput,
  async run(ctx, q) {
    const today = localDate(ctx.now, ctx.timeZone);
    const move = q.move ?? "start";
    const [cursor] = await ctx.db
      .select()
      .from(mailListenCursors)
      .where(eq(mailListenCursors.conversationId, ctx.conversationId));
    const fresh =
      cursor &&
      ctx.now.getTime() - cursor.updatedAt.getTime() < CURSOR_MS &&
      (!q.day || q.day === cursor.day);
    let day: string, order: string[], position: number;
    if (move !== "start" && fresh) {
      day = cursor.day;
      order = cursor.order;
      position = move === "next" ? cursor.position + 1 : cursor.position;
    } else {
      day = q.day ?? today;
      const items = await itemsFor(ctx, q, day);
      if (typeof items === "string") return problem(items);
      order = items.map((r) => r.id);
      position = 0;
    }
    await ctx.db
      .insert(mailListenCursors)
      .values({ conversationId: ctx.conversationId, day, order, position, updatedAt: ctx.now })
      .onConflictDoUpdate({
        target: mailListenCursors.conversationId,
        set: { day, order, position, updatedAt: ctx.now },
      });
    if (!order.length)
      return {
        total: 0,
        day: dayOf(day),
        openTodos: await openTodos(ctx),
        say: "Say there's no email to read for that, then any open to-dos in one line.",
      };
    // ML-2: past the last one, the open to-dos, then "that's all".
    if (position >= order.length)
      return {
        done: true,
        total: order.length,
        openTodos: await openTodos(ctx),
        say: "Say that was the last email, then the open to-dos in one line, then that's all.",
      };
    const [row] = await ctx.db.select().from(mailItems).where(eq(mailItems.id, order[position]));
    if (!row) return problem("that email is gone (cleared or older than two weeks); start again");
    await markMailRead(ctx.db, ctx.userId, row.id).catch(() => undefined);
    return {
      total: order.length,
      number: position + 1,
      email: await emailView(ctx, row),
      say:
        move === "same"
          ? 'Don\'t read it again. "Tell me more": call `email_read` with mail_item_id = email.id and about = its subject. "Add that": call `suggestion_apply` with calendarSuggestion.id, or say there\'s nothing from that email to add. "Mark that done": call `mail_todo_done` with the to-dos\' ids (ask which if several could be meant).'
          : `Say it's ${position + 1} of ${order.length}, who it's from, then the summary as written, then its to-dos and calendar suggestion if any, in one short paragraph. End by offering "next".`,
    };
  },
};

const doneInput = z.object({
  todo_ids: z.array(z.uuid()).min(1).max(5).describe("From `mail_digest`"),
});

export const mailTodoDoneTool: Tool<z.infer<typeof doneInput>> = {
  name: "mail_todo_done",
  kind: "hub",
  label: "Today's mail",
  description: "Tick off to-dos from today's mail, only when asked.",
  input: doneInput,
  async run(ctx, q) {
    if (!/\b(done|did|finished|tick|check(ed)? off|mark)\b|完成|做完|搞定/i.test(ctx.question))
      return problem("the question didn't ask to mark anything done");
    const rows = await ctx.db
      .select({ id: mailTodos.id, text: mailTodos.text })
      .from(mailTodos)
      .where(and(inArray(mailTodos.id, q.todo_ids), isNull(mailTodos.doneAt)));
    if (!rows.length) return problem("none of those are open to-dos; call `mail_digest` again");
    for (const r of rows) await setTodoDone(ctx.db, "Cookie", r.id, true, ctx.now);
    return { done: rows.map((r) => r.text), say: "Say in one line what was ticked off." };
  },
};

export const MAIL_TOOLS = [mailDigestTool, mailTodoDoneTool] as Tool[];
