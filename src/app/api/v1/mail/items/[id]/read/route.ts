import { z } from "zod";
import { api } from "@/server/http";
import { markMailRead } from "@/server/mail/view";

// MD-6: this parent has seen the summary.
export const POST = api<{ id: string }>(async ({ db, params, session }) => {
  await markMailRead(db, session.userId, z.uuid().parse(params.id));
  return new Response(null, { status: 204 });
});
