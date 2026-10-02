import { and, eq, isNull, sql } from "drizzle-orm";
import { assistantTurns } from "@db/schema";
import { capState, spokenText, VOICE_LIMITS, type Language } from "@/domain/assistant";
import { hit } from "../auth/rate-limit";
import type { Db } from "../db/client";
import { HttpError } from "../errors";
import { LlmError } from "../llm/types";
import { getAssistantSettings } from "./settings";
import { monthSpendUsd, type AssistantSource } from "./turns";

// Cookie's voice (intent 0007, VOX-5; plan SP-C3): Google Cloud
// Text-to-Speech reads the answer. The audio is made on request, sent, and
// kept nowhere (CSEC-2).

export type SpeechRequest = { text: string; language: Language | null; voice?: string };

export type SpeechAudio = {
  data: Buffer;
  mimeType: "audio/mpeg";
  voice: string;
  chars: number;
  costUsd: number;
};

export type Speech = (request: SpeechRequest) => Promise<SpeechAudio>;

// The voice's short name: a Chirp 3 HD voice ("Leda"), or an older one
// with its family ("Wavenet-A").
export const ASSISTANT_VOICE = () => process.env.ASSISTANT_VOICE || "Leda";

// List prices per character (Text-to-Speech pricing page, 2026-10-02).
// The first million characters a month are free for Chirp 3 HD; Cookie
// counts them at full price so the cap errs on the safe side.
const PER_CHAR = { chirp: 30 / 1e6, other: 16 / 1e6 };

// The same speaker exists per language: Mandarin's reads a sentence with
// English words in it, English's reads English.
export function voiceFor(voice: string, language: Language | null): { name: string; languageCode: string } {
  const languageCode = language === "zh" || language === "mixed" ? "cmn-CN" : "en-US";
  const family = /^(Wavenet|Standard|Neural2)-/.test(voice) ? voice : `Chirp3-HD-${voice}`;
  return { name: `${languageCode}-${family}`, languageCode };
}

export const speechCostUsd = (voice: string, chars: number) =>
  Math.round(chars * (voice.includes("Chirp3") ? PER_CHAR.chirp : PER_CHAR.other) * 10_000) / 10_000;

type Requester = (body: unknown) => Promise<{ status: number; data: unknown }>;

async function googleRequester(): Promise<Requester> {
  const { GoogleAuth } = await import("google-auth-library");
  const client = await new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  }).getClient();
  return async (body) => {
    const res = await client.request({
      url: "https://texttospeech.googleapis.com/v1/text:synthesize",
      method: "POST",
      data: body,
      validateStatus: () => true,
      // Someone is waiting, and the phone's own voice is the fallback.
      timeout: 8000,
      retry: false,
    });
    return { status: res.status, data: res.data };
  };
}

export function googleSpeech(request?: Requester): Speech {
  let requester = request;
  return async ({ text, language, voice = ASSISTANT_VOICE() }) => {
    const chosen = voiceFor(voice, language);
    let res;
    try {
      requester ??= await googleRequester();
      res = await requester({
        input: { text },
        voice: chosen,
        audioConfig: { audioEncoding: "MP3" },
      });
    } catch {
      throw new LlmError("unavailable", "Text-to-Speech didn't answer.");
    }
    const audio = (res.data as { audioContent?: unknown } | null)?.audioContent;
    if (res.status !== 200 || typeof audio !== "string" || !audio) {
      console.error(
        JSON.stringify({ severity: "ERROR", message: "assistant speech failed", status: res.status }),
      );
      throw new LlmError(res.status === 429 ? "quota" : "unavailable", "Text-to-Speech didn't answer.");
    }
    return {
      data: Buffer.from(audio, "base64"),
      mimeType: "audio/mpeg",
      voice: chosen.name,
      chars: text.length,
      costUsd: speechCostUsd(chosen.name, text.length),
    };
  };
}

