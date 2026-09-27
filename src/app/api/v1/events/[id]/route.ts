import { z } from "zod";
import { loadEvent } from "@/server/calendar/load";
import { deleteEvent, eventInput, updateEvent } from "@/server/calendar/mutations";
import { HttpError } from "@/server/errors";
import { api, readJson } from "@/server/http";

type P = { id: string };
const id = (p: P) => z.uuid().parse(p.id);

export const GET = api<P>(async ({ db, params }) => {
  const event = await loadEvent(db, id(params));
  if (!event) throw new HttpError(404, "not found");
  return Response.json(event);
});

export const PATCH = api<P>(async ({ db, session, params, request }) => {
  await updateEvent(db, session.email, id(params), await readJson(request, eventInput));
  return new Response(null, { status: 204 });
});

// Soft delete; restore with POST …/restore.
export const DELETE = api<P>(async ({ db, session, params }) => {
  await deleteEvent(db, session.email, id(params));
  return Response.json({ undo: { method: "POST", url: `/api/v1/events/${params.id}/restore` } });
});
