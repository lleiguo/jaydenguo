import { z } from "zod";
import { personWithEmail } from "@/domain/categories";
import { loadCalendar } from "@/server/calendar/load";
import { createEvent, eventInput } from "@/server/calendar/mutations";
import { HttpError } from "@/server/errors";
import { api, readJson } from "@/server/http";
import { listPeopleEmails } from "@/server/people";

// GET ?from=…&to=…: events, clashes and closures in a range. Deleted events
// are at /api/v1/events/deleted (CAL-6).
export const GET = api(async ({ db, session, request }) => {
  const q = new URL(request.url).searchParams;
  const range = z
    .object({ from: z.coerce.date(), to: z.coerce.date() })
    .refine((r) => r.to > r.from && r.to.getTime() - r.from.getTime() <= 400 * 86_400_000)
    .safeParse({ from: q.get("from"), to: q.get("to") });
  if (!range.success) throw new HttpError(400, "give from and to, at most 400 days apart");
  const [cal, emails] = await Promise.all([
    loadCalendar(db, range.data.from, range.data.to),
    listPeopleEmails(db),
  ]);
  return Response.json({ ...cal, me: personWithEmail(session.email, emails) });
});

export const POST = api(async ({ db, session, request }) => {
  const id = await createEvent(db, session.email, await readJson(request, eventInput));
  return Response.json({ id }, { status: 201 });
});
