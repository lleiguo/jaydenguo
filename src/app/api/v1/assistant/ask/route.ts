import { ask, askInput, clipOf } from "@/server/assistant/ask";
import { defaultAssistant, defaultTranscriber, defaultWeb } from "@/server/assistant/default-model";
import { fakeAdding } from "@/server/assistant/actions";
import { quietApi } from "@/server/assistant/quiet";
import { HttpError, readJson } from "@/server/http";
import { defaultLauncher } from "@/server/jobs/launcher";

// A recording at the size limit, as base64 in JSON, with room to spare.
const MAX_BODY = 2 * 1024 * 1024;

// One question to Cookie (intent 0007, spec §4.1), typed or spoken. A
// recording is held in memory for this request only (CSEC-2).
export const POST = quietApi(async ({ db, request, session }) => {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY)
    throw new HttpError(413, "that recording is too big");
  const { audio, ...input } = await readJson(request, askInput);
  return Response.json(
    await ask(
      db,
      {
        model: defaultAssistant(),
        transcribe: defaultTranscriber(),
        web: defaultWeb(),
        // Intent 0008: the worker writes an added event to Google.
        launch: fakeAdding() ? undefined : (args) => defaultLauncher().start(args),
      },
      { userId: session.userId, ...input, audio: audio && clipOf(audio) },
    ),
  );
});
