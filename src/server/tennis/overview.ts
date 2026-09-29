import { ACTIVE_ENTRY } from "../../domain/tennis-entry";
import type { EntryStatus } from "../../domain/tennis-constants";
import type { DbOrTx } from "../db/client";
import { listEntries, type EntryView } from "./entries";
import { explanationsFor } from "./explain";
import {
  listTournaments,
  predictAgainst,
  type DrawView,
  type PredictionView,
  type TennisData,
  type TournamentView,
} from "./load";
import { upcomingRows, type UpcomingRow } from "./upcoming";

// Everything the Tennis page shows (TEN-2, TEN-3, TEN-6, TEN-9, TEN-10), for
// /api/v1/tennis/tournaments and the iPhone app (intent 0004, API-3).

export type TennisNextMatch = {
  tournament: { id: string; name: string };
  draw: DrawView;
  prediction: PredictionView | null;
  // Claude's plain-language summary of the prediction, once written.
  explanation: string | null;
};

// A prediction for his next match in one draw (null when the draw has no
// opponent yet), keyed by draw rather than by position, so clients never
// see a list with holes in it.
export type DrawPrediction = {
  drawId: string;
  prediction: PredictionView | null;
  explanation: string | null;
};

// Predictions for the given draws, with Claude's explanations where written.
export async function drawPredictions(
  db: DbOrTx,
  data: TennisData,
  draws: { id: string; opponentKey: string | null }[],
): Promise<DrawPrediction[]> {
  const predictions = draws.map((d) => (d.opponentKey ? predictAgainst(data, d.opponentKey) : null));
  const explanations = await explanationsFor(db, predictions);
  return draws.map((d, i) => ({
    drawId: d.id,
    prediction: predictions[i],
    explanation: (predictions[i] && explanations.get(predictions[i])) ?? null,
  }));
}

export type TennisOverview = {
  today: string;
  selfName: string | null;
  nextMatches: TennisNextMatch[];
  inProgress: TournamentView[];
  upcoming: TournamentView[];
  past: TournamentView[];
  // "Upcoming tournaments": every tournament he's registered for, with a
  // prediction per draw that has an opponent.
  upcomingRows: (UpcomingRow & { drawPredictions: DrawPrediction[] })[];
  // "Found for him": entries he isn't registered for yet.
  found: EntryView[];
};

export async function tennisOverview(db: DbOrTx): Promise<TennisOverview> {
  const { data, today, self, nextMatches, inProgress, upcoming, past } = await listTournaments(db);
  const predictions = nextMatches.map((n) =>
    n.draw.opponentKey ? predictAgainst(data, n.draw.opponentKey) : null,
  );
  const [explanations, entries] = await Promise.all([
    explanationsFor(db, predictions),
    listEntries(db, today),
  ]);
  return {
    today,
    selfName: self?.name ?? null,
    nextMatches: nextMatches.map((n, i) => ({
      ...n,
      prediction: predictions[i],
      explanation: (predictions[i] && explanations.get(predictions[i])) ?? null,
    })),
    inProgress,
    upcoming,
    past,
    upcomingRows: await Promise.all(
      upcomingRows(data.tournaments, entries, today).map(async (r) => ({
        ...r,
        drawPredictions: await drawPredictions(db, data, r.draws),
      })),
    ),
    found: entries.filter((e) => !ACTIVE_ENTRY.includes(e.status as EntryStatus)),
  };
}
