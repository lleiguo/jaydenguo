import { z } from "zod";
import { HttpError } from "@/server/errors";
import { api } from "@/server/http";
import { loadMeet } from "@/server/swim/load";

// SWM-3: one meet with its swims, PB flags and change from the previous best.
export const GET = api<{ id: string }>(async ({ db, params }) => {
  const meet = await loadMeet(db, z.uuid().parse(params.id));
  if (!meet) throw new HttpError(404, "not found");
  return Response.json(meet);
});
