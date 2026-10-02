import {
  assistantSettingsInput,
  getAssistantSettings,
  saveAssistantSettings,
} from "@/server/assistant/settings";
import { monthSpendUsd } from "@/server/assistant/turns";
import { api, readJson } from "@/server/http";

// Settings → Cookie (LIM-5, VOX-5, TOOL-17, CSEC-3).
export const GET = api(async ({ db }) =>
  Response.json({ ...(await getAssistantSettings(db)), monthSpendUsd: await monthSpendUsd(db, new Date()) }),
);

export const PATCH = api(async ({ db, request }) => {
  const patch = await readJson(request, assistantSettingsInput);
  return Response.json({
    ...(await saveAssistantSettings(db, patch)),
    monthSpendUsd: await monthSpendUsd(db, new Date()),
  });
});
