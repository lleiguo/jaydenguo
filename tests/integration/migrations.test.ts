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
});
