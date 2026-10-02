import { lookup as dnsLookup } from "node:dns";
import https from "node:https";
import type { LookupFunction } from "node:net";
import { parse } from "node-html-parser";
import { fetchUrlProblem, isPublicAddress, WEB_LIMITS, type Language } from "@/domain/assistant";
import { vertexGenerate, type Generate } from "../llm/gemini";
import { costUsd } from "../llm/pricing";
import { LlmError } from "../llm/types";
import { ASSISTANT_MODEL } from "./model";

// Cookie's two ways to the web (intent 0007, TOOL-11, TOOL-12).
//
// Search is a separate model call that sees only the query (CSEC-3). Its
// answer is Google's "Grounded Result": by Google's terms it is shown to
// the person who asked as it is, with its links and search suggestions,
// not rewritten or mixed with anything else, and its links aren't
// followed by software. So a search ends the question, and its result is
// never fed back to Cookie's own model.
//
// The page fetcher reads one public https page whose link the question
// itself contains (CSEC-4).

// --- Search -------------------------------------------------------------------

export type WebResult = {
  // The answer, or null when the results don't hold one.
  text: string | null;
  // The pages it came from.
  pages: { title: string; url: string }[];
  // The Google searches behind it, shown as suggestions.
  queries: string[];
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
};

export type WebSearch = (query: string, language: Language) => Promise<WebResult>;

// List price of a search beyond the monthly free ones (plan SP-C4). Counted
// for every search, so the monthly cap errs on the careful side.
export const SEARCH_USD = 0.014;

const NO_ANSWER = "NO_ANSWER";

const searchSystem = (language: Language) =>
  `Answer the search query from the search results only, in at most two short sentences, in ${
    language === "en" ? "English" : "Simplified Chinese"
  }. If the results don't answer it, reply with exactly ${NO_ANSWER}.`;

export function geminiSearch(generate?: Generate, model = ASSISTANT_MODEL()): WebSearch {
  return async (query, language) => {
    let response;
    try {
      generate ??= vertexGenerate();
      response = await generate({
        model,
        contents: [{ role: "user", parts: [{ text: query }] }],
        config: {
          systemInstruction: searchSystem(language),
          tools: [{ googleSearch: {} }],
          thinkingConfig: { thinkingBudget: 0 },
          maxOutputTokens: 300,
          // A search takes 4–17 s when Vertex is well (plan SP-C4): one
          // patient try, not two short ones.
          httpOptions: { timeout: 20_000, retryOptions: { attempts: 1 } },
        },
      });
    } catch (err) {
      const status = (err as { status?: number }).status;
      throw new LlmError(status === 429 ? "quota" : "unavailable", "The web search didn't answer.");
    }
    const grounding = response.candidates?.[0]?.groundingMetadata;
    const usage = response.usageMetadata;
    const input = usage?.promptTokenCount ?? 0;
    const output = (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0);
    const queries = grounding?.webSearchQueries ?? [];
    const text = (response.text ?? "").trim();
    const pages = (grounding?.groundingChunks ?? []).flatMap((c) =>
      c.web?.uri?.startsWith("https://")
        ? [{ title: c.web.title ?? c.web.domain ?? "Web page", url: c.web.uri }]
        : [],
    );
    return {
      // An answer with no page behind it didn't come from the search.
      text: !text || text.includes(NO_ANSWER) || !pages.length ? null : text,
      pages: pages.slice(0, WEB_LIMITS.sources),
      queries,
      inputTokens: input,
      outputTokens: output,
      costUsd: costUsd(model, { input, output }) + queries.length * SEARCH_USD,
    };
  };
}

// --- Page fetch ---------------------------------------------------------------

export type Page = { url: string; title: string | null; text: string };

export class FetchRefused extends Error {}

type Raw = { status: number; location: string | null; contentType: string; body: Buffer };

// One GET with no cookies and nothing about the hub in it. `lookup` runs
// when the connection is made, so the address that was checked is the
// address that is used.
export type Transport = (url: URL, lookup: LookupFunction) => Promise<Raw>;

