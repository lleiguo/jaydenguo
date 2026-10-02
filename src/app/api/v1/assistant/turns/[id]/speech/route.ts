import { z } from "zod";
import { defaultSpeech } from "@/server/assistant/default-model";
import { speakTurn } from "@/server/assistant/speech";
import { api, HttpError } from "@/server/http";

// VOX-5: the answer of one of this account's turns as speech. Made on
// request and stored nowhere (CSEC-2); any error tells the app to use the
// phone's own voice.
export const GET = api<{ id: string }>(async ({ db, params, session }) => {
  if (!z.uuid().safeParse(params.id).success) throw new HttpError(404, "not found");
  const audio = await speakTurn(
    db,
    { speech: defaultSpeech() },
    { userId: session.userId, turnId: params.id },
  );
  return new Response(new Uint8Array(audio.data), {
    headers: {
      "Content-Type": audio.mimeType,
      "Content-Length": String(audio.data.length),
      "Cache-Control": "private, no-store",
    },
  });
});
