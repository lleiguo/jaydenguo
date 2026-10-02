import { ask, askInput } from "@/server/assistant/ask";
import { defaultAssistant, defaultWeb } from "@/server/assistant/default-model";
import { api, readJson } from "@/server/http";

// One question to Cookie (intent 0007, spec §4.1). Typed questions for
// now; voice joins in plan K5.
export const POST = api(async ({ db, request, session }) => {
  const input = await readJson(request, askInput);
  return Response.json(
    await ask(db, { model: defaultAssistant(), web: defaultWeb() }, { userId: session.userId, ...input }),
  );
});
