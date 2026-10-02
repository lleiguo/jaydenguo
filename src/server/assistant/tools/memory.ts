import { z } from "zod";
import { asksToForget, asksToRemember, looksSecret, MEMORY_LIMITS } from "@/domain/assistant";
import { addMemory, forgetMemory, getMemory, searchMemories, type MemoryView } from "../memory";
import { findPerson, namesOf, problem, type Tool, type ToolContext } from "./types";

// TOOL-8..10: Cookie's memory. Searching is free; saving and forgetting
// happen only when the question's own words ask for it (MEM-1, MEM-5).

const keywords = z
  .array(z.string())
  .min(1)
  .max(MEMORY_LIMITS.keywords)
  .describe("Search words in BOTH English and Chinese, e.g. shoe, size, 鞋, 鞋码");

const shape = (m: MemoryView, ctx: ToolContext) => ({
  id: m.id,
  fact: m.text,
  about: namesOf(m.about, ctx.people),
  saved: m.createdAt.slice(0, 10),
});

const searchInput = z.object({
  keywords,
  about: z.string().optional().describe("The person the question is about (a name from People)"),
});

export const memorySearchTool: Tool<z.infer<typeof searchInput>> = {
  name: "memory_search",
  kind: "memory",
  label: "Memory",
  description:
    "Facts the family told you to remember (sizes, birthdays, names, preferences, where things are). Use it when the hub tools can't answer a question about the family.",
  input: searchInput,
  async run(ctx, q) {
    const about = q.about ? findPerson(q.about, ctx.people) : null;
    const found = await searchMemories(ctx.db, q.keywords, about?.id);
    return found.length ? { facts: found.map((m) => shape(m, ctx)) } : problem("nothing in memory matches");
  },
};

const saveInput = z.object({
  text: z
    .string()
    .min(1)
    .max(MEMORY_LIMITS.textChars)
    .describe("One short fact, complete on its own, in the words of the question"),
  about: z.string().optional().describe("Who the fact is about (a name from People), if one person"),
  keywords,
});

export const memorySaveTool: Tool<z.infer<typeof saveInput>> = {
  name: "memory_save",
  kind: "memory",
  label: "Memory",
  description:
    "Remember one fact. Only when the question itself asks you to remember something. Never passwords, card numbers or sign-in codes.",
  input: saveInput,
  async run(ctx, q) {
    if (!asksToRemember(ctx.question)) return problem("the question didn't ask you to remember anything");
    if (ctx.turn.webRan) return problem("nothing can be saved in a question that used the web");
    if (ctx.turn.saved) return problem("one fact per question; this question already saved one");
    if (looksSecret(q.text) || looksSecret(ctx.question))
      return problem("you don't keep passwords, card numbers or sign-in codes; say so");
    const about = q.about ? findPerson(q.about, ctx.people) : null;
    ctx.turn.saved = await addMemory(
      ctx.db,
      ctx.userId,
      { text: q.text, about: about ? [about.id] : [], keywords: q.keywords },
      "chat",
    );
    return { saved: shape(ctx.turn.saved, ctx) };
  },
};

const forgetInput = z.object({ id: z.string().uuid().describe("The fact's id, from memory_search") });

export const memoryForgetTool: Tool<z.infer<typeof forgetInput>> = {
  name: "memory_forget",
  kind: "memory",
  label: "Memory",
  description:
    "Forget one fact, by its id from memory_search. Only when the question asks you to forget something; if several facts match, ask which one instead.",
  input: forgetInput,
  async run(ctx, q) {
    if (!asksToForget(ctx.question)) return problem("the question didn't ask you to forget anything");
    if (ctx.turn.forgot) return problem("one fact per question; this question already forgot one");
    const memory = await getMemory(ctx.db, q.id);
    if (!memory || memory.forgottenAt) return problem("no fact with that id");
    ctx.turn.forgot = await forgetMemory(ctx.db, q.id, ctx.now);
    return { forgot: shape(ctx.turn.forgot, ctx) };
  },
};
