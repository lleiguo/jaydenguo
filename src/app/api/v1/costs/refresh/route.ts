import { api } from "@/server/http";
import { defaultLauncher } from "@/server/jobs/launcher";

// COST-5: read the billing export now.
export const POST = api(async () => {
  await defaultLauncher().start(["costs:sync"]);
  return Response.json({ started: true }, { status: 202 });
});
