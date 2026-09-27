import { z } from "zod";
import { skipEvent } from "@/server/calendar/mutations";
import { api, readJson } from "@/server/http";

// CON-4 "skip this one" (or un-skip with {"skip": false}).
export const POST = api<{ id: string }>(async ({ db, session, params, request }) => {
  const { skip } = await readJson(request, z.object({ skip: z.boolean().default(true) }));
  const undo = await skipEvent(db, session.email, z.uuid().parse(params.id), skip);
  return Response.json({ undo });
});
