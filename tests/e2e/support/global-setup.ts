import pg from "pg";
import { runMigrations } from "../../../src/server/db/migrate";

export default async function globalSetup() {
  await runMigrations();
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    // Sign-in tests go through the login rate limiter; start each run clean.
    await pool.query("delete from rate_limits");
    // Calendar tests use far-future weeks of their own (support/calendar.ts).
    // Clear them so local re-runs start empty; this database is only for tests.
    const inTestWeeks = `select id from events where start_utc >= '2027-03-01' and start_utc < '2027-04-01'
                          or start_utc >= '2028-01-01' and start_utc < '2028-04-01'`;
    await pool.query(
      `delete from conflicts where event_a in (${inTestWeeks}) or event_b in (${inTestWeeks})`,
    );
    await pool.query(`delete from event_overrides where event_id in (${inTestWeeks})`);
    await pool.query(`delete from event_revisions where event_id in (${inTestWeeks})`);
    await pool.query(`delete from events where id in (${inTestWeeks})`);
    // Swimming tests sync the same fixture into fresh sources; start with no
    // swim data so PBs aren't shared with an earlier run's copies.
    const swimEvents = `select e.id from events e join sources s on s.id = e.source_id where s.kind = 'commit_swim'`;
    await pool.query(`delete from event_overrides where event_id in (${swimEvents})`);
    await pool.query(`delete from event_revisions where event_id in (${swimEvents})`);
    await pool.query(`delete from conflicts where event_a in (${swimEvents}) or event_b in (${swimEvents})`);
    await pool.query(`delete from events where id in (${swimEvents})`);
    await pool.query("delete from swim_result_revisions");
    await pool.query("delete from swim_entries");
    await pool.query("delete from swim_results");
    await pool.query("delete from swim_meets");
  } finally {
    await pool.end();
  }
}
