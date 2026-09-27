// SP-2 probe (plan M3.1): reads the Tennis Canada site the way the sync
// does and prints the player's last 10 matches and one opponent's last 10.
// It prints real names, so run it only with the output going somewhere
// private, never into the repository or a PR:
//
//   pnpm exec tsx scripts/tennis-tc-probe.ts <profile link> > /private/place.txt
//
// Nothing is written to the database.
import { fetchTennis } from "../src/adapters/tennis-tc";
import { normaliseTennis } from "../src/adapters/tennis-tc/normalise";
import type { TennisMatchRecord } from "../src/domain/tennis-upsert";

async function main() {
  const link = process.argv[2];
  if (!link) throw new Error("usage: tsx scripts/tennis-tc-probe.ts <profile link>");
  const tz = process.env.HOME_TIME_ZONE ?? "America/Toronto";
  const ctx = {
    source: {
      id: "probe",
      name: "probe",
      config: { profileUrl: link },
      mapping: { default: "tennis" as const },
    },
    credential: null,
    now: new Date(),
    homeTimeZone: tz,
  };
  const raw = await fetchTennis(ctx);
  const batch = normaliseTennis(raw, ctx).tennis!;
  const names = new Map(batch.players.map((p) => [p.memberId, p.name]));
  const line = (m: TennisMatchRecord, who: string) => {
    const mine = m.side1.includes(who) ? 1 : 2;
    const opp = (mine === 1 ? m.side2 : m.side1).map((id) => names.get(id)).join(" / ");
    const result = m.winner === null ? "-" : m.winner === mine ? "W" : "L";
    const score = m.sets.map(([a, b]) => (mine === 1 ? `${a}-${b}` : `${b}-${a}`)).join(" ");
    return `${m.matchDate} ${result} ${score.padEnd(14)} vs ${opp} (${m.round ?? "?"})`;
  };
  const last10 = (who: string) =>
    batch.matches
      .filter((m) => m.side1.includes(who) || m.side2.includes(who))
      .filter((m) => m.outcome !== "scheduled")
      .sort((a, b) => b.matchDate.localeCompare(a.matchDate))
      .slice(0, 10)
      .map((m) => line(m, who));

  console.log(`${raw.requests} requests${raw.truncated ? " (hit the limit)" : ""}`);
  console.log(`\n${names.get(batch.selfMemberId)}: last 10`);
  for (const l of last10(batch.selfMemberId)) console.log(`  ${l}`);
  const opp = raw.opponents[0];
  if (opp) {
    console.log(`\n${opp.name}: last 10`);
    for (const l of last10(opp.memberId)) console.log(`  ${l}`);
  }
}

void main();
