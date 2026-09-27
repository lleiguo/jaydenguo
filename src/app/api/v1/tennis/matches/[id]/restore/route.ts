import { z } from "zod";
import { api } from "@/server/http";
import { restoreMatch } from "@/server/tennis/mutations";

export const POST = api<{ id: string }>(async ({ db, session, params }) => {
  await restoreMatch(db, session.email, z.uuid().parse(params.id));
  return new Response(null, { status: 204 });
});
