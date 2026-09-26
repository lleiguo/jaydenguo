import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { createDb, createPool } from "./client";

// Applies all pending migrations, then grants the web service's database
// user read/write access. The same function runs locally, in CI and in
// production (as the `migrate` worker job, which owns the schema).
export async function runMigrations(migrationsFolder = defaultFolder(), webDbUser = process.env.WEB_DB_USER) {
  const pool = await createPool();
  try {
    await migrate(createDb(pool), { migrationsFolder });
    if (webDbUser) await grantWebAccess(pool, webDbUser);
  } finally {
    await pool.end();
  }
}

export function webGrantStatements(webDbUser: string): string[] {
  const role = pg.escapeIdentifier(webDbUser);
  return [
    `GRANT USAGE ON SCHEMA public TO ${role}`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`,
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role}`,
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${role}`,
  ];
}

async function grantWebAccess(pool: pg.Pool, webDbUser: string) {
  for (const statement of webGrantStatements(webDbUser)) await pool.query(statement);
}

function defaultFolder() {
  return process.env.MIGRATIONS_DIR ?? path.join(process.cwd(), "db", "migrations");
}