// A quarter of a second of tone, for ASSISTANT_LLM=fake and tests.
const BEEP =
  "//MoxAALwALNv0EYAqkAZLh/+AAD4Pg+D58EIPg+CDjkuD4Pg/wQdg+f/5QP8HDmIAf1g4cyAP8CO5/oaUoF//4NAE9feP39//MoxAwQMOaIAZuQADCi84RmBhkcYogUUPHFQHyDeEPhAcYt6ADqHcxAhzhzij/kVIqZF4vf+iiYiI99YKiI9/BVhAAJBG/5//MoxAYMkGJiGd0IAv/6yy3yGlpKSBgCmDQ3mnwqHDI8GJYoGFQNmCQdkoFqwy24eJ//7/9/v//71SAABA4IYGB///5Yxp3V//MoxA4QIGo9vt+0gIVKoQAYNFDBkEzPuMZijozhRPjAmA1BxY6G8yZsOPL1gadtDPu+v/Gfz37f6qqv///+5SAABJBEJAB8//MoxAgOaGJZvg9ySsA1diDS00AqBZgYJhlj8RsoOBg2CphhmlMX+ZvOWwz61O2PXpd/Iet3//r+j2oT91NaqAAAFtsEFnBH//MoxAkMCF5qXgm4Qs5lSh8IYuRBADVITggYH0qyARJ/UNwW+/07Jj9n7P/+z///V/+j9NX///+vG5c+ygBZQRgOmBuCuYWI//MoxBMMwG5MAV4YAZ2Ys6wJmFArGDEBkYCAFRgGAxGAAAkYDAAidEIl9Pbn//8s4Ws9nXsbaYYIIGBGJ/RsDFY4B9MYXj4x//MoxBsTyR6AAZuYAGANmJ9SAIGIHNAFbAMPJP/FbidyuQ//yDm5mRc3//My+brL5/9YPic//wfLvD//5c0TGvSqJmbkt2////MoxAYMmFLRucMYA9mZmXZmYwoCBGCgoKDHeCgo38QUGf+IKd/QUGO/EFG/+JvvxBQo78QYK/4stUxBTUU0LjBVVVVVVVVV";

export const fakeSpeech: Speech = async ({ text, language }) => ({
  data: Buffer.from(BEEP, "base64"),
  mimeType: "audio/mpeg",
  voice: voiceFor("Fake", language).name,
  chars: text.length,
  costUsd: speechCostUsd("Chirp3", text.length),
});

// GET /turns/{id}/speech: one of this account's answers, read aloud.
// Anything but audio tells the app to use the phone's own voice: spoken
// answers switched off, 80% of the month's cap spent (LIM-5), or
// Text-to-Speech not answering.
export async function speakTurn(
  db: Db,
  deps: { speech: Speech; now?: Date },
  input: { userId: string; turnId: string },
): Promise<SpeechAudio> {
  const now = deps.now ?? new Date();
  const [turn] = await db
    .select({
      answer: assistantTurns.answer,
      language: assistantTurns.language,
      sources: assistantTurns.sources,
    })
    .from(assistantTurns)
    .where(
      and(
        eq(assistantTurns.id, input.turnId),
        eq(assistantTurns.userId, input.userId),
        isNull(assistantTurns.textClearedAt),
      ),
    );
  const language = (turn?.language ?? null) as Language | null;
  const fromWeb = ((turn?.sources ?? []) as AssistantSource[]).some((s) => s.kind === "web");
  const text = spokenText(turn?.answer ?? "", language, fromWeb);
  if (!text) throw new HttpError(404, "not found");

  const settings = await getAssistantSettings(db);
  if (!settings.speak) throw new HttpError(409, "spoken answers are switched off");
  if (capState(await monthSpendUsd(db, now), settings.monthlyCapUsd) !== "ok")
    throw new HttpError(409, "Cookie is near this month's limit, so the phone reads the answer");
  const under = await hit(
    db,
    `assistant:speech:${input.userId}`,
    VOICE_LIMITS.perAccount.limit,
    VOICE_LIMITS.perAccount.windowMs,
  );
  if (!under) throw new HttpError(429, "too many spoken answers; try again in a few minutes");

  let audio;
  try {
    audio = await deps.speech({ text, language });
  } catch (err) {
    if (!(err instanceof LlmError)) throw err;
    throw new HttpError(503, "Cookie's voice isn't answering");
  }
  // LIM-6: read twice, counted twice.
  await db
    .update(assistantTurns)
    .set({
      speechChars: sql`${assistantTurns.speechChars} + ${audio.chars}`,
      costUsd: sql`${assistantTurns.costUsd} + ${audio.costUsd}`,
    })
    .where(eq(assistantTurns.id, input.turnId));
  // No words, only numbers (CSEC-7).
  console.log(
    JSON.stringify({
      severity: "INFO",
      message: "assistant speech",
      turnId: input.turnId,
      chars: audio.chars,
      bytes: audio.data.length,
    }),
  );
  return audio;
}
