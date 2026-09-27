import { z } from "zod";
import { api, readJson } from "@/server/http";
import { getHomeTimeZone, setHomeTimeZone } from "@/server/settings";
import { isValidTimeZone } from "@/domain/time";

export const GET = api(async ({ db }) => Response.json({ homeTimeZone: await getHomeTimeZone(db) }));

export const PATCH = api(async ({ db, request }) => {
  const input = await readJson(
    request,
    z.object({ homeTimeZone: z.string().refine(isValidTimeZone, "unknown time zone") }),
  );
  await setHomeTimeZone(db, input.homeTimeZone);
  return Response.json({ homeTimeZone: input.homeTimeZone });
});
