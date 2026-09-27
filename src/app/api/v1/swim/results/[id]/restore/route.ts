import { z } from "zod";
import { api } from "@/server/http";
import { restoreResult } from "@/server/swim/mutations";

export const POST = api<{ id: string }>(async ({ db, session, params }) => {
  await restoreResult(db, session.email, z.uuid().parse(params.id));
  return new Response(null, { status: 204 });
});
