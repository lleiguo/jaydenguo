import { z } from "zod";
import { api } from "@/server/http";
import { sourceRuns } from "@/server/sources";

// Run history (SYNC-1): start, end, status and counts.
export const GET = api<{ id: string }>(async ({ db, params }) =>
  Response.json({ runs: await sourceRuns(db, z.uuid().parse(params.id)) }),
);
