import { z } from "zod";
import { api, HttpError } from "@/server/http";
import { deleteVideoReview, getVideoReview } from "@/server/video/store";

// One review with every round (VID-3, VID-5: the page polls it for progress).
export const GET = api<{ id: string }>(async ({ db, params }) => {
  const review = await getVideoReview(db, z.uuid().parse(params.id));
  if (!review) throw new HttpError(404, "not found");
  return Response.json(review);
});

// VID-4: soft delete; restore brings it back.
export const DELETE = api<{ id: string }>(async ({ db, params }) => {
  await deleteVideoReview(db, z.uuid().parse(params.id));
  return new Response(null, { status: 204 });
});
