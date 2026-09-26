import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb, createPool } from "./client";

// Applies all pending migrations. The same function runs locally, in CI
// and in production (as the `migrate` worker job).
export async function runMigrations(migrationsFolder = defaultFolder()) {
  const pool = await createPool();
  try {
    await migrate(createDb(pool), { migrationsFolder });
  } finally {
    await pool.end();
  }
}

function defaultFolder() {
  return process.env.MIGRATIONS_DIR ?? path.join(process.cwd(), "db", "migrations");
}
