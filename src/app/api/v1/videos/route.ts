import { z } from "zod";
import { VIDEO_SPORTS } from "@/domain/video-constants";
import { api, readJson } from "@/server/http";
import { defaultLauncher } from "@/server/jobs/launcher";
import { createVideoInput, createVideoReview, listVideoReviews } from "@/server/video/store";

// VID-4: the history, newest first, per sport (?sport=tennis) or all;
// ?deleted=1 lists deleted reviews for restoring.
export const GET = api(async ({ db, request }) => {
  const params = new URL(request.url).searchParams;
  const sport = z
    .enum(VIDEO_SPORTS)
    .optional()
    .parse(params.get("sport") ?? undefined);
  const reviews = await listVideoReviews(db, { sport, deleted: params.get("deleted") === "1" });
  return Response.json({ reviews });
});

// VID-1: save a link (or start a Google Photos pick) and start the review.
export const POST = api(async ({ db, request }) => {
  const review = await createVideoReview(db, await readJson(request, createVideoInput), defaultLauncher());
  return Response.json(review, { status: 201 });
});
