import { z } from "zod";
import { resetEvent } from "@/server/calendar/mutations";
import { api } from "@/server/http";

// Back to the source's time: clears the owner's override.
export const POST = api<{ id: string }>(async ({ db, session, params }) => {
  await resetEvent(db, session.email, z.uuid().parse(params.id));
  return new Response(null, { status: 204 });
});
