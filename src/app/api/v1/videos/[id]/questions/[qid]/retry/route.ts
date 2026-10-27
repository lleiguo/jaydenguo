import { z } from "zod";
import { api } from "@/server/http";
import { defaultLauncher } from "@/server/jobs/launcher";
import { retryQuestion } from "@/server/video/questions";

// intent 0026, ASK-5: ask a failed question again.
export const POST = api<{ id: string; qid: string }>(async ({ db, params }) => {
  await retryQuestion(db, z.uuid().parse(params.id), z.uuid().parse(params.qid), defaultLauncher());
  return Response.json({ started: true }, { status: 202 });
});
