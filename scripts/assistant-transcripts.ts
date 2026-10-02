// Spike SP-C1 (intent 0007, VOX-1): how well does Cookie's model transcribe
// real questions in Mandarin, English and both mixed?
//
//   VERTEX_PROJECT=… pnpm tsx scripts/assistant-transcripts.ts <folder> [--names "A,B"] [--mode loop|plain]
//
// <folder> holds 01.m4a, 02.m4a, … and said.txt ("01: the words as
// spoken", one line per clip). The clips are recordings of the family:
// they stay outside the repo, and this script prints what was heard next
// to what was said without writing either anywhere.
//
// --mode loop (default) sends each clip the way Cookie will: her system
// prompt and tools, with the transcript read from the `heard` of her final
// `answer` or `bark` (hub tools answer "nothing here", so no hub data is
// involved). --mode plain asks for the transcript alone, in one call: the
// call the server makes for a spoken question since K5.
// --names is the spelling list Cookie is given (VOX-3).

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { FunctionCallingConfigMode, GoogleGenAI, type Content } from "@google/genai";
import { ASSISTANT_MODEL } from "../src/server/assistant/model";
import { geminiTranscriber } from "../src/server/assistant/transcribe";
import { declarations, SYSTEM_PROMPT } from "../src/server/assistant/prompt";
import { HUB_TOOLS } from "../src/server/assistant/tools";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};

// Letters and digits only, lower case: "What's" and "whats" are the same.
const squash = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

// Edit distance, for a rough "how far off" per clip.
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const next = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = row[j];
      row[j] = next;
    }
  }
  return row[b.length];
}

async function main() {
  const folder = process.argv[2];
  if (!folder || !process.env.VERTEX_PROJECT) throw new Error("usage: see the top of this file");
  const mode = arg("--mode") ?? "loop";
  const names = arg("--names");
  const said = new Map(
    readFileSync(path.join(folder, "said.txt"), "utf8")
      .split("\n")
      .flatMap((line) => {
        const m = line.match(/^\s*(\d+)\s*[:.]?\s+(.+?)\s*$/);
        return m ? [[m[1].padStart(2, "0"), m[2]] as const] : [];
      }),
  );
  const clips = readdirSync(folder)
    .filter((f) => /^\d+\.m4a$/.test(f))
    .sort();
  const ai = new GoogleGenAI({ vertexai: true, project: process.env.VERTEX_PROJECT, location: "global" });
  const model = ASSISTANT_MODEL();
  const context = `[Now: 2026-10-02 Fri 16:00 (America/Toronto). People: ${names ?? "(not given)"}.]`;
  const loopTools = declarations(HUB_TOOLS).map((t) => ({
    name: t.name,
    description: t.description,
    parametersJsonSchema: t.parameters,
  }));

  // --mode plain is the call Cookie's server makes for a spoken question.
  const plain = geminiTranscriber();
  const transcribe = async (file: string): Promise<{ heard: string; rounds: number; firstCall: string }> => {
    if (mode === "plain") {
      const t = await plain({ data: readFileSync(file), mimeType: "audio/mp4" }, names?.split(",") ?? []);
      return { heard: t.text, rounds: 1, firstCall: "" };
    }
    const audio = { inlineData: { mimeType: "audio/mp4", data: readFileSync(file).toString("base64") } };
    const contents: Content[] = [
      {
        role: "user",
        parts: [{ text: `${context}\n(spoken question)` }, audio],
      },
    ];
    let firstCall = "";
    for (let round = 1; round <= 4; round++) {
      const res = await ai.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          tools: [{ functionDeclarations: loopTools }],
          toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY } },
          thinkingConfig: { thinkingBudget: 0 },
          maxOutputTokens: 500,
          httpOptions: { timeout: 20_000, retryOptions: { attempts: 3, initialDelay: 0.5, maxDelay: 2 } },
        },
      });
      const calls = res.functionCalls ?? [];
      if (!calls.length) return { heard: "(no call)", rounds: round, firstCall };
      firstCall ||= calls.map((c) => `${c.name}(${JSON.stringify(c.args)})`).join(" + ");
      for (const call of calls) {
        const args = (call.args ?? {}) as { heard?: string };
        if (call.name === "answer" || call.name === "bark")
          return { heard: args.heard ?? "", rounds: round, firstCall };
      }
      // Every hub tool finds nothing, so the question ends in a bark.
      contents.push(res.candidates![0].content!, {
        role: "user",
        parts: calls.map((call) => ({
          functionResponse: { id: call.id, name: call.name!, response: { result: { found: 0 } } },
        })),
      });
    }
    return { heard: "(no ending)", rounds: 4, firstCall };
  };

  let exact = 0;
  let off = 0;
  let total = 0;
  const times: number[] = [];
  console.log(`${model} · mode ${mode} · names ${names ?? "none"} · ${clips.length} clips\n`);
  for (const clip of clips) {
    const id = clip.slice(0, 2);
    const expected = said.get(id) ?? "";
    const t0 = Date.now();
    let result: Awaited<ReturnType<typeof transcribe>>;
    try {
      result = await transcribe(path.join(folder, clip));
    } catch (err) {
      result = { heard: `(error: ${String((err as Error).message).slice(0, 80)})`, rounds: 0, firstCall: "" };
    }
    const ms = Date.now() - t0;
    times.push(ms);
    const d = distance(squash(expected), squash(result.heard));
    if (d === 0) exact++;
    off += d;
    total += squash(expected).length;
    console.log(
      `${id} ${d === 0 ? "=" : `≠${d}`}\n   said:  ${expected}\n   heard: ${result.heard}` +
        (mode === "plain" ? "" : `\n   first: ${result.firstCall.slice(0, 110)}`) +
        `\n   ${result.rounds} round(s), ${ms} ms`,
    );
  }
  times.sort((a, b) => a - b);
  console.log(
    `\nexact (ignoring case, spaces, punctuation): ${exact}/${clips.length} · characters off: ${off}/${total} (${((off / total) * 100).toFixed(1)}%)` +
      ` · median ${times[Math.floor(times.length / 2)]} ms`,
  );
}

void main();
