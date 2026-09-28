import { api, readJson } from "@/server/http";
import { copyAccounts, copyInput, getCopySettings, setCopy } from "@/server/calendar-copy";
import { defaultLauncher } from "@/server/jobs/launcher";

// GCO-1, GCO-2: the Google Calendar copy, its account and last run.
export const GET = api(async ({ db }) =>
  Response.json({ ...(await getCopySettings(db)), accounts: await copyAccounts(db) }),
);

// Switch on with an account, or off keeping or deleting the copy.
export const PATCH = api(async ({ db, request }) => {
  const saved = await setCopy(db, await readJson(request, copyInput), defaultLauncher());
  return Response.json(saved);
});
