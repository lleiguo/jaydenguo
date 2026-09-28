import { expect, test } from "@playwright/test";
import pg from "pg";
import { RUN } from "./support/calendar";
import { OWNER } from "./support/env";
import { signInAs } from "./support/session";

// Plan M4.2 (SCH-1, SCH-5): the "Today at school" card above the calendar,
// from Veracross periods. The sync itself is covered by
// tests/integration/veracross-sync.test.ts.

test("the next school day's periods show with rooms, teachers and links back", async ({
  page,
  context,
}, info) => {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  const tag = `${info.project.name} ${RUN}`;
  // Three days ahead, so the card shows that day whatever the time now.
  const day = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  const at = (hhmm: string) => new Date(`${day}T${hhmm}:00Z`).toISOString();
  const { rows } = await pool.query<{ id: string }>(
    "insert into sources (kind, name, enabled, config) values ('veracross', $1, true, '{}') returning id",
    [`School ${tag}`],
  );
  const sourceId = rows[0].id;
  try {
    for (const [i, [title, start, end, room, notes]] of [
      [`Science ${tag}`, at("16:00"), at("16:45"), "Lab 2", "With Jordan Placeholder"],
      [`French ${tag}`, at("17:00"), at("17:45"), "R204", "With Sam Madeup"],
    ].entries()) {
      await pool.query(
        `insert into events (source_id, external_id, category, title, start_utc, end_utc, location_name, notes, last_synced_at, source_url, source_hash)
         values ($1, $2, 'school_class', $3, $4, $5, $6, $7, now(), $8, 'h')`,
        [
          sourceId,
          `p${i}`,
          title,
          start,
          end,
          room,
          notes,
          `https://portals.example.test/s/1/daily-schedule?date=${day}`,
        ],
      );
    }
    await signInAs(context, OWNER);
    await page.goto("/");
    const card = page.getByRole("region", { name: /at school/i });
    await expect(card).toBeVisible();
    const science = card.getByRole("row").filter({ hasText: `Science ${tag}` });
    await expect(science).toContainText("Lab 2");
    await expect(science).toContainText("Jordan Placeholder");
    await expect(science.getByRole("link", { name: `Science ${tag}` })).toHaveAttribute(
      "href",
      `https://portals.example.test/s/1/daily-schedule?date=${day}`,
    );
    await expect(card.getByRole("row").filter({ hasText: `French ${tag}` })).toContainText("R204");
  } finally {
    await pool.query("delete from events where source_id = $1", [sourceId]);
    await pool.query("delete from sources where id = $1", [sourceId]);
    await pool.end();
  }
});
