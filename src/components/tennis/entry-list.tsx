import Link from "next/link";
import type { EntryListPlayer, EntryListView } from "@/server/tennis/entry-list";
import { muted } from "./bits";

// Intent 0017, ACC-5: an entry's acceptance list: his status, when it was
// read, the main draw (him highlighted, known players linked), then the
// reserve list, collapsed.

const read = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleString("en-CA", { timeZone, dateStyle: "medium", timeStyle: "short" });

function Player({ p }: { p: EntryListPlayer }) {
  const name = p.names.join(" / ");
  return (
    <li data-testid="entry-list-player" data-self={p.isSelf || undefined}>
      {p.reservePosition !== null && <span className={`${muted} tabular-nums`}>{p.reservePosition}. </span>}
      {p.isSelf ? (
        <strong className="rounded bg-yellow-100 px-1 dark:bg-yellow-900">{name}</strong>
      ) : p.playerKey ? (
        <Link href={`/tennis/players/${encodeURIComponent(p.playerKey)}`} className="underline">
          {name}
        </Link>
      ) : (
        name
      )}
    </li>
  );
}

export function EntryList({ entry: e, timeZone }: { entry: EntryListView; timeZone: string }) {
  return (
    <section aria-label={`Acceptance list: ${e.eventName}`} className="flex flex-col gap-2 text-sm">
      <p>
        <span className="font-semibold">{e.eventName}</span> ·{" "}
        <span className="font-medium" data-testid="entry-status">
          {e.status.label}
        </span>
        {e.listCheckedAt && <span className={muted}> · List read {read(e.listCheckedAt, timeZone)}</span>}
      </p>
      {e.note && <p className={muted}>{e.note}</p>}
      {!e.listOut ? (
        <p className={muted}>The acceptance list isn&apos;t out yet.</p>
      ) : (
        <>
          <h3 className="font-semibold">Main draw ({e.mainDraw.length})</h3>
          <ol className="flex flex-col gap-0.5" aria-label="Main draw">
            {e.mainDraw.map((p, i) => (
              <Player key={i} p={p} />
            ))}
          </ol>
          {e.reserve.length > 0 && (
            <details>
              <summary className="cursor-pointer font-semibold">Reserve list ({e.reserve.length})</summary>
              <ol className="mt-1 flex flex-col gap-0.5" aria-label="Reserve list">
                {e.reserve.map((p, i) => (
                  <Player key={i} p={p} />
                ))}
              </ol>
            </details>
          )}
        </>
      )}
    </section>
  );
}
