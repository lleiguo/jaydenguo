// Spike SP-C3 (intent 0007, VOX-5): which voice reads Cookie's answers
// well when Mandarin and English share a sentence, how fast, and how big?
//
//   VERTEX_PROJECT=… pnpm tsx scripts/assistant-voices.ts <folder> [--check] [--voices "Leda,Wavenet-A"]
//
// Writes one MP3 per voice and sentence into <folder> (outside the repo)
// for the owner to listen to, and prints the time and size of each.
// --check also sends each clip back through Cookie's transcription, as a
// rough test that the words can be made out. The sentences are made up.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { geminiTranscriber } from "../src/server/assistant/transcribe";
import { googleSpeech, voiceFor } from "../src/server/assistant/speech";
import { languageOf } from "../src/domain/assistant";

const SENTENCES = [
  "Jayden has swim practice at 5:30 pm tomorrow at the Pan Am pool.",
  "Jayden 明天下午五点半有 swim practice，在 Pan Am pool。",
  "今天没有网球课，只有四点的游泳训练。",
  "他的 200 IM 最好成绩是 2 分 41 秒 35，上个月在 Fall Classic 游的。",
  "Woof! I don't know that one.",
  "汪！这个我不知道。",
  "这周六有一个冲突：tennis lesson 和 swim meet 都在上午九点。",
  "Next tournament: the Rising Stars U10 on October 17 at North York Tennis Club.",
  "Recess 是十点十五分，French 在 recess 之后。",
  "记住了：Jayden 的 locker 是 12 号。",
];

const VOICES = ["Leda", "Aoede", "Kore", "Puck", "Wavenet-A"];

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};

const squash = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

async function main() {
  const folder = process.argv[2];
  if (!folder || !process.env.VERTEX_PROJECT) throw new Error("usage: see the top of this file");
  mkdirSync(folder, { recursive: true });
  const check = process.argv.includes("--check");
  const transcribe = check ? geminiTranscriber() : null;
  for (const voice of arg("--voices")?.split(",") ?? VOICES) {
    const speak = googleSpeech();
    const times: number[] = [];
    let chars = 0;
    let bytes = 0;
    let same = 0;
    for (const [i, text] of SENTENCES.entries()) {
      const language = languageOf(text);
      const t0 = Date.now();
      const audio = await speak({ text, language, voice });
      const ms = Date.now() - t0;
      times.push(ms);
      chars += text.length;
      bytes += audio.data.length;
      const name = `${voice}-${String(i + 1).padStart(2, "0")}.mp3`;
      writeFileSync(path.join(folder, name), audio.data);
      let heard = "";
      if (transcribe) {
        heard = await transcribe({ data: audio.data, mimeType: "audio/mpeg" }, ["Jayden"]).then(
          (t) => t.text,
          () => "(no reply)",
        );
        if (squash(heard) === squash(text)) same++;
      }
      console.log(
        `${name} ${voiceFor(voice, language).name} ${ms} ms ${audio.data.length} B` +
          (transcribe ? `\n   text:  ${text}\n   heard: ${heard}` : ""),
      );
    }
    times.sort((a, b) => a - b);
    console.log(
      `== ${voice}: median ${times[Math.floor(times.length / 2)]} ms, slowest ${times.at(-1)} ms, ` +
        `${chars} characters, ${bytes} bytes` +
        (transcribe ? `, heard back exactly ${same}/${SENTENCES.length}` : "") +
        "\n",
    );
  }
}

void main();
