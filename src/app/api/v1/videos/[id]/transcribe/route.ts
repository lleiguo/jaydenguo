import { z } from "zod";
import { clipOf } from "@/server/assistant/ask";
import { defaultTranscriber } from "@/server/assistant/default-model";
import { quietApi } from "@/server/assistant/quiet";
import { HttpError, readJson } from "@/server/http";
import { transcribeInput, transcribeQuestion } from "@/server/video/questions";

// A recording at its size limit, as base64 in JSON, with room to spare.
const MAX_BODY = 2 * 1024 * 1024;

// intent 0026, ASK-10: a spoken question, as words for the question box.
// The recording is held in memory for this request only (ASKSEC-3), and
// the request is logged without its body.
export const POST = quietApi<{ id: string }>(async ({ db, params, request }) => {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY)
    throw new HttpError(413, "that's too big to send");
  const { audio } = await readJson(request, transcribeInput);
  return Response.json(
    await transcribeQuestion(db, z.uuid().parse(params.id), clipOf(audio), defaultTranscriber()),
  );
});
