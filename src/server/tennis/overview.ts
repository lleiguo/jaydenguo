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

export type TennisOverview = {
  today: string;
  selfName: string | null;
  nextMatches: TennisNextMatch[];
  inProgress: TournamentView[];
  upcoming: TournamentView[];
  past: TournamentView[];
  // "Upcoming tournaments": every tournament he's registered for, with a
  // prediction per draw that has an opponent.
  upcomingRows: (UpcomingRow & { predictions: (PredictionView | null)[] })[];
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
    upcomingRows: upcomingRows(data.tournaments, entries, today).map((r) => ({
      ...r,
      predictions: r.draws.map((d) => (d.opponentKey ? predictAgainst(data, d.opponentKey) : null)),
    })),
    found: entries.filter((e) => !ACTIVE_ENTRY.includes(e.status as EntryStatus)),
  };
}
