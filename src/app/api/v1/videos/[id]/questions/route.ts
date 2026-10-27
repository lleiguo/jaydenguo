import { z } from "zod";
import { api, readJson } from "@/server/http";
import { defaultLauncher } from "@/server/jobs/launcher";
import { askQuestion, askQuestionInput } from "@/server/video/questions";

// intent 0026, ASK-1, ASK-3: ask about a finished review; the answer comes
// from a worker job, and the review's page follows it.
export const POST = api<{ id: string }>(async ({ db, params, request }) => {
  const input = await readJson(request, askQuestionInput);
  const question = await askQuestion(db, z.uuid().parse(params.id), input, defaultLauncher());
  return Response.json(question, { status: 202 });
});
