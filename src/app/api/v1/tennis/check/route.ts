import { api } from "@/server/http";
import { defaultLauncher } from "@/server/jobs/launcher";
import type { TennisCheckView } from "@/server/tennis/check";
import { requestCheck } from "@/server/tennis/check";

// TPR-1..4: pull to refresh on the Tennis screen. Starts the quick check,
// or answers with the last one when it's running or under 5 minutes old
// (`recent: true`). Always 202, so the app has one answer to read.
export const POST = api(async ({ db }) => {
  const { check } = await requestCheck(db, defaultLauncher());
  return Response.json(check satisfies TennisCheckView, { status: 202 });
});
