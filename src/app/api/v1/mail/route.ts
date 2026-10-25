import { api } from "@/server/http";
import { loadMail, mailQuery } from "@/server/mail/view";

// Intent 0025, MD-5: today's mail and the days still kept, with the to-dos.
export const GET = api(async ({ db, request, session }) => {
  const q = mailQuery.parse(Object.fromEntries(new URL(request.url).searchParams));
  return Response.json(await loadMail(db, session.userId, new Date(), q.days));
});
