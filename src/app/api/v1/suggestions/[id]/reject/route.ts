import { z } from "zod";
import { api } from "@/server/http";
import { rejectSuggestion } from "@/server/email/suggestions";

export const POST = api<{ id: string }>(async ({ db, params }) => {
  await rejectSuggestion(db, z.uuid().parse(params.id));
  return Response.json({ rejected: true });
});
