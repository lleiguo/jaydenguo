import { defaultSpeech } from "@/server/assistant/default-model";
import { speakTurn } from "@/server/assistant/speech";
import { idOf, quietApi } from "@/server/assistant/quiet";

// VOX-5: the answer of one of this account's turns as speech. Made on
// request and stored nowhere (CSEC-2); any error tells the app to use the
// phone's own voice.
export const GET = quietApi<{ id: string }>(async ({ db, params, session }) => {
  const audio = await speakTurn(
    db,
    { speech: defaultSpeech() },
    { userId: session.userId, turnId: idOf(params) },
  );
  return new Response(new Uint8Array(audio.data), {
    headers: {
      "Content-Type": audio.mimeType,
      "Content-Length": String(audio.data.length),
      "Cache-Control": "private, no-store",
    },
  });
});
