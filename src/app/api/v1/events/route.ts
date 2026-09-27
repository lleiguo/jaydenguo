import { z } from "zod";
import { loadCalendar, loadDeleted } from "@/server/calendar/load";
import { createEvent, eventInput } from "@/server/calendar/mutations";
import { HttpError } from "@/server/errors";
import { api, readJson } from "@/server/http";

// GET ?from=…&to=… : events, clashes and closures in a range.
// GET ?deleted=1   : the "Deleted" view (CAL-6).
export const GET = api(async ({ db, request }) => {
  const q = new URL(request.url).searchParams;
  if (q.get("deleted") === "1") return Response.json({ events: await loadDeleted(db) });
  const range = z
    .object({ from: z.coerce.date(), to: z.coerce.date() })
    .refine((r) => r.to > r.from && r.to.getTime() - r.from.getTime() <= 400 * 86_400_000)
    .safeParse({ from: q.get("from"), to: q.get("to") });
  if (!range.success) throw new HttpError(400, "give from and to, at most 400 days apart");
  return Response.json(await loadCalendar(db, range.data.from, range.data.to));
});

export const POST = api(async ({ db, session, request }) => {
  const id = await createEvent(db, session.email, await readJson(request, eventInput));
  return Response.json({ id }, { status: 201 });
});
