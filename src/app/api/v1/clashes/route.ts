import { z } from "zod";
import { loadCalendar } from "@/server/calendar/load";
import { acceptClash } from "@/server/calendar/mutations";
import { api, readJson } from "@/server/http";

// CON-2: upcoming clashes (next 60 days by default), each with its events.
export const GET = api(async ({ db, request }) => {
  const days = z.coerce
    .number()
    .int()
    .min(1)
    .max(365)
    .catch(60)
    .parse(new URL(request.url).searchParams.get("days"));
  const from = new Date();
  const cal = await loadCalendar(db, from, new Date(from.getTime() + days * 86_400_000));
  const byId = new Map(cal.events.map((e) => [e.id, e]));
  const clashes = cal.clashes
    .map((c) => ({ ...c, eventA: byId.get(c.a), eventB: byId.get(c.b) }))
    .filter((c) => c.eventA && c.eventB && (new Date(c.eventA.end) > from || new Date(c.eventB.end) > from))
    .sort((x, y) => x.eventA!.start.localeCompare(y.eventA!.start));
  return Response.json({
    clashes,
    open: clashes.filter((c) => !c.acceptedId).length,
    homeTimeZone: cal.homeTimeZone,
  });
});

// CON-4 "accept clash".
export const POST = api(async ({ db, session, request }) => {
  const { a, b } = await readJson(request, z.object({ a: z.uuid(), b: z.uuid() }));
  return Response.json({ undo: await acceptClash(db, session.email, a, b) });
});
