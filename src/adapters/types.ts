import type { CategoryMapping } from "../domain/categories";
import type { SwimBatch } from "../domain/swim-upsert";
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

export type AdapterContext = {
  source: AdapterSource;
  credential: AdapterCredential | null;
  now: Date;
  homeTimeZone: string;
};

export type NormalisedBatch = {
  records: SourceRecord[];
  window: SyncWindow;
  warnings: string[];
  // Swim meets, entries and results (commit_swim), applied after the events.
  swim?: SwimBatch;
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
