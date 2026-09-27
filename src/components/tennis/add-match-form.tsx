"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { call } from "@/components/calendar/api";

// TEN-8 / SYNC-6: add a match by hand, e.g. a result on the day, before
// the site has it. When the site's copy arrives, sync links the two (same
// day, opponent's name) and flags them if the scores differ.

type TournamentOption = { id: string; name: string; startDate: string };

export function AddMatchForm({ tournaments, today }: { tournaments: TournamentOption[]; today: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  if (!open)
    return (
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="self-start rounded border px-3 py-1 text-sm"
          onClick={() => setOpen(true)}
        >
          + Add a match
        </button>
        {saved && (
          <p role="status" className="text-sm">
            {saved}
          </p>
        )}
      </div>
    );
  const recent = [...tournaments].sort((a, b) => b.startDate.localeCompare(a.startDate)).slice(0, 20);
  return (
    <form
      aria-label="Add a match"
      className="flex flex-col gap-2 rounded-lg border border-dashed p-3 text-sm"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const s = (k: string) => String(f.get(k) ?? "").trim();
        const won = s("won");
        try {
          await call("/api/v1/tennis/matches", "POST", {
            matchDate: s("matchDate"),
            time: s("time") || null,
            opponentName: s("opponent"),
            won: won === "" ? null : won === "yes",
            outcome: won === "" ? "scheduled" : s("outcome"),
            score: s("score"),
            tournamentId: s("tournamentId") || undefined,
            round: s("round") || undefined,
            notes: s("notes") || undefined,
          });
          setError(null);
          setSaved("Match added.");
          setOpen(false);
          router.refresh();
        } catch (err) {
          setError((err as Error).message);
        }
      }}
    >
      <h2 className="text-base font-semibold">Add a match</h2>
      <div className="flex flex-wrap gap-2">
        <label className="flex flex-col">
          Date
          <input
            name="matchDate"
            type="date"
            required
            defaultValue={today}
            className="rounded border px-2 py-1"
          />
        </label>
        <label className="flex flex-col">
          Start time (optional)
          <input name="time" type="time" className="rounded border px-2 py-1" />
        </label>
        <label className="flex flex-col">
          Opponent
          <input name="opponent" required maxLength={80} className="rounded border px-2 py-1" />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <label className="flex flex-col">
          Result
          <select name="won" defaultValue="yes" className="rounded border px-2 py-1">
            <option value="yes">Won</option>
            <option value="no">Lost</option>
            <option value="">Not played yet</option>
          </select>
        </label>
        <label className="flex flex-col">
          Score (his games first)
          <input name="score" placeholder="6-3 4-6 10-8" className="w-36 rounded border px-2 py-1" />
        </label>
        <label className="flex flex-col">
          How
          <select name="outcome" defaultValue="played" className="rounded border px-2 py-1">
            <option value="played">Played</option>
            <option value="retired">Retired</option>
            <option value="walkover">Walkover</option>
          </select>
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <label className="flex flex-col">
          Tournament (optional)
          <select name="tournamentId" defaultValue="" className="rounded border px-2 py-1">
            <option value="">None</option>
            {recent.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.startDate})
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col">
          Round (optional)
          <input name="round" maxLength={40} className="rounded border px-2 py-1" />
        </label>
      </div>
      <label className="flex flex-col">
        Notes (optional)
        <input name="notes" maxLength={500} className="rounded border px-2 py-1" />
      </label>
      {error && <p className="text-red-700 dark:text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className="rounded bg-blue-700 px-3 py-1 text-white">
          Add match
        </button>
        <button type="button" className="rounded border px-3 py-1" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
