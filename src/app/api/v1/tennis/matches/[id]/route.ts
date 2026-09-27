import { z } from "zod";
import { api, readJson } from "@/server/http";
import { correctMatch, correctMatchInput, deleteMatch } from "@/server/tennis/mutations";

type P = { id: string };
const id = (p: P) => z.uuid().parse(p.id);

// TEN-8: correct a score or time. The correction survives every later sync.
export const PATCH = api<P>(async ({ db, session, params, request }) => {
  await correctMatch(db, session.email, id(params), await readJson(request, correctMatchInput));
  return new Response(null, { status: 204 });
});

// Soft delete; restore with POST …/restore.
export const DELETE = api<P>(async ({ db, session, params }) => {
  await deleteMatch(db, session.email, id(params));
  return Response.json({ undo: { method: "POST", url: `/api/v1/tennis/matches/${params.id}/restore` } });
});
