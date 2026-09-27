import { z } from "zod";
import { HttpError } from "@/server/errors";
import { api } from "@/server/http";
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
  return Response.json({ player, h2h, form, upcoming, prediction: predictAgainst(data, key) });
});
