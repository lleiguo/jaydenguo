import { api, readJson } from "@/server/http";
import { forgetLocation, locationInput, saveLocation } from "@/server/push/location";

// This phone's latest place, for "Time to leave" (intent 0027, TRF-A2).
export const POST = api(async ({ db, session, request }) =>
  Response.json(await saveLocation(db, session, await readJson(request, locationInput))),
);

export const DELETE = api(async ({ db, session }) => Response.json(await forgetLocation(db, session)));
