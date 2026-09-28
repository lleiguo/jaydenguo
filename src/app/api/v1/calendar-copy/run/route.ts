import { api, HttpError } from "@/server/http";
import { getCopySettings } from "@/server/calendar-copy";
import { defaultLauncher } from "@/server/jobs/launcher";

// "Copy now".
export const POST = api(async ({ db }) => {
  if (!(await getCopySettings(db)).enabled) throw new HttpError(409, "The calendar copy is switched off.");
  await defaultLauncher().start(["calendar:copy"]);
  return Response.json({ started: true }, { status: 202 });
});
