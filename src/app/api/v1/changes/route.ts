import { z } from "zod";
import { currentCursor } from "@/server/calendar/load";
import { api } from "@/server/http";

// CAL-8 live updates: open pages poll this every 10 s while visible and
// reload their data when the cursor moves.
export const GET = api(async ({ db, request }) => {
  const since = z.coerce.number().int().min(0).catch(0).parse(new URL(request.url).searchParams.get("since"));
  const cursor = await currentCursor(db);
  return Response.json({ cursor, changed: cursor > since });
});
