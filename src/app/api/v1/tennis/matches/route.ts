import { api, readJson } from "@/server/http";
import { addMatch, addMatchInput } from "@/server/tennis/mutations";

// TEN-8 / SYNC-6: add a match by hand.
export const POST = api(async ({ db, session, request }) => {
  const id = await addMatch(db, session.email, await readJson(request, addMatchInput));
  return Response.json({ id }, { status: 201 });
});
