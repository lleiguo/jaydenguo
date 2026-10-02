// Records /api/v1 GET responses for the iPhone app's decoding tests (intent
// 0004, plan N2.2) from a local development server running on a database
// that holds only `pnpm seed`'s made-up season, never real data:
//
//   createdb hub_fixtures; DATABASE_URL=…/hub_fixtures pnpm db:migrate && pnpm seed
//   DATABASE_URL=…/hub_fixtures APP_URL=http://localhost:3200 pnpm dev --port 3200
//   pnpm tsx scripts/record-api-fixtures.ts http://localhost:3200
//
// Fixtures land in ios/HubKit/Tests/HubKitTests/Fixtures/<operationId>.json.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { operations } from "../src/server/openapi/registry";

const base = process.argv[2] ?? "http://localhost:3200";
const out = path.resolve(__dirname, "../ios/HubKit/Tests/HubKitTests/Fixtures");

// The seed is made up, but the signed-in account and the primary person's
// name come from the real configuration: never commit them (CLAUDE.md).
export function scrub(json: string): string {
  const cleaned = json
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "owner@example.test")
    .replace(/\bJayden\b/g, "Child")
    .replace(/\bGuo\b/gi, "Example");
  if (/jayden|lleiguo/i.test(cleaned)) throw new Error("fixture still holds personal data");
  return cleaned;
}

async function main() {
  const dev = await fetch(`${base}/auth/dev?client=ios`);
  if (!dev.ok) throw new Error(`dev token: ${dev.status} (is this a development server?)`);
  const { token } = (await dev.json()) as { token: string };
  const get = async (p: string) => {
    const res = await fetch(`${base}${p}`, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`GET ${p}: ${res.status} ${await res.text()}`);
    return res.json();
  };
  mkdirSync(out, { recursive: true });
  const save = (operationId: string, body: unknown) =>
    writeFileSync(path.join(out, `${operationId}.json`), `${scrub(JSON.stringify(body, null, 2))}\n`);

  const now = Date.now();
  const range = `from=${new Date(now - 7 * 86_400_000).toISOString()}&to=${new Date(now + 28 * 86_400_000).toISOString()}`;
  const withQuery: Record<string, string> = { listEvents: `/api/v1/events?${range}` };
  const saved: Record<string, unknown> = {};
  for (const op of operations) {
    if (op.method !== "GET" || op.binary || op.path.includes("{")) continue;
    // Cookie's fixtures (intent 0007) are written by hand: a recorded chat
    // would depend on what was last asked.
    if (op.path.startsWith("/api/v1/assistant/")) continue;
    saved[op.operationId] = await get(withQuery[op.operationId] ?? op.path);
    save(op.operationId, saved[op.operationId]);
  }

  // Details, using ids from the lists.
  const cal = saved.listEvents as { events: { id: string; seriesId: string | null }[] };
  save("getEvent", await get(`/api/v1/events/${cal.events[0].id}`));
  const series = cal.events.find((e) => e.seriesId);
  if (series) save("getSeries", await get(`/api/v1/series/${series.seriesId}`));
  const meets = saved.listMeets as { upcoming: { id: string }[]; past: { id: string }[] };
  const meet = meets.past[0] ?? meets.upcoming[0];
  if (meet) save("getMeet", await get(`/api/v1/swim/meets/${meet.id}`));
  const pbs = saved.listPersonalBests as { pbs: { key: string }[] };
  if (pbs.pbs[0]) save("getSwimEvent", await get(`/api/v1/swim/events/${pbs.pbs[0].key}`));
  const tennis = saved.getTennisOverview as {
    nextMatches: { tournament: { id: string }; draw: { opponentKey: string | null } }[];
    past: { id: string }[];
  };
  const next = tennis.nextMatches[0];
  const tournamentId = next?.tournament.id ?? tennis.past[0]?.id;
  if (tournamentId) save("getTournament", await get(`/api/v1/tennis/tournaments/${tournamentId}`));
  if (next?.draw.opponentKey)
    save("getTennisPlayer", await get(`/api/v1/tennis/players/${next.draw.opponentKey}`));
  // The seed's sample review with a playback copy.
  save("getVideoReview", await get("/api/v1/videos/5eed0000-0000-4000-8000-000000000001"));
  // The seed's sample notification (PUSH-2).
  save("getNotification", await get("/api/v1/notifications/5eed0000-0000-4000-8000-000000000101"));
  console.log(`recorded ${Object.keys(saved).length + 8} fixtures in ${path.relative(process.cwd(), out)}`);
}

if (require.main === module)
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
