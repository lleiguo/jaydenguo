// Tennis (plan M3.2, spec §7.1, TEN-2..8). Like swimming, nothing here is
// hard-deleted: a tournament or match that disappears from the source is
// marked `cancelled`, a manual delete sets `deleted_at`, and every change to
// a match is written to `tennis_match_revisions`. Ratings and predictions
// aren't stored; they're computed from the matches (src/domain/glicko2.ts),
// so a correction can never leave a stale rating behind.
//
// Privacy: other players are children too. Only what TEN-2..7 need is kept
// about them: name, club, member number and results.
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { ENTRY_STATUSES, MATCH_OUTCOMES } from "../../src/domain/tennis-constants";
import { sources, syncRuns } from "./core";

const ts = (name: string) => timestamp(name, { withTimezone: true });
const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(", "));

export const tennisPlayers = pgTable(
  "tennis_players",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Null for opponents the owner typed in by hand.
    sourceId: uuid("source_id").references(() => sources.id),
    // The Tennis Canada member number (stable across tournaments).
    memberId: text("member_id"),
    name: text("name").notNull(),
    club: text("club"),
    // The site's profile page ID, once known.
    profileId: text("profile_id"),
    // The player this site is about.
    isSelf: boolean("is_self").notNull().default(false),
    // When this player's own profile and results were last read (one hop).
    profileFetchedAt: ts("profile_fetched_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("tennis_players_source_member_uq").on(t.sourceId, t.memberId),
    index("tennis_players_name_idx").on(t.name),
  ],
);

export const tennisTournaments = pgTable(
  "tennis_tournaments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id").references(() => sources.id),
    externalId: text("external_id"),
    name: text("name").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    venue: text("venue"),
    city: text("city"),
    region: text("region"),
    entryDeadline: date("entry_deadline"),
    categories: text("categories")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // He's entered (as opposed to a tournament only an opponent played).
    entered: boolean("entered").notNull().default(false),
    sourceUrl: text("source_url"),
    sourceHash: text("source_hash"),
    status: text("status").notNull().default("active"),
    deletedAt: ts("deleted_at"),
    lastSyncedAt: ts("last_synced_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("tennis_tournaments_source_external_uq").on(t.sourceId, t.externalId),
    index("tennis_tournaments_start_idx").on(t.startDate),
    check("tennis_tournaments_status_chk", sql`${t.status} in ('active', 'cancelled')`),
    check("tennis_tournaments_dates_chk", sql`${t.endDate} >= ${t.startDate}`),
  ],
);

// The draws he's in (TEN-3): his position and next match, worked out at
// sync time from the published draw. Other players in the draw aren't
// stored here beyond the next opponent's name.
export const tennisDraws = pgTable(
  "tennis_draws",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tournamentId: uuid("tournament_id")
      .notNull()
      .references(() => tennisTournaments.id),
    drawNo: text("draw_no").notNull(),
    eventName: text("event_name"),
    drawName: text("draw_name"),
    // bracket: a knockout draw whose rounds halve; other: compass, round
    // robin and the like.
    kind: text("kind").notNull().default("other"),
    size: integer("size"),
    position: integer("position"),
    seed: text("seed"),
    // { status, round, opponent, feeders, date, time } (src/domain/tennis-draw.ts).
    nextMatch: jsonb("next_match"),
    sourceUrl: text("source_url"),
    // withdrawn: the source stopped listing him in this draw.
    status: text("status").notNull().default("active"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("tennis_draws_tournament_draw_uq").on(t.tournamentId, t.drawNo),
    check("tennis_draws_kind_chk", sql`${t.kind} in ('bracket', 'other')`),
    check("tennis_draws_status_chk", sql`${t.status} in ('active', 'withdrawn')`),
  ],
);

