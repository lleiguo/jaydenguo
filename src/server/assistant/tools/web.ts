import { z } from "zod";
import { languageOf, linksIn, webQueryProblem, WEB_LIMITS } from "@/domain/assistant";
import { FetchRefused } from "../web";
import { problem, type Tool } from "./types";

// TOOL-11, TOOL-12: the web. Only offered when "Use the web" is on.

const searchInput = z.object({
  query: z.string().min(1).describe("What to search for, with no family names, school, clubs or address"),
});

// The search's own answer goes to the family as it is and ends the
// question (see ../web.ts), so this tool hands nothing back to the model.
export const webSearchTool: Tool<z.infer<typeof searchInput>> = {
  name: "web_search",
  kind: "web",
  label: "The web",
  description:
    "Search the web for something about the world outside the family (opening hours, an address, a rule, the weather). Its answer goes to the family directly and ends the question.",
  input: searchInput,
  async run(ctx, q) {
    const refused = webQueryProblem(q.query, [
      ...ctx.people.map((p) => p.name),
      ...ctx.settings.privateTerms,
    ]);
    if (refused) return problem(refused);
    const result = await ctx.web.search(q.query.trim(), languageOf(ctx.question));
    ctx.turn.webCost.inputTokens += result.inputTokens;
    ctx.turn.webCost.outputTokens += result.outputTokens;
    ctx.turn.webCost.costUsd += result.costUsd;
    ctx.turn.webCost.searches += result.queries.length;
    if (!result.text) return problem("the web search found no answer");
    ctx.turn.webAnswer = {
      text: result.text,
      sources: [
        ...result.pages.map((p) => ({ kind: "web" as const, label: p.title, url: p.url })),
        // Google's search suggestions, shown with its answer.
        ...result.queries.slice(0, WEB_LIMITS.sources).map((query) => ({
          kind: "web" as const,
          label: `Google: ${query}`,
          url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
        })),
      ],
    };
    return { done: true };
  },
};

const fetchInput = z.object({ url: z.string().describe("The link, exactly as written in the question") });

export const webFetchTool: Tool<z.infer<typeof fetchInput>> = {
  name: "web_fetch",
  kind: "web",
  label: "The web",
  description: "Read one public web page as text. Only a link written in the question itself.",
  input: fetchInput,
  async run(ctx, q) {
    if (!linksIn(ctx.question).includes(q.url))
      return problem("you can only read a link written in the question itself");
    try {
      const page = await ctx.web.fetch(q.url);
      ctx.turn.webSources.push({ kind: "web", label: page.title ?? new URL(page.url).hostname, url: q.url });
      return { title: page.title, text: page.text };
    } catch (err) {
      if (err instanceof FetchRefused) return problem(err.message);
      throw err;
    }
  },
};
