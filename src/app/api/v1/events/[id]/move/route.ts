import { z } from "zod";
import { moveEvent, moveInput } from "@/server/calendar/mutations";
import { api, readJson } from "@/server/http";

// CON-3: move an event (drag and drop or "Move to…"). Returns how to undo.
export const POST = api<{ id: string }>(async ({ db, session, params, request }) => {
  const undo = await moveEvent(
    db,
    session.email,
    z.uuid().parse(params.id),
    await readJson(request, moveInput),
  );
  return Response.json({ undo });
});
