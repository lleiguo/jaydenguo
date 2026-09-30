import { z } from "zod";
import { api, HttpError } from "@/server/http";
import { getNotification } from "@/server/push/notify";

// PUSH-2: the text of a notification, for the app's extension (the push
// itself carries only the id).
export const GET = api<{ id: string }>(async ({ db, params }) => {
  const n = await getNotification(db, z.uuid().parse(params.id));
  if (!n) throw new HttpError(404, "not found");
  return Response.json(n);
});
