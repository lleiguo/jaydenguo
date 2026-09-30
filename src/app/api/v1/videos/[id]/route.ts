import { z } from "zod";
import { api, HttpError } from "@/server/http";
import { defaultLauncher } from "@/server/jobs/launcher";
import { changeSportInput, changeVideoSport, deleteVideoReview, getVideoReview } from "@/server/video/store";

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

// intent 0005, SPT-5, SPT-6: set the sport; a finished review can be run again.
export const PATCH = api<{ id: string }>(async ({ db, params, request }) => {
  const input = changeSportInput.parse(await request.json());
  return Response.json(await changeVideoSport(db, z.uuid().parse(params.id), input, defaultLauncher()));
});