// One match (TEN-4, TEN-5, TEN-7), his or (one hop) an opponent's. Sides
// are in the site's order. Like swim results, the row holds what the site
// shows; once the owner corrects it (TEN-8), sync only updates
// `source_values` and sets `source_disagrees` when they differ.
export const tennisMatches = pgTable(
  "tennis_matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id").references(() => sources.id),
    externalId: text("external_id"),
    tournamentId: uuid("tournament_id").references(() => tennisTournaments.id),
    drawNo: text("draw_no"),
    eventName: text("event_name"),
    round: text("round"),
    matchDate: date("match_date").notNull(),
    // When the site publishes a start time.
    scheduledAt: ts("scheduled_at"),
    side1: uuid("side1_player_id")
      .notNull()
      .references(() => tennisPlayers.id),
    side1Partner: uuid("side1_partner_id").references(() => tennisPlayers.id),
    side2: uuid("side2_player_id")
      .notNull()
      .references(() => tennisPlayers.id),
    side2Partner: uuid("side2_partner_id").references(() => tennisPlayers.id),
    // 1 or 2; null until played.
    winner: smallint("winner"),
    // Games per set in side order: [[6, 4], [3, 6], [10, 8]].
    sets: jsonb("sets")
      .notNull()
      .default(sql`'[]'::jsonb`),
    outcome: text("outcome").notNull(),
    origin: text("origin").notNull(),
    status: text("status").notNull().default("active"),
    sourceValues: jsonb("source_values"),
    sourceHash: text("source_hash"),
    correctedAt: ts("corrected_at"),
    correctedBy: text("corrected_by"),
    sourceDisagrees: boolean("source_disagrees").notNull().default(false),
    notes: text("notes"),
    deletedAt: ts("deleted_at"),
    lastSyncedAt: ts("last_synced_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("tennis_matches_source_external_uq").on(t.sourceId, t.externalId),
    index("tennis_matches_side1_idx").on(t.side1, t.matchDate),
    index("tennis_matches_side2_idx").on(t.side2, t.matchDate),
    index("tennis_matches_tournament_idx").on(t.tournamentId),
    check("tennis_matches_winner_chk", sql`${t.winner} is null or ${t.winner} in (1, 2)`),
    check("tennis_matches_outcome_chk", sql`${t.outcome} in (${inList(MATCH_OUTCOMES)})`),
    check("tennis_matches_origin_chk", sql`${t.origin} in ('source', 'manual')`),
    check("tennis_matches_status_chk", sql`${t.status} in ('active', 'cancelled')`),
    check("tennis_matches_sides_chk", sql`${t.side1} <> ${t.side2}`),
  ],
);

export const tennisMatchRevisions = pgTable(
  "tennis_match_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    matchId: uuid("match_id")
      .notNull()
      .references(() => tennisMatches.id),
    changedAt: ts("changed_at").notNull().defaultNow(),
    // "sync" or the owner's email.
    changedBy: text("changed_by").notNull(),
    action: text("action").notNull(),
    syncRunId: uuid("sync_run_id").references(() => syncRuns.id),
    before: jsonb("before"),
    after: jsonb("after"),
  },
  (t) => [index("tennis_match_revisions_match_idx").on(t.matchId, t.changedAt)],
);

// Claude's plain-language explanation of a prediction (TEN-6, plan M3.6),
// written from the computed numbers only and stored so each set of numbers
// is explained once. `inputs` is exactly what was sent: numbers, no names.
export const tennisExplanations = pgTable(
  "tennis_explanations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // sha256 of the prompt version and the inputs.
    inputsHash: text("inputs_hash").notNull(),
    inputs: jsonb("inputs").notNull(),
    promptVersion: text("prompt_version").notNull(),
    model: text("model").notNull(),
    text: text("text").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("tennis_explanations_hash_uq").on(t.inputsHash)],
);

// Tournament entries (TEN-9..11): events the Thursday job found for him,
// whether he's entered, and where the Friday acceptance list puts him. One
// row per tournament and event. Only tournament facts and his own status
// are kept; other players on entry lists aren't stored.
export const tennisEntries = pgTable(
  "tennis_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id),
    tournamentExternalId: text("tournament_external_id").notNull(),
    tournamentName: text("tournament_name").notNull(),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    venue: text("venue"),
    city: text("city"),
    region: text("region"),
    entryDeadline: date("entry_deadline"),
    eventNo: text("event_no").notNull(),
    eventName: text("event_name").notNull(),
    // Driving time from home, and whether it's an estimate (no route found).
    driveMinutes: integer("drive_minutes"),
    driveEstimated: boolean("drive_estimated").notNull().default(false),
    status: text("status").notNull().default("found"),
    reservePosition: integer("reserve_position"),
    // A plain-language line for the page, e.g. why it wasn't entered.
    note: text("note"),
    // His number in this tournament, once an entry list shows him.
    tournamentPlayerId: text("tournament_player_id"),
    tournamentUrl: text("tournament_url").notNull(),
    entryUrl: text("entry_url"),
    enteredAt: ts("entered_at"),
    listCheckedAt: ts("list_checked_at"),
    // The draw watch: when his draw was first seen, and when a full sync
    // after that succeeded (the watch stops then).
    drawSeenAt: ts("draw_seen_at"),
    drawSyncedAt: ts("draw_synced_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("tennis_entries_source_event_uq").on(t.sourceId, t.tournamentExternalId, t.eventNo),
    index("tennis_entries_start_idx").on(t.startDate),
    check("tennis_entries_status_chk", sql`${t.status} in (${inList(ENTRY_STATUSES)})`),
    check("tennis_entries_dates_chk", sql`${t.endDate} >= ${t.startDate}`),
  ],
);
