import { api } from "@/server/http";
import { defaultLauncher } from "@/server/jobs/launcher";
import type { TennisCheckView } from "@/server/tennis/check";
import { requestCheck } from "@/server/tennis/check";

// TPR-1..4: pull to refresh on the Tennis screen. Starts the quick check
// (202), or answers with the last one when it's running or under 5 minutes
// old (200, `recent: true`).
export const POST = api(async ({ db }) => {
  const { check, started } = await requestCheck(db, defaultLauncher());
  return Response.json(check satisfies TennisCheckView, { status: started ? 202 : 200 });
});
