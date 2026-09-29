import { z } from "zod";
import { ownersInput, setOwners } from "@/server/calendar/mutations";
import { api, readJson } from "@/server/http";

// Whose event it is: {"ownerIds": [<people.id>, …]}.
export const POST = api<{ id: string }>(async ({ db, session, params, request }) => {
  const { ownerIds } = await readJson(request, ownersInput);
  const undo = await setOwners(db, session.email, z.uuid().parse(params.id), ownerIds);
  return Response.json({ undo });
});
