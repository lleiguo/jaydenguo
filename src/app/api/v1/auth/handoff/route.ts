import { handoffInput, startHandoff } from "@/server/auth/device";
import { appUrl } from "@/server/config";
import { api, readJson } from "@/server/http";

// intent 0004, API-5: a single-use link (a minute) that opens a browser-only
// flow, such as connecting a Google account, signed in.
export const POST = api(async ({ db, session, request }) => {
  const result = await startHandoff(db, session, await readJson(request, handoffInput), appUrl().origin);
  return Response.json(result, { status: 201 });
});
