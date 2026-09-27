import { z } from "zod";
import { HttpError } from "@/server/errors";
import { api } from "@/server/http";
import { loadTournament, predictAgainst } from "@/server/tennis/load";

// TEN-2, TEN-3, TEN-6: one tournament, his draws with predictions, his matches.
export const GET = api<{ id: string }>(async ({ db, params }) => {
  const loaded = await loadTournament(db, z.uuid().parse(params.id));
  if (!loaded) throw new HttpError(404, "not found");
  const { data, tournament, matches } = loaded;
  const predictions = tournament.draws.map((d) =>
    d.status === "active" && d.next?.status === "next" && d.opponentKey
      ? predictAgainst(data, d.opponentKey)
      : null,
  );
  return Response.json({ tournament, matches, predictions });
});
