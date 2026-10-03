import {
  assistantSettingsInput,
  getAssistantSettings,
  saveAssistantSettings,
} from "@/server/assistant/settings";
import { checkAddCalendar } from "@/server/assistant/actions";
import { monthSpendUsd } from "@/server/assistant/turns";
import { quietApi } from "@/server/assistant/quiet";
import { readJson } from "@/server/http";

// Settings → Cookie (LIM-5, VOX-5, TOOL-17, CSEC-3).
export const GET = quietApi(async ({ db }) =>
  Response.json({ ...(await getAssistantSettings(db)), monthSpendUsd: await monthSpendUsd(db, new Date()) }),
);

export const PATCH = quietApi(async ({ db, request }) => {
  const patch = await readJson(request, assistantSettingsInput);
  await checkAddCalendar(db, patch.addCalendarSourceId);
  return Response.json({
    ...(await saveAssistantSettings(db, patch)),
    monthSpendUsd: await monthSpendUsd(db, new Date()),
  });
});
