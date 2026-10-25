import { z } from "zod";
import { defaultSpeech } from "@/server/assistant/default-model";
import { api } from "@/server/http";
import { speakMailPart, speechQuery } from "@/server/mail/speech";

// MA-2: one part of the day's mail as speech, made on request and stored
// nowhere. Any error tells the app to read it with the phone's own voice.
export const GET = api<{ part: string }>(async ({ db, params, request, session }) => {
  const q = speechQuery.parse(Object.fromEntries(new URL(request.url).searchParams));
  const part = z.union([z.enum(["intro", "others", "todos"]), z.uuid()]).parse(params.part);
  const audio = await speakMailPart(
    db,
    { speech: defaultSpeech() },
    { userId: session.userId, part, day: q.day },
  );
  return new Response(new Uint8Array(audio.data), {
    headers: {
      "Content-Type": audio.mimeType,
      "Content-Length": String(audio.data.length),
      "Cache-Control": "private, no-store",
    },
  });
});
