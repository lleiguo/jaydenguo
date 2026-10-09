import { z } from "zod";
import { api } from "@/server/http";
import { getCheck, type TennisCheckView } from "@/server/tennis/check";

// TPR-1: how a quick check is going, for the app to follow.
export const GET = api<{ id: string }>(async ({ db, params }) =>
  Response.json((await getCheck(db, z.uuid().parse(params.id))) satisfies TennisCheckView),
);
