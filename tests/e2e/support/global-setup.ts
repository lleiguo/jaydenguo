import pg from "pg";
import { runMigrations } from "../../../src/server/db/migrate";

export default async function globalSetup() {
  await runMigrations();
  // Sign-in tests go through the login rate limiter; start each run clean.
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  await pool.query("delete from rate_limits");
  await pool.end();
}
