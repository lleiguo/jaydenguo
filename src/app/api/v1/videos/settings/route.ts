import { z } from "zod";
import { REVIEW_MODES } from "@/domain/video-constants";
import { api, readJson } from "@/server/http";
import { getReviewMode, setReviewMode, videoGoogleAccess } from "@/server/video/store";

// VID-3e: debate (default) or one model's review; and whether Google
// Drive and Photos are connected.
export const GET = api(async ({ db }) =>
  Response.json({ mode: await getReviewMode(db), google: await videoGoogleAccess(db) }),
);

export const PATCH = api(async ({ db, request }) => {
  const { mode } = await readJson(request, z.object({ mode: z.enum(REVIEW_MODES) }));
  await setReviewMode(db, mode);
  return Response.json({ mode });
});
