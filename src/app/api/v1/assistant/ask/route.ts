import { ask, askInput, clipOf, sharedOf } from "@/server/assistant/ask";
import { defaultAssistant, defaultTranscriber, defaultWeb } from "@/server/assistant/default-model";
import { fakeAdding } from "@/server/assistant/actions";
import { quietApi } from "@/server/assistant/quiet";
import { HttpError, readJson } from "@/server/http";
import { defaultLauncher } from "@/server/jobs/launcher";

// A recording and three pictures at their size limits, as base64 in JSON,
// with room to spare (intent 0019).
const MAX_BODY = 6 * 1024 * 1024;

// One question to Cookie (intent 0007, spec §4.1), typed or spoken. A
// recording is held in memory for this request only (CSEC-2).
export const POST = quietApi(async ({ db, request, session }) => {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY)
    throw new HttpError(413, "that's too big to send");
  const { audio, images, pasted, ...input } = await readJson(request, askInput);
  return Response.json(
    await ask(
      db,
      {
        model: defaultAssistant(),
        transcribe: defaultTranscriber(),
        web: defaultWeb(),
        // Worker jobs: writing an added event to Google (intent 0008; not
        // while adding is faked locally) and reading an email (intent 0009).
        launch: (args) =>
          fakeAdding() && args[0] === "assistant:actions" ? Promise.resolve() : defaultLauncher().start(args),
      },
      {
        userId: session.userId,
        ...input,
        audio: audio && clipOf(audio),
        shared: sharedOf({ images, pasted }),
      },
    ),
  );
});
