import { createSeries, seriesInput } from "@/server/calendar/mutations";
import { api, readJson } from "@/server/http";

// CAL-5 repeating events.
export const POST = api(async ({ db, session, request }) => {
  const id = await createSeries(db, session.email, await readJson(request, seriesInput));
  return Response.json({ id }, { status: 201 });
});
