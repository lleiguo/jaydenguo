import { api } from "@/server/http";
import { mailScript, speechQuery } from "@/server/mail/speech";

// MA-1: the day's mail as parts to read aloud, in order.
export const GET = api(async ({ db, request }) => {
  const q = speechQuery.parse(Object.fromEntries(new URL(request.url).searchParams));
  return Response.json(await mailScript(db, new Date(), q.day));
});
