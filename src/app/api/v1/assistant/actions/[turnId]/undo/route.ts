import { z } from "zod";
import { fakeAdding, undoTurn } from "@/server/assistant/actions";
import { defaultLauncher } from "@/server/jobs/launcher";
import { quietApi } from "@/server/assistant/quiet";
import { HttpError } from "@/server/http";

// Intent 0008, ACT-3: take back what one answer changed, for ten minutes.
export const POST = quietApi<{ turnId: string }>(async ({ db, params, session }) => {
  if (!z.uuid().safeParse(params.turnId).success) throw new HttpError(404, "not found");
  const launch = fakeAdding() ? undefined : (args: string[]) => defaultLauncher().start(args);
  return Response.json(await undoTurn(db, session.userId, params.turnId, new Date(), launch));
});
