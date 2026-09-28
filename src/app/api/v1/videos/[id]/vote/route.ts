import { z } from "zod";
import { api, readJson } from "@/server/http";
import { voteInput, voteVideoReview } from "@/server/video/store";

// VID-3d: the parent's vote, stored once and never overwritten (409).
export const POST = api<{ id: string }>(async ({ db, params, request }) => {
  const { vote } = await readJson(request, voteInput);
  await voteVideoReview(db, z.uuid().parse(params.id), vote);
  return Response.json({ vote });
});
