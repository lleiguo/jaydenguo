import { z } from "zod";
import { api, readJson } from "@/server/http";
import { defaultLauncher } from "@/server/jobs/launcher";
import { startSenderCheck, updateSource, updateSourceInput } from "@/server/sources";

// Sources are switched off rather than deleted, so their events stay (CAL-6).
export const PATCH = api<{ id: string }>(async ({ db, params, request }) => {
  const id = z.uuid().parse(params.id);
  const { sendersChanged } = await updateSource(db, id, await readJson(request, updateSourceInput));
  if (sendersChanged) await startSenderCheck(db, id, defaultLauncher());
  return new Response(null, { status: 204 });
});
