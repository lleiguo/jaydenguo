import { api, readJson } from "@/server/http";
import {
  getHouseholdSync,
  householdSources,
  householdSyncInput,
  setHouseholdSync,
} from "@/server/household-sync";
import { defaultLauncher } from "@/server/jobs/launcher";

// Intent 0020, TWO-9: two-way sync with the household calendar, what a dry
// run would do, a held run and the last run.
export const GET = api(async ({ db }) =>
  Response.json({ ...(await getHouseholdSync(db)), sources: await householdSources(db) }),
);

// Off, Dry run or On, and which calendar.
export const PATCH = api(async ({ db, request }) => {
  const saved = await setHouseholdSync(db, await readJson(request, householdSyncInput), defaultLauncher());
  return Response.json(saved);
});
