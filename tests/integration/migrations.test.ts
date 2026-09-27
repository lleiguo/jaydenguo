import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runMigrations } from "@/server/db/migrate";

// Runs against the Postgres in DATABASE_URL (docker compose locally,
// a service container in CI).
describe("migrations", () => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const webRole = "hub_web_test";

  beforeAll(async () => {
    await pool.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${webRole}') THEN CREATE ROLE ${webRole}; END IF;
    END $$`);
    await runMigrations(undefined, webRole);
  });
  afterAll(async () => {
    await pool.end();
  });

  it("creates the core tables", async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public'",
    );
    const names = rows.map((r) => r.table_name);
    expect(names).toEqual(expect.arrayContaining(["users", "sources", "sync_runs", "audit_log"]));
  });

  it("is safe to run twice", async () => {
    await expect(runMigrations(undefined, webRole)).resolves.toBeUndefined();
  });

  it("gives the web user read/write but not ownership", async () => {
    const { rows } = await pool.query<{ can_write: boolean; can_drop: boolean }>(
      `select has_table_privilege($1, 'public.sources', 'INSERT') as can_write,
              pg_get_userbyid(c.relowner) = $1 as can_drop
       from pg_class c where c.relname = 'sources'`,
      [webRole],
    );
    expect(rows[0]).toEqual({ can_write: true, can_drop: false });
  });

  it("enforces allowed sync run statuses", async () => {
    const source = await pool.query<{ id: string }>(
      "insert into sources (kind, name) values ('ical', 'test') returning id",
    );
    await expect(
      pool.query("insert into sync_runs (source_id, trigger, status) values ($1, 'manual', 'bogus')", [
        source.rows[0].id,
      ]),
    ).rejects.toThrow();
  });

  it("enforces the tennis match rules", async () => {
    const source = await pool.query<{ id: string }>(
      "insert into sources (kind, name) values ('tennis_tc', 'test') returning id",
    );
    const sourceId = source.rows[0].id;
    const player = (member: string) =>
      pool
        .query<{ id: string }>(
          "insert into tennis_players (source_id, member_id, name) values ($1, $2, 'Test player') returning id",
          [sourceId, member],
        )
        .then((r) => r.rows[0].id);
    const a = await player("900001");
    const b = await player("900002");
    await expect(player("900001")).rejects.toThrow();

    const match = (side1: string, side2: string, extra: { winner?: number; externalId?: string } = {}) =>
      pool.query(
        `insert into tennis_matches (source_id, external_id, match_date, side1_player_id, side2_player_id, winner, outcome, origin)
         values ($1, $2, '2024-09-28', $3, $4, $5, 'played', 'source')`,
        [sourceId, extra.externalId ?? null, side1, side2, extra.winner ?? null],
      );
    await expect(match(a, a)).rejects.toThrow();
    await expect(match(a, b, { winner: 3 })).rejects.toThrow();
    await match(a, b, { winner: 1, externalId: "t1:1:900001:900002" });
    await expect(match(b, a, { externalId: "t1:1:900001:900002" })).rejects.toThrow();

    const { rows } = await pool.query<{ can_write: boolean }>(
      "select has_table_privilege($1, 'public.tennis_matches', 'INSERT') as can_write",
      [webRole],
    );
    expect(rows[0].can_write).toBe(true);
  });
});
