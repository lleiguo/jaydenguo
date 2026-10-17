import { api } from "@/server/http";
import { applyHeld } from "@/server/household-sync";
import { defaultLauncher } from "@/server/jobs/launcher";

// TWSEC-2: "Apply" a run that was held.
export const POST = api(async ({ db }) => {
  await applyHeld(db, defaultLauncher());
  return Response.json({ started: true }, { status: 202 });
});
