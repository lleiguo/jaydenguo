import { MODEL_LABEL, REVIEW_MODELS, SPORT_LABEL } from "@/domain/video-constants";
import type { ScoreboardRow } from "@/server/video/store";

const muted = "text-neutral-600 dark:text-neutral-400";

const signed = (n: number | null) => (n === null ? "–" : n > 0 ? `+${n}` : String(n));

// VID-3d, F-12, F-13: per sport, who the AI judges picked, who you picked,
// how often they agree, and each model's lean towards its own review.
export function Scoreboard({ rows }: { rows: ScoreboardRow[] }) {
  if (!rows.length)
    return <p className={`text-sm ${muted}`}>The scoreboard starts after the first two-model review.</p>;
  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm" aria-label="Scoreboard">
          <thead className={muted}>
            <tr>
              <th className="py-1 pr-3 font-medium">Sport</th>
              <th className="py-1 pr-3 font-medium">Reviews</th>
              {REVIEW_MODELS.map((m) => (
                <th key={m} className="py-1 pr-3 font-medium">
                  {MODEL_LABEL[m]}: judges / you
                </th>
              ))}
              <th className="py-1 pr-3 font-medium">Ties</th>
              <th className="py-1 pr-3 font-medium">Judges agreed with you</th>
              {REVIEW_MODELS.map((m) => (
                <th key={m} className="py-1 pr-3 font-medium">
                  {MODEL_LABEL[m]} self-lean
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.sport} className="border-t border-neutral-200 dark:border-neutral-800">
                <td className="py-1.5 pr-3">{SPORT_LABEL[r.sport]}</td>
                <td className="py-1.5 pr-3 tabular-nums">{r.debates}</td>
                {REVIEW_MODELS.map((m) => (
                  <td key={m} className="py-1.5 pr-3 tabular-nums">
                    {r.judgeWins[m]} / {r.parentWins[m]}
                  </td>
                ))}
                <td className="py-1.5 pr-3 tabular-nums">{r.ties}</td>
                <td className="py-1.5 pr-3 tabular-nums">
                  {r.comparable ? `${r.agreed} of ${r.comparable}` : "–"}
                </td>
                {REVIEW_MODELS.map((m) => (
                  <td key={m} className="py-1.5 pr-3 tabular-nums">
                    {signed(r.selfPreference[m])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={`text-xs ${muted}`}>
        Your vote is the real measure: the judges are AI and can be wrong. Self-lean is how many points (of
        25) a model gave its own review above what the other model gave it. Gemini sees the whole video;
        Claude sees still frames, so the comparison isn&apos;t exactly like for like.
      </p>
    </div>
  );
}
