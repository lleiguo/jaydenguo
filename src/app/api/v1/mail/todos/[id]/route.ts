import { z } from "zod";
import { api } from "@/server/http";
import { setTodoDone, todoPatch } from "@/server/mail/view";

// MT-2: tick or untick a to-do, for both parents.
export const PATCH = api<{ id: string }>(async ({ db, params, request, session }) => {
  const { done } = todoPatch.parse(await request.json());
  return Response.json(await setTodoDone(db, session.email, z.uuid().parse(params.id), done));
});
