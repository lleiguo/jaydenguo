import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { dates, muted } from "@/components/tennis/bits";
import { EntryList } from "@/components/tennis/entry-list";
import { externalHref } from "@/lib/external-href";
import { getDb } from "@/server/db";
import { getHomeTimeZone } from "@/server/settings";
import { loadEntry } from "@/server/tennis/entry-list";

// Intent 0017, ACC-5: one upcoming entry and its acceptance list. Once the
// tournament is synced, its own page shows the same list.
export default async function EntryPage({ params }: PageProps<"/tennis/entries/[id]">) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const db = await getDb();
  const e = await loadEntry(db, id);
  if (!e) notFound();
  if (e.tournamentId) redirect(`/tennis/tournaments/${e.tournamentId}`);
  const timeZone = await getHomeTimeZone(db);
  return (
    <main className="flex flex-col gap-4">
      <Link href="/tennis" className="text-sm underline">
        ← Tennis
      </Link>
      <div>
        <h1 className="text-xl font-semibold">{e.tournamentName}</h1>
        <p className={`text-sm ${muted}`}>
          {[dates(e.startDate, e.endDate), e.venue].filter(Boolean).join(" · ")}
          {" · "}
          <a href={externalHref(e.tournamentUrl)} className="underline" rel="noreferrer" target="_blank">
            Open on the tournament site
          </a>
        </p>
      </div>
      <EntryList entry={e} timeZone={timeZone} />
    </main>
  );
}
