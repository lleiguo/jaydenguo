import { ask, askInput, clipOf } from "@/server/assistant/ask";
import { defaultAssistant, defaultTranscriber, defaultWeb } from "@/server/assistant/default-model";
import { api, HttpError, readJson } from "@/server/http";

// A recording at the size limit, as base64 in JSON, with room to spare.
const MAX_BODY = 2 * 1024 * 1024;

// One question to Cookie (intent 0007, spec §4.1), typed or spoken. A
// recording is held in memory for this request only (CSEC-2).
export const POST = api(async ({ db, request, session }) => {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY)
    throw new HttpError(413, "that recording is too big");
  const { audio, ...input } = await readJson(request, askInput);
  return Response.json(
    await ask(
      db,
      { model: defaultAssistant(), transcribe: defaultTranscriber(), web: defaultWeb() },
      { userId: session.userId, ...input, audio: audio && clipOf(audio) },
    ),
  );
});
