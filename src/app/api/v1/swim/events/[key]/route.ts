import { HttpError } from "@/server/errors";
import { api } from "@/server/http";
import { loadEvent } from "@/server/swim/load";

// SWM-4, SWM-5: one event and course (e.g. 200-im-LCM): every swim, the PB
// line, and the forecast (an estimate).
export const GET = api<{ key: string }>(async ({ db, params }) => {
  const detail = await loadEvent(db, params.key);
  if (!detail) throw new HttpError(404, "not found");
  return Response.json(detail);
});
