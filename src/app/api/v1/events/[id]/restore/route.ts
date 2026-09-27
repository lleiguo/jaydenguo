import { z } from "zod";
import { restoreEvent } from "@/server/calendar/mutations";
import { api } from "@/server/http";

export const POST = api<{ id: string }>(async ({ db, session, params }) => {
  await restoreEvent(db, session.email, z.uuid().parse(params.id));
  return new Response(null, { status: 204 });
});
