import Link from "next/link";
import { muted } from "@/components/tennis/bits";
import { AddMatchForm } from "@/components/tennis/add-match-form";
import { MatchesTable } from "@/components/tennis/matches-table";
import { formatRecord } from "@/domain/tennis";
import { getDb } from "@/server/db";
import { loadResults } from "@/server/tennis/load";

// TEN-7: every match of his, a season filter, and the running W–L. TEN-8:
// a match can be added by hand here.
export default async function ResultsPage({ searchParams }: PageProps<"/tennis/results">) {
  const { season: raw } = await searchParams;
  const season = typeof raw === "string" && /^\d{4}$/.test(raw) ? Number(raw) : null;
  const db = await getDb();
  const { data, seasons, rows, total, singles } = await loadResults(db, season);
  return (
    <main className="flex flex-col gap-4">
      <Link href="/tennis" className="text-sm underline">
        ← Tennis
      </Link>
      <h1 className="text-xl font-semibold">Results</h1>
      <nav aria-label="Season" className="flex flex-wrap gap-2 text-sm">
        <SeasonLink label="All" href="/tennis/results" active={season === null} />
        {seasons.map((s) => (
          <SeasonLink key={s} label={String(s)} href={`/tennis/results?season=${s}`} active={season === s} />
        ))}
      </nav>
      <p className="text-sm" data-testid="record">
        W–L {formatRecord(total)}
        {singles.wins + singles.losses !== total.wins + total.losses && ` · singles ${formatRecord(singles)}`}
      </p>
      <MatchesTable rows={rows} selfKeys={[...data.selfKeys]} timeZone={data.timeZone} show="results" />
      {data.self ? (
        <AddMatchForm
          today={data.today}
          tournaments={data.tournaments.map((t) => ({ id: t.id, name: t.name, startDate: t.startDate }))}
        />
      ) : (
        <p className={`text-sm ${muted}`}>
          Add his Tennis Canada profile on the{" "}
          <a href="/sources" className="underline">
            Sources page
          </a>{" "}
          to sync his matches, or add one by hand below once he&apos;s set up.
        </p>
      )}
    </main>
  );
}

function SeasonLink({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`rounded border px-2 py-0.5 ${active ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : ""}`}
    >
      {label}
    </Link>
  );
}
