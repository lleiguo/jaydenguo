// Response bodies of /api/v1, one named type per shape (intent 0004, API-4).
// `pnpm openapi` turns these into the schemas of openapi.json with the
// TypeScript checker, so they are whatever the loaders really return. Routes
// that build their payload inline check it with `satisfies`.
//
// Dates serialise as ISO strings. Only types (no values) live here.

import type { CalendarPayload, ClashView, EventView, Undo } from "@/lib/calendar-types";
import type { Person } from "@/domain/people";
import type { AskResult } from "../assistant/ask";
import type { Did } from "../assistant/actions";
import type { MemoryView } from "../assistant/memory";
import type { AssistantSettings } from "../assistant/settings";
import type { TurnView } from "../assistant/turns";
import type { listSessions } from "../auth/session";
import type { copyAccounts, CopySettings, setCopy } from "../calendar-copy";
import type { getSeries } from "../calendar/mutations";
import type { SchoolDay } from "../calendar/school-day";
import type { CostsView } from "../costs";
import type { CredentialView } from "../credentials/store";
import type { SuggestionView } from "../email/suggestions";
import type { createSource, listSources, RunView } from "../sources";
import type { EventDetail, listMeets, loadMeet, loadPersonalBests, ResultView } from "../swim/load";
import type {
  loadCalibration,
  loadPlayer,
  loadResults,
  loadTournament,
  PredictionView,
} from "../tennis/load";
import type { TennisCheckView } from "../tennis/check";
import type { EntryListView } from "../tennis/entry-list";
import type { DrawPrediction, TennisOverview } from "../tennis/overview";
import type { TodayView } from "../today";
import type { Detected, Review } from "../video/prompts";
import type { VideoReviewDetail, VideoReviewSummary } from "../video/store";

// Small acknowledgements shared by many routes.
export type Started = { started: true };
export type Accepted = { accepted: true };
export type Ok = { ok: true };
export type Created = { id: string };
export type UndoResponse = { undo: Undo };
// How many occurrences changed.
export type SkipRepeatsResponse = { undo: Undo; count: number };
export type ErrorResponse = { error: string; issues?: unknown };

// Calendar (CAL, CON)
export type { CalendarPayload, EventView, TodayView };
export type ChangesResponse = { cursor: number; changed: boolean };
export type DeletedEventsResponse = { events: EventView[] };
export type ClashWithEvents = ClashView & { eventA: EventView; eventB: EventView };
export type ClashesResponse = {
  clashes: ClashWithEvents[];
  open: number;
  homeTimeZone: string;
  people: Person[];
};
export type SeriesResponse = Awaited<ReturnType<typeof getSeries>>;
export type PeopleResponse = { people: Person[] };
export type SettingsResponse = { homeTimeZone: string };
export type SchoolTodayResponse = { schoolDay: SchoolDay | null; schoolDays: SchoolDay[] };

// Google Calendar copy (GCO)
export type CalendarCopyResponse = CopySettings & { accounts: Awaited<ReturnType<typeof copyAccounts>> };
export type CalendarCopySaved = Awaited<ReturnType<typeof setCopy>>;

// Sources, accounts, sessions (SYNC, CRED, AUTH)
export type SourcesResponse = { sources: Awaited<ReturnType<typeof listSources>> };
export type SourceCreated = Awaited<ReturnType<typeof createSource>>;
export type RunsResponse = { runs: RunView[] };
export type { CredentialView };
export type CredentialsResponse = { credentials: CredentialView[] };
export type SessionsResponse = { sessions: Awaited<ReturnType<typeof listSessions>> };
export type RevokedResponse = { revoked: number };
export type MeResponse = { email: string };
export type DeviceTokenResponse = { token: string; expiresAt: string };
export type HandoffResponse = { url: string; expiresAt: string };
export type { CostsView };

// Suggestions (EML)
export type SuggestionsResponse = { suggestions: SuggestionView[]; pending: number };
export type ApproveResponse = { eventId: string | null };
export type RejectedResponse = { rejected: true };

// Swimming (SWM)
export type SwimMeetsResponse = Awaited<ReturnType<typeof listMeets>>;
export type SwimMeetResponse = NonNullable<Awaited<ReturnType<typeof loadMeet>>>;
export type SwimEventResponse = EventDetail;
export type SwimPbsResponse = { pbs: Awaited<ReturnType<typeof loadPersonalBests>> };
export type SwimResultsResponse = { results: ResultView[] };

// Tennis (TEN)
type LoadedTournament = NonNullable<Awaited<ReturnType<typeof loadTournament>>>;
type LoadedPlayer = NonNullable<Awaited<ReturnType<typeof loadPlayer>>>;
export type { TennisOverview, TennisCheckView };
export type TennisTournamentResponse = {
  tournament: LoadedTournament["tournament"];
  matches: LoadedTournament["matches"];
  // One per draw: a prediction for his next match.
  drawPredictions: DrawPrediction[];
  // His entries there, with their acceptance lists (intent 0017, ACC-5).
  entries: EntryListView[];
};
export type TennisEntryResponse = EntryListView;
export type TennisPlayerResponse = {
  player: LoadedPlayer["player"];
  h2h: LoadedPlayer["h2h"];
  form: LoadedPlayer["form"];
  upcoming: LoadedPlayer["upcoming"];
  prediction: PredictionView | null;
  explanation: string | null;
};
export type TennisResultsResponse = Omit<Awaited<ReturnType<typeof loadResults>>, "data">;
export type TennisAccuracyResponse = Awaited<ReturnType<typeof loadCalibration>>;

// Notifications (intent 0004, PUSH-2, PUSH-3)
export type { DeviceSettings, NotificationView } from "../push/notify";

// Video reviews (VID, PLAY)
export type { VideoReviewDetail };
export type VideosResponse = { reviews: VideoReviewSummary[] };
export type { VideoReviewSummary };
export type VideoCreated = { id: string; status: string };
export type VideoRestored = { restored: true };
export type VideoSettingsResponse = { google: { drive: boolean; photos: boolean } };

// The JSON a review round holds, by `round` (VideoReviewDetail.rounds[].output
// and .combinedReview are sent as stored). Listed so the app can decode them:
// detect → DetectOutput, review and combinedReview → ReviewOutput.
export type DetectOutput = Detected;
export type ReviewOutput = Review;

// Cookie, the family assistant (intent 0007)
export type AssistantAnswer = AskResult;
export type AssistantTurnsResponse = { turns: TurnView[]; more: boolean };
// What an answer changed, with each event's state (intent 0008, ACT-1).
export type AssistantDid = Did;
// `monthSpendUsd` is estimated from tokens and list prices (LIM-6).
export type AssistantSettingsResponse = AssistantSettings & { monthSpendUsd: number; canAdd: boolean };
export type { MemoryView };
export type AssistantMemoriesResponse = { memories: MemoryView[] };
