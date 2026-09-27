"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { call } from "@/components/calendar/api";
import { formatScore, outcomeNote, type Perspective } from "@/domain/tennis";
import type { MatchView } from "@/server/tennis/load";
import { muted, Players, when } from "./bits";

// His matches (TEN-4, TEN-7) with the owner's corrections (TEN-8): edit the
// result, score or time, delete, or go back to the site's result. A
// correction stays through every later sync and is flagged when the site
// disagrees.

type Row = { match: MatchView; view: Perspective; running?: { wins: number; losses: number } };
type Props = {
  rows: Row[];
  selfKeys: string[];
  timeZone: string;
  show: "results" | "tournament" | "h2h";
};

export function MatchesTable({ rows, selfKeys, timeZone, show }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const act = async (p: Promise<unknown>, done: string) => {
    try {
      await p;
      setMessage(done);
      setEditing(null);
      router.refresh();
    } catch (err) {
      setMessage((err as Error).message);
    }
  };
  if (!rows.length) return <p className={`text-sm ${muted}`}>No matches yet.</p>;
  const cols = show === "results" ? 6 : 5;
  return (
    <div className="flex flex-col gap-2">
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className={muted}>
            <tr>
              <th className="py-1 pr-3 font-medium">Date</th>
              <th className="py-1 pr-3 font-medium">{show === "tournament" ? "Round" : "Tournament"}</th>
              {show !== "h2h" && <th className="py-1 pr-3 font-medium">Opponent</th>}
              <th className="py-1 pr-3 font-medium">Result</th>
              {show === "results" && <th className="py-1 pr-3 font-medium">W–L</th>}
              {show === "h2h" && <th className="py-1 pr-3 font-medium">Round</th>}
              <th className="py-1 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <MatchRow
                key={r.match.id}
                r={r}
                show={show}
                cols={cols}
                selfKeys={selfKeys}
                timeZone={timeZone}
                editing={editing === r.match.id}
                onEdit={() => setEditing(editing === r.match.id ? null : r.match.id)}
                act={act}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function siteSays(m: MatchView, side: 1 | 2): string {
  const s = m.source!;
  if (s.outcome === "scheduled") return "not played yet";
  const result = s.winner === null ? "" : s.winner === side ? "W " : "L ";
  const note = outcomeNote(s.outcome);
  return `${result}${formatScore(s.sets, side)}${note ? ` (${note})` : ""}`.trim();
}

function localTime(scheduledAt: string | null, timeZone: string) {
  if (!scheduledAt) return "";
  return new Date(scheduledAt).toLocaleTimeString("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" });
}

function MatchRow({
  r,
  show,
  cols,
  selfKeys,
  timeZone,
  editing,
  onEdit,
  act,
}: {
  r: Row;
  show: Props["show"];
  cols: number;
  selfKeys: string[];
  timeZone: string;
  editing: boolean;
  onEdit: () => void;
  act: (p: Promise<unknown>, done: string) => Promise<void>;
}) {
  const { match: m, view } = r;
  const [error, setError] = useState<string | null>(null);
  const opponents = <Players players={view.opponents} selfKeys={selfKeys} />;
  const result =
    m.outcome === "scheduled" ? (
      <span className={muted}>not played yet</span>
    ) : (
      <>
        <span className="font-semibold">{view.result ?? "—"}</span>{" "}
        <span className="tabular-nums">{view.score}</span>
      </>
    );
  return (
    <>
      <tr
        data-testid="tennis-match"
        className="border-t border-neutral-200 align-top dark:border-neutral-800"
      >
        <td className="py-2 pr-3 tabular-nums whitespace-nowrap">
          {when(m.matchDate, m.scheduledAt, timeZone)}
        </td>
        <td className="py-2 pr-3">
          {show === "tournament" ? (
            (m.round ?? "—")
          ) : m.tournamentId ? (
            <Link href={`/tennis/tournaments/${m.tournamentId}`} className="underline">
              {m.tournamentName}
            </Link>
          ) : (
            "—"
          )}
          {show === "results" && m.round && <span className="text-neutral-500"> · {m.round}</span>}
          {view.partner && <div className={`text-xs ${muted}`}>with {view.partner.name}</div>}
        </td>
        {show !== "h2h" && <td className="py-2 pr-3">{opponents}</td>}
        <td className="py-2 pr-3">
          {result}
          {m.corrected && <div className={`text-xs ${muted}`}>✎ Corrected by you</div>}
          {m.origin === "manual" && !m.corrected && <div className={`text-xs ${muted}`}>✎ Added by you</div>}
          {m.sourceDisagrees && (
            <div
              data-testid="source-disagrees"
              className="text-xs font-medium text-red-700 dark:text-red-400"
            >
              ⚠ {m.source ? `The site says ${siteSays(m, view.side)}` : "The site no longer lists this match"}
            </div>
          )}
        </td>
        {show === "results" && (
          <td className="py-2 pr-3 tabular-nums">
            {r.running ? `${r.running.wins}–${r.running.losses}` : ""}
          </td>
        )}
        {show === "h2h" && <td className="py-2 pr-3">{m.round ?? "—"}</td>}
        <td className="py-2 text-right whitespace-nowrap">
          <button type="button" className="rounded border px-2 py-0.5 text-xs" onClick={onEdit}>
            {editing ? "Cancel" : "Edit"}
          </button>
        </td>
      </tr>
      {editing && (
        <tr>
          <td colSpan={cols} className="pb-3">
            <form
              aria-label={`Correct the match on ${m.matchDate}`}
              className="flex flex-wrap items-end gap-2 rounded border border-dashed p-2 text-sm"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const won = String(f.get("won"));
                const score = String(f.get("score") ?? "").trim();
                const time = String(f.get("time") ?? "").trim();
                setError(null);
                await act(
                  call(`/api/v1/tennis/matches/${m.id}`, "PATCH", {
                    won: won === "" ? null : won === "yes",
                    outcome: won === "" ? "scheduled" : String(f.get("outcome")),
                    score,
                    time: time || null,
                  }).catch((err) => {
                    setError((err as Error).message);
                    throw err;
                  }),
                  "Saved. Your correction stays through future syncs.",
                );
              }}
            >
              <label className="flex flex-col">
                Result
                <select
                  name="won"
                  defaultValue={view.result === "W" ? "yes" : view.result === "L" ? "no" : ""}
                  className="rounded border px-2 py-1"
                >
                  <option value="yes">Won</option>
                  <option value="no">Lost</option>
                  <option value="">Not played yet</option>
                </select>
              </label>
              <label className="flex flex-col">
                Score (his games first)
                <input
                  name="score"
                  defaultValue={formatScore(m.sets, view.side).replace(/[[\]]/g, "")}
                  placeholder="6-3 4-6 10-8"
                  className="w-36 rounded border px-2 py-1"
                />
              </label>
              <label className="flex flex-col">
                How
                <select
                  name="outcome"
                  defaultValue={m.outcome === "scheduled" ? "played" : m.outcome}
                  className="rounded border px-2 py-1"
                >
                  <option value="played">Played</option>
                  <option value="retired">Retired</option>
                  <option value="walkover">Walkover</option>
                </select>
              </label>
              <label className="flex flex-col">
                Start time
                <input
                  name="time"
                  type="time"
                  defaultValue={localTime(m.scheduledAt, timeZone)}
                  className="rounded border px-2 py-1"
                />
              </label>
              <button type="submit" className="rounded bg-blue-700 px-3 py-1 text-white">
                Save correction
              </button>
              {m.corrected && m.source && (
                <button
                  type="button"
                  className="rounded border px-3 py-1"
                  onClick={() =>
                    act(call(`/api/v1/tennis/matches/${m.id}/use-source`), "Now showing the site's result.")
                  }
                >
                  Use the site&apos;s result ({siteSays(m, view.side)})
                </button>
              )}
              <button
                type="button"
                className="rounded border border-red-700 px-3 py-1 text-red-700 dark:text-red-400"
                onClick={() => act(call(`/api/v1/tennis/matches/${m.id}`, "DELETE"), "Match deleted.")}
              >
                Delete
              </button>
              {error && <p className="w-full text-red-700 dark:text-red-400">{error}</p>}
            </form>
          </td>
        </tr>
      )}
    </>
  );
}
