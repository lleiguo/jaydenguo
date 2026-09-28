import Link from "next/link";
import type { PlayerRef } from "@/domain/tennis";
import type { DrawView, PredictionView } from "@/server/tennis/load";

// Small shared pieces of the tennis pages (TEN-2..6).

export const muted = "text-neutral-600 dark:text-neutral-400";

export function dates(start: string, end: string) {
  return end !== start ? `${start} – ${end}` : start;
}

// A match time in the home time zone, e.g. "Sun 2024-09-29 09:00".
export function when(date: string, scheduledAt: string | null, timeZone: string) {
  if (!scheduledAt) return date;
  const t = new Date(scheduledAt);
  const day = t.toLocaleDateString("en-CA", { timeZone, weekday: "short" });
  const time = t.toLocaleTimeString("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" });
  return `${day} ${date} ${time}`;
}

export function Players({ players, selfKeys }: { players: PlayerRef[]; selfKeys: Set<string> | string[] }) {
  const self = new Set(selfKeys);
  return (
    <>
      {players.map((p, i) => (
        <span key={p.key}>
          {i > 0 && " / "}
          {self.has(p.key) ? (
            p.name
          ) : (
            <Link href={`/tennis/players/${p.key}`} className="underline">
              {p.name}
            </Link>
          )}
        </span>
      ))}
    </>
  );
}

// TEN-3: "Semi final vs X", or "vs winner of A vs B", with the published time.
export function NextMatchLine({ draw }: { draw: DrawView }) {
  const n = draw.next;
  if (!n) return null;
  if (n.status !== "next")
    return (
      <span>
        {n.status === "won"
          ? "Won the draw 🏆"
          : n.status === "out"
            ? "Finished in this draw"
            : "Not in the published draw"}
      </span>
    );
  const time = n.date ? ` · ${n.date}${n.time ? ` ${n.time}` : ""}` : "";
  return (
    <span>
      Next: {n.round} vs{" "}
      {n.opponent ? (
        draw.opponentKey ? (
          <Link href={`/tennis/players/${draw.opponentKey}`} className="underline">
            {n.opponent.name}
          </Link>
        ) : (
          n.opponent.name
        )
      ) : n.feeders ? (
        `winner of ${n.feeders[0]} vs ${n.feeders[1]}`
      ) : (
        "opponent to be decided"
      )}
      {time}
    </span>
  );
}

export function DrawLine({ draw }: { draw: DrawView }) {
  const where =
    draw.position && draw.size ? `line ${draw.position} of ${draw.size}` : draw.kind === "other" ? "" : null;
  return (
    <div data-testid="draw" className="flex flex-col">
      <span className="font-medium">
        {draw.eventName ?? draw.drawName ?? "Draw"}
        {draw.drawName && draw.eventName && draw.drawName !== draw.eventName && ` · ${draw.drawName}`}
        {draw.status === "withdrawn" && " (withdrawn)"}
      </span>
      <span className={muted}>
        {[where, draw.seed ? `seed ${draw.seed}` : null].filter(Boolean).join(" · ")}
        {draw.sourceUrl && (
          <>
            {where || draw.seed ? " · " : ""}
            <a href={draw.sourceUrl} className="underline" rel="noreferrer" target="_blank">
              Draw on the site
            </a>
          </>
        )}
      </span>
      {draw.status === "active" && <NextMatchLine draw={draw} />}
    </div>
  );
}

export const pct = (p: number) => `${Math.round(p * 100)}%`;

// TEN-6: the win estimate, its confidence and the why, with the
// opponent's level and head-to-head (TEN-11). No score band: the owner
// asked for the win % only (2026-09-27).
export function PredictionBox({
  p,
  selfName,
  explanation,
}: {
  p: PredictionView;
  selfName: string;
  explanation?: string | null;
}) {
  return (
    <div
      data-testid="prediction"
      className="flex flex-col gap-1 rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-base font-semibold">
          {selfName.split(" ")[0]} wins: {pct(p.probability)}
        </span>
        <span className={muted}>Estimate, not a certainty · confidence {p.confidence}</span>
      </div>
      <div data-testid="opponent-level">
        {p.opponentName}: {p.opponentLevel.tournaments}{" "}
        {p.opponentLevel.tournaments === 1 ? "tournament" : "tournaments"} and {p.opponentLevel.lastYear.wins}
        –{p.opponentLevel.lastYear.losses} in the last 12 months · head-to-head {p.headToHead.wins}–
        {p.headToHead.losses}
      </div>
      <div className={muted}>Why: {p.why}</div>
      {explanation && <p data-testid="explanation">{explanation}</p>}
      <Link href="/tennis/accuracy" className={`self-start underline ${muted}`}>
        How accurate is this?
      </Link>
    </div>
  );
}
