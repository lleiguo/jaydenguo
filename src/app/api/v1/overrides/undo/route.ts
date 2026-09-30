import { undoOverrides, undoOverridesInput } from "@/server/calendar/mutations";
import { api, readJson } from "@/server/http";

// Undo for "skip every repeat": clears the overrides it wrote.
export const POST = api(async ({ db, session, request }) => {
  const { ids } = await readJson(request, undoOverridesInput);
  await undoOverrides(db, session.email, ids);
  return new Response(null, { status: 204 });
});
