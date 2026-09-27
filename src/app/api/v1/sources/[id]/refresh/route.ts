import { z } from "zod";
import { api } from "@/server/http";
import { defaultLauncher } from "@/server/jobs/launcher";
import { requestRefresh } from "@/server/sources";

export const POST = api<{ id: string }>(async ({ db, params }) => {
  await requestRefresh(db, z.uuid().parse(params.id), defaultLauncher());
  return Response.json({ started: true }, { status: 202 });
});
