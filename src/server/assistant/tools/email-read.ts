import { z } from "zod";
import { languageOf } from "@/domain/assistant";
import { emailSource } from "../email";
import { newRead, READ_LIMITS, readsLastHour } from "../email-read";
import { problem, type Tool } from "./types";

// Intent 0009, ERD-1..6: find an email the parent asks about and summarize
// it. She can't read mail herself: this records what to look for and
// starts the worker, and the summary follows in the chat.

const readInput = z.object({
  about: z
    .string()
    .min(1)
    .max(200)
    .describe('What the email is about, in the parent\'s words: "field trip", "swim meet times"'),
  from: z
    .string()
    .max(100)
    .optional()
    .describe("Who sent it, only if the parent said: a name, a school or an address"),
  days: z
    .number()
    .int()
    .min(1)
    .max(READ_LIMITS.maxDays)
    .optional()
    .describe('How far back to look, in days: 1 for "today", 7 for "this week" (the default), at most 30'),
});

export const emailReadTool: Tool<z.infer<typeof readInput>> = {
  name: "email_read",
  kind: "hub",
  label: "Email",
  description:
    "Find an email the parent asks about and summarize it for them. The summary arrives in the chat a little later. For calendar changes suggested by email, use `suggestions` instead.",
  input: readInput,
  async run(ctx, q) {
    if (ctx.turn.emailRead) return problem("one email per question; this question already asked for one");
    const source = await emailSource(ctx.db);
    // ERD-2
    if (!source?.enabled)
      return problem(
        "Gmail isn't connected for reading email; say it can be added under Settings → Sources, with the senders to read",
      );
    if ((await readsLastHour(ctx.db, ctx.userId, ctx.now)) >= READ_LIMITS.perHour)
      return problem("that's enough emails for this hour; say to ask again a little later");
    const read = await newRead(
      ctx.db,
      {
        userId: ctx.userId,
        conversationId: ctx.conversationId,
        about: q.about.trim(),
        fromHint: q.from?.trim() || null,
        days: q.days ?? READ_LIMITS.defaultDays,
        language: languageOf(ctx.question),
      },
      ctx.now,
    );
    ctx.turn.emailRead = read;
    await ctx.launch?.(["assistant:email", read.id]).catch(() => undefined);
    return {
      checking: true,
      say: "Say only that you're checking the mail and the summary will appear here in a minute (source \"self\"). Don't guess what the email says.",
    };
  },
};
