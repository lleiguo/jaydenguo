import { geminiAssistant, scriptedAssistant, type AssistantModel, type ModelCall } from "./model";
import { fakeSpeech, googleSpeech, type Speech } from "./speech";
import { geminiTranscriber, scriptedTranscriber, type Transcriber } from "./transcribe";
import { fakeFetch, fakeSearch, geminiSearch, guardedFetch, type PageFetch, type WebSearch } from "./web";

// Gemini on Vertex AI in production; a stand-in when ASSISTANT_LLM=fake
// (local development and end-to-end tests; never on Cloud Run).
export function defaultAssistant(): AssistantModel {
  if (process.env.ASSISTANT_LLM === "fake") {
    if (process.env.K_SERVICE || process.env.CLOUD_RUN_JOB)
      throw new Error("ASSISTANT_LLM=fake is for local use only");
    return fakeAssistant();
  }
  return geminiAssistant();
}

// The web to match: the real search and page fetcher, or made-up ones.
export function defaultWeb(): { search: WebSearch; fetch: PageFetch } {
  if (process.env.ASSISTANT_LLM === "fake") return { search: fakeSearch, fetch: fakeFetch };
  return { search: (query, language) => geminiSearch()(query, language), fetch: guardedFetch() };
}

// The stand-in hears the same question in every clip.
export function defaultTranscriber(): Transcriber {
  if (process.env.ASSISTANT_LLM === "fake") return scriptedTranscriber("What's on today?");
  return geminiTranscriber();
}

export function defaultSpeech(): Speech {
  if (process.env.ASSISTANT_LLM === "fake") return fakeSpeech;
  return googleSpeech();
}

const textOf = (parts: { text?: string }[] | undefined) => parts?.map((p) => p.text ?? "").join("") ?? "";

type FakeFact = { id: string; fact: string };

// Answers a handful of fixed questions so the chat can be tried without
// Vertex AI: "today" looks at the Today view, "hello" greets, "remember …"
// saves the rest of the sentence, "forget …" forgets the first fact that
// matches, "search for …" searches the web, a link is read, and anything
// else is looked up in memory, then gets a bark.
export function fakeAssistant(): AssistantModel {
  return scriptedAssistant((request, round): ModelCall[] => {
    const question = textOf(
      request.contents.findLast((c) => c.role === "user" && c.parts?.some((p) => p.text))?.parts,
    )
      .split("\n")
      .at(-1)!;
    const zh = /[\u3400-\u9fff]/.test(question);
    const language = zh ? "zh" : "en";
    const say = (text: string, sources: string[]): ModelCall[] => [
      { name: "answer", args: { heard: question, language, text, sources } },
    ];
    const bark: ModelCall[] = [
      {
        name: "bark",
        args: { heard: question, language, text: zh ? "汪！这个我不知道。" : "Woof! I don't know that one." },
      },
    ];
    // What the last tool answered, if this isn't the first round.
    const last = request.contents.at(-1)?.parts?.[0]?.functionResponse;
    const result = (last?.response as { result?: Record<string, unknown> } | undefined)?.result;
    const words = question.toLowerCase().match(/[a-z]{3,}|[\u3400-\u9fff]{2,}/g) ?? [];

    if (/today|今天/i.test(question)) {
      if (round === 1) return [{ name: "today", args: {} }];
      const titles = ((result?.events as { title: string }[] | undefined) ?? []).map((e) => e.title);
      return say(
        titles.length
          ? `${zh ? "今天有" : "Today:"} ${titles.join(", ")}.`
          : zh
            ? "今天没有安排。"
            : "Nothing on today.",
        ["hub"],
      );
    }
    if (/^(hi|hello|你好)/i.test(question))
      return say(zh ? "汪！我是 Cookie。" : "Woof! I'm Cookie.", ["self"]);

    const link = question.match(/https:\/\/\S+/)?.[0];
    if (link) {
      if (round === 1) return [{ name: "web_fetch", args: { url: link } }];
      const page = result as { text?: string } | undefined;
      return page?.text ? say(page.text, ["web"]) : bark;
    }
    const search = question.match(/^(?:search(?: the web)? for|搜索)\s*(.+?)[.。?？]?$/i);
    if (search) return round === 1 ? [{ name: "web_search", args: { query: search[1] } }] : bark;

    const remember = question.match(/^(?:remember(?: that)?|记住)\s*(.+?)[.。]?$/i);
    if (remember) {
      if (round === 1) return [{ name: "memory_save", args: { text: remember[1], keywords: words } }];
      const saved = result?.saved as FakeFact | undefined;
      return saved ? say(`Saved: ${saved.fact}.`, ["memory"]) : say("I don't keep that.", ["self"]);
    }
    if (round === 1) return [{ name: "memory_search", args: { keywords: words.length ? words : ["?"] } }];
    const facts = (result?.facts as FakeFact[] | undefined) ?? [];
    if (/^(forget|忘记|忘掉)/i.test(question)) {
      if (last?.name === "memory_search")
        return facts.length ? [{ name: "memory_forget", args: { id: facts[0].id } }] : bark;
      const forgot = result?.forgot as FakeFact | undefined;
      return forgot ? say(`Forgotten: ${forgot.fact}.`, ["memory"]) : bark;
    }
    return facts.length ? say(`${facts[0].fact}.`, ["memory"]) : bark;
  });
}
