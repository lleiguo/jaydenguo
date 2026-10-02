import { z } from "zod";
import { VIDEO_SPORTS } from "@/domain/video-constants";
import { getVideoReview, listVideoReviews } from "../../video/store";
import { problem, type Tool } from "./types";

const input = z.object({
  sport: z.enum(VIDEO_SPORTS).optional(),
  id: z.string().uuid().optional().describe("One review's id, from the list, to read its points"),
});

const MAX_REVIEWS = 10;

// TOOL-6: technique reviews of videos. Always AI feedback, never a coach's
// assessment (CHR-5).
export const videosTool: Tool<z.infer<typeof input>> = {
  name: "videos",
  kind: "hub",
  label: "Videos",
  description:
    "Video technique reviews: the latest reviews (date filmed, sport, note, status), or one review's points with `id`. The reviews are AI feedback, not a coach's assessment: say so.",
  input,
  async run(ctx, q) {
    if (q.id) {
      const r = await getVideoReview(ctx.db, q.id);
      if (!r || r.deletedAt) return problem("no review with that id");
      return {
        filmedOn: r.filmedOn,
        sport: r.sport,
        note: r.note,
        status: r.status,
        aiFeedback: r.combinedReview ?? undefined,
        failed: r.errorMessage ?? undefined,
      };
    }
    const reviews = await listVideoReviews(ctx.db, { sport: q.sport });
    return {
      reviews: reviews.slice(0, MAX_REVIEWS).map((r) => ({
        id: r.id,
        filmedOn: r.filmedOn,
        sport: r.sport,
        note: r.note,
        status: r.status,
      })),
      more: reviews.length > MAX_REVIEWS || undefined,
    };
  },
};
