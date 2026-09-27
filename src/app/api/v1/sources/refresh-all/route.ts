import { api } from "@/server/http";
import { defaultLauncher } from "@/server/jobs/launcher";
import { requestRefreshAll } from "@/server/sources";

// Sources synced within the last hour are skipped by the worker (SYNC-5).
export const POST = api(async () => {
  await requestRefreshAll(defaultLauncher());
  return Response.json({ started: true }, { status: 202 });
});
