import { z } from "zod";
import { HttpError } from "@/server/errors";
import { api } from "@/server/http";
import type { TennisPlayerResponse } from "@/server/openapi/responses";
import { explanationsFor } from "@/server/tennis/explain";
import { loadPlayer, predictAgainst } from "@/server/tennis/load";

// TEN-4, TEN-5, TEN-6: an opponent's meetings with him, their form, and a prediction.
export const GET = api<{ key: string }>(async ({ db, params }) => {
  const key = z
    .string()
    .regex(/^[0-9a-f-]{1,40}$/i)
    .parse(params.key);
  const loaded = await loadPlayer(db, key);
  if (!loaded || loaded.player.isSelf) throw new HttpError(404, "not found");
  const { data, player, h2h, form, upcoming } = loaded;
  const prediction = predictAgainst(data, key);
  const explanation = prediction ? ((await explanationsFor(db, [prediction])).get(prediction) ?? null) : null;
  return Response.json({
    player,
    h2h,
    form,
    upcoming,
    prediction,
    explanation,
  } satisfies TennisPlayerResponse);
});
