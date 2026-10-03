import {
  assistantSettingsInput,
  getAssistantSettings,
  saveAssistantSettings,
} from "@/server/assistant/settings";
import { canAdd, checkAddCalendar } from "@/server/assistant/actions";
import { monthSpendUsd } from "@/server/assistant/turns";
import { quietApi } from "@/server/assistant/quiet";
import { readJson } from "@/server/http";

// Settings → Cookie (LIM-5, VOX-5, TOOL-17, CSEC-3).
export const GET = quietApi(async ({ db }) => {
  const settings = await getAssistantSettings(db);
  return Response.json({
    ...settings,
    monthSpendUsd: await monthSpendUsd(db, new Date()),
    // Intent 0008, GCW-8: whether she can add to the family calendar.
    canAdd: await canAdd(db, settings),
  });
});

export const PATCH = quietApi(async ({ db, request }) => {
  const patch = await readJson(request, assistantSettingsInput);
  await checkAddCalendar(db, patch.addCalendarSourceId);
  const settings = await saveAssistantSettings(db, patch);
  return Response.json({
    ...settings,
    monthSpendUsd: await monthSpendUsd(db, new Date()),
    canAdd: await canAdd(db, settings),
  });
});
