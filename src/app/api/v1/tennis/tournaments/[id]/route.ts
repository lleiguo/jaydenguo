import { z } from "zod";
import { HttpError } from "@/server/errors";
import { api } from "@/server/http";
import type { TennisTournamentResponse } from "@/server/openapi/responses";
import { loadTournament } from "@/server/tennis/load";
import { drawPredictions } from "@/server/tennis/overview";

// TEN-2, TEN-3, TEN-6: one tournament, his draws with predictions, his matches.
export const GET = api<{ id: string }>(async ({ db, params }) => {
  const loaded = await loadTournament(db, z.uuid().parse(params.id));
  if (!loaded) throw new HttpError(404, "not found");
  const { data, tournament, matches } = loaded;
  // Only a draw he's still in, with a next opponent, gets a prediction.
  const draws = tournament.draws.map((d) => ({
    id: d.id,
    opponentKey: d.status === "active" && d.next?.status === "next" ? d.opponentKey : null,
  }));
  return Response.json({
    tournament,
    matches,
    drawPredictions: await drawPredictions(db, data, draws),
  } satisfies TennisTournamentResponse);
});
