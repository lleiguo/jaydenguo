import { z } from "zod";
import { requestTest } from "@/server/credentials/store";
import { defaultLauncher } from "@/server/jobs/launcher";
import { api } from "@/server/http";

// Starts a "Test connection" job; the result appears on the credential.
export const POST = api<{ id: string }>(async ({ db, session, params }) => {
  await requestTest(db, session.email, z.uuid().parse(params.id), defaultLauncher());
  return Response.json({ started: true }, { status: 202 });
});
