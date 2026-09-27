import { z } from "zod";
import { undoAcceptClash } from "@/server/calendar/mutations";
import { api } from "@/server/http";

export const POST = api<{ id: string }>(async ({ db, session, params }) => {
  await undoAcceptClash(db, session.email, z.uuid().parse(params.id));
  return new Response(null, { status: 204 });
});
