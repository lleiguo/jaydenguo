import { z } from "zod";
import { skipRepeats } from "@/server/calendar/mutations";
import { api, readJson } from "@/server/http";

// CON-4 "skip every repeat" (or un-skip them with {"skip": false}).
export const POST = api<{ id: string }>(async ({ db, session, params, request }) => {
  const { skip } = await readJson(request, z.object({ skip: z.boolean().default(true) }));
  return Response.json(await skipRepeats(db, session.email, z.uuid().parse(params.id), skip));
});
