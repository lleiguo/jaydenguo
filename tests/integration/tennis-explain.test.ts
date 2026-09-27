import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sources, tennisExplanations, tennisPlayers } from "@db/schema";
import { createDb, createPool, type PoolHandle } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { createLogger } from "@/server/log";
import {
  claudeExplainer,
  explainNextMatches,
  explanationInputs,
  explanationsFor,
  inputsHash,
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  type Explained,
  type Explainer,
  type ExplanationInputs,
} from "@/server/tennis/explain";
import { listTournaments, predictAgainst } from "@/server/tennis/load";
import { syncSource } from "@/worker/sync";
import { createFakeTc, TC_NOW, TC_PROFILE_URL } from "../e2e/support/fake-tc";

// Plan M3.6: Claude's explanation of a prediction, from the numbers only,
// stored with its prompt version. Replays a recorded Vertex response by
// default; `RECORD_LLM=1` (with VERTEX_PROJECT set) calls Claude and
// records it again. Only the fixture's made-up numbers are ever sent.

const FIXTURE = "tests/fixtures/llm/tennis-explain.json";
type Recording = {
  // False for a hand-written stand-in (see its note), true once recorded.
  recorded: boolean;
  note?: string;
  promptVersion: string;
  inputsHash: string;
  inputs: ExplanationInputs;
  response: Explained;
};

function recordedExplainer(): Explainer {
  if (process.env.RECORD_LLM === "1") {
    const live = claudeExplainer();
    if (!live)
      throw new Error("RECORD_LLM=1 needs VERTEX_PROJECT (and gcloud application-default credentials)");
    return async (inputs) => {
      const response = await live(inputs);
      if (!response) throw new Error("Claude declined or returned nothing");
      const recording: Recording = {
        recorded: true,
        promptVersion: PROMPT_VERSION,
        inputsHash: inputsHash(inputs),
        inputs,
        response,
      };
      writeFileSync(FIXTURE, `${JSON.stringify(recording, null, 2)}\n`);
      return response;
    };
  }
  if (!existsSync(FIXTURE)) throw new Error(`${FIXTURE} is missing: record it with RECORD_LLM=1`);
  const recording = JSON.parse(readFileSync(FIXTURE, "utf8")) as Recording;
  return async (inputs) => {
    // A different prompt or different numbers need a new recording.
    expect(inputsHash(inputs)).toBe(recording.inputsHash);
    return recording.response;
  };
}

describe("tennis prediction explanations", () => {
  let handle: PoolHandle;
  let db: ReturnType<typeof createDb>;
  let server: Server;
  const lines: string[] = [];
  const log = createLogger((l) => lines.push(l));

  beforeAll(async () => {
    await runMigrations();
    handle = await createPool();
    db = createDb(handle.pool);
    // Start from no tennis data: predictions use every source's matches.
    await handle.pool.query(`delete from event_revisions where event_id in
      (select e.id from events e join sources s on s.id = e.source_id where s.kind = 'tennis_tc')`);
    await handle.pool.query(
      `delete from events where source_id in (select id from sources where kind = 'tennis_tc')`,
    );
    for (const t of [
      "tennis_explanations",
      "tennis_match_revisions",
      "tennis_matches",
      "tennis_draws",
      "tennis_tournaments",
      "tennis_players",
    ])
      await handle.pool.query(`delete from ${t}`);
    process.env.SYNC_MIN_GAP_MINUTES = "0";
    server = createFakeTc();
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.TENNIS_TC_BASE_URL = base;
    process.env.TENNIS_TC_NOW = TC_NOW.toISOString();
    const [s] = await db
      .insert(sources)
      .values({
        kind: "tennis_tc",
        name: "Tennis",
        config: { profileUrl: TC_PROFILE_URL(base) },
        categoryMapping: { default: "tennis" },
      })
      .returning();
    // No VERTEX_PROJECT here, so the sync itself explains nothing.
    expect(await syncSource(db, s.id, "manual", log, () => TC_NOW)).toMatchObject({ status: "succeeded" });
  }, 60_000);
  afterAll(async () => {
    server.close();
    for (const k of ["TENNIS_TC_BASE_URL", "TENNIS_TC_NOW", "SYNC_MIN_GAP_MINUTES"]) delete process.env[k];
    await handle.close();
  });

  it("sends Claude numbers only and stores the paragraph with the prompt version", async () => {
    const { data, nextMatches } = await listTournaments(db);
    expect(nextMatches).toHaveLength(1);
    const prediction = predictAgainst(data, nextMatches[0].draw.opponentKey!)!;
    const inputs = explanationInputs(prediction);
    expect(inputs).toMatchSnapshot("inputs");
    expect(SYSTEM_PROMPT).toMatchSnapshot("system prompt");
    // No names of any player, in the inputs or the prompt.
    const names = (await db.select({ name: tennisPlayers.name }).from(tennisPlayers)).map((p) => p.name);
    const sent = JSON.stringify(inputs) + SYSTEM_PROMPT;
    for (const n of names) expect(sent).not.toContain(n);

    expect(await explainNextMatches(db, recordedExplainer(), log)).toEqual({ explained: 1 });
    const [row] = await db.select().from(tennisExplanations);
    expect(row).toMatchObject({ promptVersion: PROMPT_VERSION, inputsHash: inputsHash(inputs), inputs });
    expect(row.model).toMatch(/^claude-/);
    expect(row.text).toContain(`${inputs.winProbabilityPercent}%`);
    expect(row.text.split(/\s+/).length).toBeLessThanOrEqual(110);
    expect(row.text).toMatchSnapshot("explanation");

    // Shown on the page from the store; the same numbers aren't sent twice.
    expect((await explanationsFor(db, [prediction])).get(prediction)).toBe(row.text);
    expect(
      await explainNextMatches(
        db,
        async () => {
          throw new Error("should not be called");
        },
        log,
      ),
    ).toEqual({ explained: 0 });
  });

  it("does nothing when Claude on Vertex isn't configured", async () => {
    expect(await explainNextMatches(db, null, log)).toEqual({ explained: 0, skipped: "not configured" });
  });
});
