import { z } from "zod";
import { api, readJson } from "@/server/http";
import { updateSource, updateSourceInput } from "@/server/sources";

// Sources are switched off rather than deleted, so their events stay (CAL-6).
export const PATCH = api<{ id: string }>(async ({ db, params, request }) => {
  await updateSource(db, z.uuid().parse(params.id), await readJson(request, updateSourceInput));
  return new Response(null, { status: 204 });
});
