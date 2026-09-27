import { api, readJson } from "@/server/http";
import { listResults } from "@/server/swim/load";
import { addResult, addResultInput } from "@/server/swim/mutations";

// Every swim, newest first, with PB flags (SWM-3).
export const GET = api(async ({ db }) => Response.json({ results: await listResults(db) }));

// SWM-7 / SYNC-6: add a result by hand.
export const POST = api(async ({ db, session, request }) => {
  const id = await addResult(db, session.email, await readJson(request, addResultInput));
  return Response.json({ id }, { status: 201 });
});
