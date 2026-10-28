import { api, readJson } from "@/server/http";
import { settingsInput } from "@/server/settings-input";
import { getHomeAddress, getHomeTimeZone, setHomeAddress, setHomeTimeZone } from "@/server/settings";

const read = async (db: Parameters<typeof getHomeTimeZone>[0]) => ({
  homeTimeZone: await getHomeTimeZone(db),
  homeAddress: await getHomeAddress(db),
});

export const GET = api(async ({ db }) => Response.json(await read(db)));

// Either or both: the home time zone (CAL-9), home's address (intent 0027,
// TRF-R2).
export const PATCH = api(async ({ db, request }) => {
  const input = await readJson(request, settingsInput);
  if (input.homeTimeZone !== undefined) await setHomeTimeZone(db, input.homeTimeZone);
  if (input.homeAddress !== undefined) await setHomeAddress(db, input.homeAddress);
  return Response.json(await read(db));
});
