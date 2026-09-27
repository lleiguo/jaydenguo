import { z } from "zod";
import { api, readJson } from "@/server/http";
import { correctResult, correctResultInput, deleteResult } from "@/server/swim/mutations";

type P = { id: string };
const id = (p: P) => z.uuid().parse(p.id);

// SWM-7: correct a result. The correction survives every later sync.
export const PATCH = api<P>(async ({ db, session, params, request }) => {
  await correctResult(db, session.email, id(params), await readJson(request, correctResultInput));
  return new Response(null, { status: 204 });
});

// Soft delete; restore with POST …/restore.
export const DELETE = api<P>(async ({ db, session, params }) => {
  await deleteResult(db, session.email, id(params));
  return Response.json({ undo: { method: "POST", url: `/api/v1/swim/results/${params.id}/restore` } });
});
