import { z } from "zod";
import { api } from "@/server/http";
import { useSourceValues } from "@/server/tennis/mutations";

// Drop a correction and show the site's result again.
export const POST = api<{ id: string }>(async ({ db, session, params }) => {
  await useSourceValues(db, session.email, z.uuid().parse(params.id));
  return new Response(null, { status: 204 });
});
