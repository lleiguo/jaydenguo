import { z } from "zod";
import { api } from "@/server/http";
import { defaultLauncher } from "@/server/jobs/launcher";
import { retryVideoReview } from "@/server/video/store";

export const POST = api<{ id: string }>(async ({ db, params }) => {
  await retryVideoReview(db, z.uuid().parse(params.id), defaultLauncher());
  return Response.json({ started: true }, { status: 202 });
});
