import type { CategoryMapping } from "../domain/categories";
import type { EmailMessage } from "./gmail";
import type { SwimBatch } from "../domain/swim-upsert";
import type { TennisBatch } from "../domain/tennis-upsert";
import type { SourceRecord, SyncWindow } from "../domain/upsert";

// The adapter contract (plan §2): fetch raw data, then normalise it into
// records with stable external IDs. Adapters never write to the database;
// the shared upsert engine does (src/server/sync/apply.ts). `normalise` is
// pure, so every adapter is tested from recorded fixtures (NFR-8).

export type AdapterSource = {
  id: string;
  name: string;
  config: Record<string, unknown>;
  mapping: CategoryMapping;
};

export type AdapterCredential = { kind: string; provider: string; username: string | null; secret: string };

// A tournament he's entered (tennis_tc, TEN-9..11): the sync reads its
// draws even before his profile lists it.
export type TennisEntryHint = {
  tournamentId: string;
  name: string;
  startDate: string;
  endDate: string;
  eventNo: string;
  eventName: string;
  tournamentPlayerId: string | null;
};

// A site that asks for a sign-in code (Veracross): the worker keeps the
// headless browser's cookies sealed between runs, so the site's "remember
// this device" holds, and, when the owner started the run, waits for the
// code they type on the Accounts page.
export type BrowserSession = {
  // Playwright storage state (JSON), or null before the first sign-in.
  load(): Promise<string | null>;
  save(state: string): Promise<void>;
  // Null on scheduled runs: nobody is there to type a code.
  waitForCode: (() => Promise<string | null>) | null;
};

export type AdapterContext = {
  source: AdapterSource;
  credential: AdapterCredential | null;
  now: Date;
  homeTimeZone: string;
  tennisEntries?: TennisEntryHint[];
  browserSession?: BrowserSession;
};

export type NormalisedBatch = {
  records: SourceRecord[];
  window: SyncWindow;
  warnings: string[];
  // Swim meets, entries and results (commit_swim), applied after the events.
  swim?: SwimBatch;
  // Tennis players, tournaments, draws and matches (tennis_tc), likewise.
  tennis?: TennisBatch;
  // Allow-listed emails (gmail), read into suggestions after the run.
  emails?: EmailMessage[];
};

export interface Adapter<Raw = unknown> {
  kind: string;
  label: string;
  // Credential kinds this adapter can use; empty means none needed.
  credentialKinds: string[];
  fetchRaw(ctx: AdapterContext): Promise<Raw>;
  normalise(raw: Raw, ctx: AdapterContext): NormalisedBatch;
}

// A failure the owner can act on, in plain language (SYNC-4).
export class SyncError extends Error {}
