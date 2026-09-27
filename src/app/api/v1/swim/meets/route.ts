import { createMeet, createMeetInput } from "@/server/swim/mutations";
import { api, readJson } from "@/server/http";
import { listMeets } from "@/server/swim/load";

// SWM-2: upcoming and past meets, with entries and seed times.
export const GET = api(async ({ db }) => Response.json(await listMeets(db)));

// A meet the owner adds by hand (SYNC-6).
export const POST = api(async ({ db, request }) => {
  const id = await createMeet(db, await readJson(request, createMeetInput));
  return Response.json({ id }, { status: 201 });
});
