import type { BrowserContext, Page } from "@playwright/test";
import pg from "pg";
import { apiSend } from "./api";

// Helpers for calendar tests. Each test works in its own far-future week so
// tests running in parallel (and seed data) don't see each other's events.
// Times are in the default home time zone, America/Toronto.

export function isolatedWeek(testIndex: number, project: string): string {
  // Mondays from 2027-12-20, one per test and project (six each), all
  // before the March daylight-saving change and within the two years that
  // repeating events are written out.
  if (testIndex > 5) throw new Error("add more isolated weeks");
  const base = Date.UTC(2027, 11, 20) + ((project === "phone" ? 6 : 0) + testIndex) * 7 * 86_400_000;
  return new Date(base).toISOString().slice(0, 10);
}

// Titles are unique per run, so local re-runs don't see earlier runs' events.
export const RUN = Date.now().toString(36);

export const addDays = (date: string, n: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// Toronto is UTC-5 in winter (the isolated weeks are December 2027-March 2028).
export const toronto = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00-05:00`).toISOString();

export async function addEvent(
  context: BrowserContext,
  e: {
    title: string;
    category: string;
    start: string;
    end: string;
    allDay?: boolean;
    attendance?: string;
    ownerIds?: string[];
  },
): Promise<string> {
  const res = await apiSend(context, "POST", "/api/v1/events", {
    attendance: "required",
    allDay: false,
    ...e,
  });
  return res.id;
}

// An event from a (fake) synced source, written straight to the database.
export async function addSourceEvent(e: {
  source: string;
  title: string;
  category: string;
  start: string;
  end: string;
}) {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const { rows } = await pool.query<{ id: string }>(
      "insert into sources (kind, name, enabled) values ('ical', $1, false) returning id",
      [e.source],
    );
    const ev = await pool.query<{ id: string }>(
      `insert into events (source_id, external_id, category, title, start_utc, end_utc, last_synced_at, source_url, source_hash)
       values ($1, 'x1', $2, $3, $4, $5, now(), 'https://example.test/team/event/1', 'h') returning id`,
      [rows[0].id, e.category, e.title, e.start, e.end],
    );
    await pool.query("insert into change_log (kind) values ('test')");
    return ev.rows[0].id;
  } finally {
    await pool.end();
  }
}

export async function openWeek(page: Page, monday: string, view = "timeGridWeek") {
  await page.goto(`/?view=${view}&date=${monday}`);
  await page.getByRole("tab", { name: "Week view" }).waitFor();
}

export const calEvent = (page: Page, title: string) =>
  page.getByTestId("cal-event").filter({ hasText: title });
