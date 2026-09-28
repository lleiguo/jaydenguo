import { z } from "zod";
import { api } from "@/server/http";
import { restoreVideoReview } from "@/server/video/store";

export const POST = api<{ id: string }>(async ({ db, params }) => {
  await restoreVideoReview(db, z.uuid().parse(params.id));
  return Response.json({ restored: true });
});