// Resolves a host and refuses any address that isn't public (CSEC-4).
export const publicLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 4);
    const list = Array.isArray(addresses) ? addresses : [{ address: String(addresses), family: 4 }];
    const bad = list.find((a) => !isPublicAddress(a.address));
    if (bad || !list.length)
      return callback(
        new FetchRefused("that link doesn't lead to a public site") as NodeJS.ErrnoException,
        "",
        4,
      );
    if ((options as { all?: boolean }).all)
      return (callback as unknown as (e: null, a: typeof list) => void)(null, list);
    callback(null, list[0].address, list[0].family);
  });
};

const httpsTransport: Transport = (url, lookup) =>
  new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "GET",
        lookup,
        timeout: WEB_LIMITS.timeoutMs,
        headers: { accept: "text/html, text/plain;q=0.9", "user-agent": "family-hub-assistant/1.0" },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > WEB_LIMITS.bytes) {
            req.destroy(new FetchRefused("that page is too large to read"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            location: res.headers.location ?? null,
            contentType: String(res.headers["content-type"] ?? ""),
            body: Buffer.concat(chunks),
          }),
        );
        res.on("error", reject);
      },
    );
    const timer = setTimeout(
      () => req.destroy(new FetchRefused("that page took too long")),
      WEB_LIMITS.timeoutMs,
    );
    req.on("timeout", () => req.destroy(new FetchRefused("that page took too long")));
    req.on("error", reject);
    req.on("close", () => clearTimeout(timer));
    req.end();
  });

// Scripts never run: the page is read as text.
export function pageText(html: string): { title: string | null; text: string } {
  const root = parse(html, { blockTextElements: { script: false, style: false, noscript: false } });
  for (const el of root.querySelectorAll("script, style, noscript, svg, template, iframe")) el.remove();
  const title = root.querySelector("title")?.text.trim() || null;
  const text = (root.querySelector("main") ?? root.querySelector("body") ?? root).structuredText
    .replace(/[ \t ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
  return { title, text: text.slice(0, WEB_LIMITS.pageChars) };
}

export type PageFetch = (url: string) => Promise<Page>;

// Reads one page. Every hop (at most three redirects) must pass the same
// checks as the first link; anything else is a FetchRefused with words the
// model can pass on.
export function guardedFetch(
  transport: Transport = httpsTransport,
  lookup: LookupFunction = publicLookup,
): PageFetch {
  return async (first) => {
    let url = first;
    for (let hop = 0; hop <= WEB_LIMITS.redirects; hop++) {
      const problem = fetchUrlProblem(url);
      if (problem) throw new FetchRefused(problem);
      let raw: Raw;
      try {
        raw = await transport(new URL(url), lookup);
      } catch (err) {
        if (err instanceof FetchRefused) throw err;
        throw new FetchRefused("that page couldn't be reached");
      }
      if (raw.status >= 300 && raw.status < 400 && raw.location) {
        url = new URL(raw.location, url).toString();
        continue;
      }
      if (raw.status !== 200) throw new FetchRefused(`that page answered ${raw.status}`);
      if (!/^text\/(html|plain)\b/i.test(raw.contentType))
        throw new FetchRefused("that isn't a web page of text");
      const body = raw.body.toString("utf8");
      const page = /^text\/plain/i.test(raw.contentType)
        ? { title: null, text: body.slice(0, WEB_LIMITS.pageChars) }
        : pageText(body);
      return { url, ...page };
    }
    throw new FetchRefused("that link redirects too many times");
  };
}

// --- Stand-ins (ASSISTANT_LLM=fake) --------------------------------------------

export const fakeSearch: WebSearch = async (query) => ({
  text: /nothing/i.test(query) ? null : `A made-up web answer about ${query}.`,
  pages: [{ title: "example.com", url: "https://example.com/found" }],
  queries: [query],
  inputTokens: 60,
  outputTokens: 40,
  costUsd: SEARCH_USD,
});

export const fakeFetch: PageFetch = async (url) => ({
  url,
  title: "A made-up page",
  text: "Opening hours: 9 am to 5 pm, every day.",
});
