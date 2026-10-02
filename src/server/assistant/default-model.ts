import { geminiAssistant, scriptedAssistant, type AssistantModel, type ModelCall } from "./model";

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

const textOf = (parts: { text?: string }[] | undefined) => parts?.map((p) => p.text ?? "").join("") ?? "";

// Answers a handful of fixed questions so the chat can be tried without
// Vertex AI: "today" looks at the Today view, "hello" greets, anything else
// gets a bark.
export function fakeAssistant(): AssistantModel {
  return scriptedAssistant((request, round): ModelCall[] => {
    const question = textOf(
      request.contents.findLast((c) => c.role === "user" && c.parts?.some((p) => p.text))?.parts,
    )
      .split("\n")
      .at(-1)!;
    const zh = /[㐀-鿿]/.test(question);
    const language = zh ? "zh" : "en";
    if (/today|今天/i.test(question)) {
      if (round === 1) return [{ name: "today", args: {} }];
      const result = request.contents.at(-1)?.parts?.[0]?.functionResponse?.response as
        { result?: { events?: { title: string }[] } } | undefined;
      const titles = (result?.result?.events ?? []).map((e) => e.title);
      const text = titles.length
        ? `${zh ? "今天有" : "Today:"} ${titles.join(", ")}.`
        : zh
          ? "今天没有安排。"
          : "Nothing on today.";
      return [{ name: "answer", args: { heard: question, language, text, sources: ["hub"] } }];
    }
    if (/^(hi|hello|你好)/i.test(question))
      return [
        {
          name: "answer",
          args: {
            heard: question,
            language,
            text: zh ? "汪！我是 Cookie。" : "Woof! I'm Cookie.",
            sources: ["self"],
          },
        },
      ];
    return [
      {
        name: "bark",
        args: { heard: question, language, text: zh ? "汪！这个我不知道。" : "Woof! I don't know that one." },
      },
    ];
  });
}
