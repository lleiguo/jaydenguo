import { api } from "@/server/http";
import { defaultLauncher } from "@/server/jobs/launcher";
import { requestMailRefresh } from "@/server/mail/view";

// MD-2: pull to refresh reads the email source again.
export const POST = api(async ({ db }) => {
  await requestMailRefresh(db, defaultLauncher());
  return Response.json({ started: true }, { status: 202 });
});
