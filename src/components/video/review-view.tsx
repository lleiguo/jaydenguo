"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { call } from "@/components/calendar/api";
import {
  MODEL_LABEL,
  REVIEW_MODELS,
  SPORT_LABEL,
  sportText,
  VIDEO_SPORTS,
  type ReviewModel,
  type VideoSport,
} from "@/domain/video-constants";
import { timelinePoints } from "@/domain/review-timeline";
import { formatClockTime } from "@/domain/video-links";
import type { Verdict } from "@/server/video/debate";
import {
  CRITERIA,
  CRITERION_LABEL,
  type Combined,
  type Critique,
  type Rebuttal,
  type Review,
} from "@/server/video/prompts";
import type { VideoReviewDetail } from "@/server/video/store";
import { inProgress, STATUS_LABEL, statusTone } from "./history";
import { JumpTo, PlaybackProvider, ReviewPlayer, usePlayback, usePlayer } from "./review-player";

const muted = "text-neutral-600 dark:text-neutral-400";
const card = "rounded-md border border-neutral-200 p-3 dark:border-neutral-800";

type Point = {
  text: string;
  at: string | null;
  why: string;
  status?: "agreed" | "disputed";
  sides?: { for: string; against: string } | null;
};

export function ReviewView({ initial }: { initial: VideoReviewDetail }) {
  const router = useRouter();
  const [r, setR] = useState(initial);
  const [message, setMessage] = useState<string | null>(null);
  const running = inProgress(r.status);
  const advice = r.status === "done" ? (r.combinedReview as Combined | Review | null) : null;
  const points = useMemo(() => (advice ? timelinePoints(advice) : []), [advice]);
  const playback = usePlayback(points);
  const hasPlayer = r.status === "done" && r.hasPlayback;

  // VID-5: progress while the job runs.
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(async () => {
      const res = await fetch(`/api/v1/videos/${r.id}`);
      if (res.ok) setR((await res.json()) as VideoReviewDetail);
    }, 3000);
    return () => clearInterval(timer);
  }, [running, r.id]);

  const reviewOf = (m: ReviewModel) =>
    r.rounds.find((x) => x.round === "review" && x.model === m)?.output as Review | undefined;
  const segment =
    r.segmentStart !== null || r.segmentEnd !== null
      ? `${formatClockTime(r.segmentStart ?? 0)}–${r.segmentEnd !== null ? formatClockTime(r.segmentEnd) : "end"}`
      : null;

  return (
    <PlaybackProvider playback={hasPlayer ? playback : null}>
      <div className="flex flex-col gap-4">
        <header className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">
            {sportText(r.sport, r.sportSource)} · {r.filmedOn}
          </h1>
          <SportControl r={r} onChanged={setR} />
          {r.note && <p>{r.note}</p>}
          <p className={`text-sm ${muted}`}>
            <span data-testid="review-status" className={statusTone(r.status)}>
              {STATUS_LABEL[r.status] ?? r.status}
            </span>
            {r.mediaName && ` · ${r.mediaName}`}
            {segment && ` · part ${segment}`}
            {r.url && (
              <>
                {" · "}
                <a href={r.url} target="_blank" rel="noreferrer noopener" className="underline">
                  open the video
                </a>
              </>
            )}
          </p>
        </header>

        {running && (
          <section className={`${card} flex flex-col gap-2`} aria-live="polite">
            {r.status === "picking" && r.pickerUri ? (
              <>
                <p>Pick one video in Google Photos. This page carries on by itself once you have.</p>
                <a
                  href={r.pickerUri}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="self-start rounded-md border bg-neutral-900 px-4 py-2 text-white dark:bg-white dark:text-neutral-900"
                >
                  Open Google Photos
                </a>
                <p className={`text-xs ${muted}`}>
                  Use the same Google account that&apos;s connected to this site.
                </p>
              </>
            ) : (
              <p>{r.progress ?? "Starting"}…</p>
            )}
            <p className={`text-xs ${muted}`}>A two-model review takes about five minutes.</p>
          </section>
        )}

        {r.status === "saved" && (
          <p className={card}>
            YouTube videos can&apos;t be reviewed by the site (YouTube doesn&apos;t allow it). The link and
            your note are saved. To get a review, keep the original in Google Photos or Drive and add it from
            there.
          </p>
        )}

        {r.status === "failed" && (
          <section className={`${card} flex flex-col gap-2`}>
            <p className="text-red-700 dark:text-red-400">{r.errorMessage ?? "The review failed."}</p>
            <button
              type="button"
              className="self-start rounded border px-3 py-1"
              onClick={async () => {
                try {
                  await call(`/api/v1/videos/${r.id}/retry`);
                  const res = await fetch(`/api/v1/videos/${r.id}`);
                  if (res.ok) setR((await res.json()) as VideoReviewDetail);
                } catch (err) {
                  setMessage((err as Error).message);
                }
              }}
            >
              Try again
            </button>
          </section>
        )}

        {r.status === "done" && (
          <>
            <p className={`text-sm ${muted}`}>AI feedback to help you, not a coach&apos;s assessment.</p>
            {hasPlayer && (
              <ReviewPlayer
                reviewId={r.id}
                playback={playback}
                points={points}
                durationSec={r.durationSec}
                segmentStart={r.segmentStart}
                onDeleted={() => setR({ ...r, hasPlayback: false })}
              />
            )}
            {r.verdict && <VerdictBox v={r.verdict} />}
            <CombinedReview
              title={
                r.verdict
                  ? "The advice"
                  : `${MODEL_LABEL[r.mode === "claude" ? "claude" : "gemini"]}'s review`
              }
              review={r.combinedReview as Combined | Review}
              follow
            />
            {r.verdict && (
              <Vote
                r={r}
                onVoted={(vote) => setR({ ...r, parentVote: vote, votedAt: new Date().toISOString() })}
              />
            )}
            {r.verdict && (
              <details className={card}>
                <summary className="cursor-pointer font-medium">
                  Both reviews, the judges&apos; scores and the replies
                </summary>
                <div className="mt-3 flex flex-col gap-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    {REVIEW_MODELS.map((m) => {
                      const rv = reviewOf(m);
                      return rv ? (
                        <CombinedReview key={m} title={`${MODEL_LABEL[m]}'s review`} review={rv} small />
                      ) : null;
                    })}
                  </div>
                  <ScoresTable r={r} />
                  <Critiques r={r} />
                  <Rebuttals r={r} />
                </div>
              </details>
            )}
            <p className={`text-xs ${muted}`}>
              {r.rounds.length} model calls
              {r.costUsd !== null && ` · about $${r.costUsd.toFixed(2)}`}
              {" · "}
              {[...new Set(r.rounds.map((x) => x.modelVersion))].join(", ")}
              {r.promptVersion && ` · prompts ${r.promptVersion}`}
            </p>
          </>
        )}

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <button
            type="button"
            className="rounded border px-3 py-1"
            onClick={async () => {
              try {
                await call(`/api/v1/videos/${r.id}`, "DELETE");
                router.push(`/videos?sport=${r.sport}`);
              } catch (err) {
                setMessage((err as Error).message);
              }
            }}
          >
            Delete
          </button>
          <span aria-live="polite">{message}</span>
        </div>
      </div>
    </PlaybackProvider>
  );
}

// intent 0005, SPT-5, SPT-6: set the sport. A finished review asks whether
// to run it again for the new sport or only change the label.
function SportControl({ r, onChanged }: { r: VideoReviewDetail; onChanged: (r: VideoReviewDetail) => void }) {
  const [pending, setPending] = useState<VideoSport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const running = r.status === "analysing";
  const unset = r.sportSource === "unsure" || (r.sportSource === "detecting" && !inProgress(r.status));

  async function change(sport: VideoSport, reviewAgain: boolean) {
    setError(null);
    setBusy(true);
    try {
      await call(`/api/v1/videos/${r.id}`, "PATCH", { sport, reviewAgain });
      const res = await fetch(`/api/v1/videos/${r.id}`);
      if (res.ok) onChanged((await res.json()) as VideoReviewDetail);
      setPending(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 text-sm">
      {unset && (
        <p className="text-amber-700 dark:text-amber-400">
          The sport couldn&apos;t be worked out from the video, so the review used a general checklist. Set it
          here.
        </p>
      )}
      <label className="flex flex-wrap items-center gap-2">
        Sport
        <select
          aria-label="Sport"
          value={pending ?? (unset || r.sportSource === "detecting" ? "" : r.sport)}
          disabled={running || busy}
          onChange={(e) => {
            const sport = e.target.value as VideoSport;
            if (!sport || sport === r.sport) return setPending(null);
            if (r.status === "done") setPending(sport);
            else void change(sport, false);
          }}
          className="rounded border px-2 py-1 dark:bg-neutral-900"
        >
          {(unset || r.sportSource === "detecting") && (
            <option value="">{r.sportSource === "detecting" ? "Detect automatically" : "Not set"}</option>
          )}
          {VIDEO_SPORTS.map((s) => (
            <option key={s} value={s}>
              {SPORT_LABEL[s]}
            </option>
          ))}
        </select>
        {running && <span className={muted}>Change the sport when the review has finished.</span>}
      </label>
      {pending && (
        <div className={`${card} flex flex-col gap-2`} role="group" aria-label="Change the sport">
          <p>
            The review was written for{" "}
            {r.sportSource === "unsure" ? "no particular sport" : SPORT_LABEL[r.sport]}. Review it again as{" "}
            {SPORT_LABEL[pending]}? That runs the whole review again
            {r.parentVote ? " and clears your vote, which was about this review" : ""}.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              className="rounded-md border bg-neutral-900 px-3 py-1 text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
              onClick={() => change(pending, true)}
            >
              Review again as {SPORT_LABEL[pending]}
            </button>
            <button
              type="button"
              disabled={busy}
              className="rounded border px-3 py-1"
              onClick={() => change(pending, false)}
            >
              Only change the label
            </button>
            <button type="button" className="rounded border px-3 py-1" onClick={() => setPending(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

function VerdictBox({ v }: { v: Verdict }) {
  return (
    <section className={card} aria-labelledby="verdict">
      <h2 id="verdict" className="font-semibold">
        {v.tie
          ? `A tie: ${v.totals.gemini} and ${v.totals.claude} of 25`
          : `${MODEL_LABEL[v.winner]}'s review won by ${v.margin} (${v.totals[v.winner]} to ${v.totals[v.winner === "gemini" ? "claude" : "gemini"]} of 25)`}
      </h2>
      <p className={`text-sm ${muted}`}>
        The AI judges&apos; opinion: the average of both models&apos; final scores for each review.
        {v.tie && ` ${MODEL_LABEL[v.winner]} wrote the advice.`}
      </p>
    </section>
  );
}

// `follow` (the advice only): the point at the video's current time is
// highlighted (intent 0003, PLAY-5). Keys match timelinePoints.
function PointList({
  points,
  ranked,
  section,
  follow,
}: {
  points: Point[];
  ranked?: boolean;
  section: "good" | "fix";
  follow?: boolean;
}) {
  const player = usePlayer();
  const List = ranked ? "ol" : "ul";
  return (
    <List className={`flex flex-col gap-2 pl-5 ${ranked ? "list-decimal" : "list-disc"}`}>
      {points.map((p, i) => (
        <li
          key={i}
          data-active={follow && player?.activeKey === `${section}-${i}` ? "" : undefined}
          className="rounded data-[active]:bg-yellow-100 dark:data-[active]:bg-yellow-950"
        >
          <span className="font-medium">{p.text}</span>
          {p.at && <JumpTo at={p.at} />}
          {p.status && (
            <span
              className={`ml-2 rounded px-1.5 py-0.5 text-xs ${p.status === "agreed" ? "bg-green-100 text-green-900 dark:bg-green-950 dark:text-green-200" : "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"}`}
            >
              {p.status}
            </span>
          )}
          <span className={`block ${muted}`}>{p.why}</span>
          {p.status === "disputed" && p.sides && (
            <span className="block text-sm">
              For: {p.sides.for} Against: {p.sides.against}
            </span>
          )}
        </li>
      ))}
    </List>
  );
}

function CombinedReview({
  title,
  review,
  small,
  follow,
}: {
  title: string;
  review: Combined | Review;
  small?: boolean;
  follow?: boolean;
}) {
  const H = small ? "h3" : "h2";
  return (
    <section className={`${card} flex flex-col gap-3`}>
      <H className={small ? "font-semibold" : "text-lg font-semibold"}>{title}</H>
      <p>{review.summary}</p>
      <div>
        <h4 className="font-medium">What&apos;s good</h4>
        <PointList points={review.good} section="good" follow={follow} />
      </div>
      <div>
        <h4 className="font-medium">What to fix, most important first</h4>
        <PointList points={review.fix} section="fix" ranked follow={follow} />
      </div>
      <div>
        <h4 className="font-medium">Drills</h4>
        <ul className="flex flex-col gap-1 pl-5 list-disc">
          {review.drills.map((d, i) => (
            <li key={i}>
              <span className="font-medium">{d.name}</span>: {d.how} <span className={muted}>({d.reps})</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h4 className="font-medium">Film next time</h4>
        <p>{review.filmNext}</p>
      </div>
    </section>
  );
}

// VID-3d: once, never changed.
function Vote({ r, onVoted }: { r: VideoReviewDetail; onVoted: (m: ReviewModel) => void }) {
  const [error, setError] = useState<string | null>(null);
  if (r.parentVote)
    return (
      <p className={card}>
        Your vote: <span className="font-medium">{MODEL_LABEL[r.parentVote]}&apos;s review</span> was more
        useful.
      </p>
    );
  return (
    <section className={`${card} flex flex-col gap-2`} aria-labelledby="vote">
      <h2 id="vote" className="font-semibold">
        Which review was actually more useful?
      </h2>
      <p className={`text-sm ${muted}`}>
        Your vote is saved once and can&apos;t be changed. It&apos;s the real measure.
      </p>
      <div className="flex flex-wrap gap-2">
        {REVIEW_MODELS.map((m) => (
          <button
            key={m}
            type="button"
            className="rounded border px-3 py-1"
            onClick={async () => {
              try {
                await call(`/api/v1/videos/${r.id}/vote`, "POST", { vote: m });
                onVoted(m);
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            {MODEL_LABEL[m]}&apos;s review
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </section>
  );
}

type ScoreMap = Partial<Record<ReviewModel, Record<string, number>>>;

function ScoresTable({ r }: { r: VideoReviewDetail }) {
  const rows = r.rounds.filter((x) => x.round === "critique" || x.round === "final_score");
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm" aria-label="Judges' scores">
        <caption className="py-1 text-left font-medium">
          Judges&apos; scores (1–5 each; own review marked “self”)
        </caption>
        <thead className={muted}>
          <tr>
            <th className="py-1 pr-3 font-medium">Judge</th>
            <th className="py-1 pr-3 font-medium">Round</th>
            <th className="py-1 pr-3 font-medium">Review</th>
            {CRITERIA.map((c) => (
              <th key={c} className="py-1 pr-3 font-medium">
                {CRITERION_LABEL[c]}
              </th>
            ))}
            <th className="py-1 pr-3 font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.flatMap((x) =>
            REVIEW_MODELS.map((m) => {
              const s = (x.scores as ScoreMap | null)?.[m];
              if (!s) return null;
              return (
                <tr
                  key={`${x.round}-${x.model}-${m}`}
                  className="border-t border-neutral-200 dark:border-neutral-800"
                >
                  <td className="py-1 pr-3">{MODEL_LABEL[x.model]}</td>
                  <td className="py-1 pr-3">{x.round === "critique" ? "First" : "Final"}</td>
                  <td className="py-1 pr-3">
                    {MODEL_LABEL[m]}
                    {m === x.model && <span className={muted}> (self)</span>}
                  </td>
                  {CRITERIA.map((c) => (
                    <td key={c} className="py-1 pr-3 tabular-nums">
                      {s[c]}
                    </td>
                  ))}
                  <td className="py-1 pr-3 font-medium tabular-nums">{s.total}</td>
                </tr>
              );
            }),
          )}
        </tbody>
      </table>
    </div>
  );
}

function Critiques({ r }: { r: VideoReviewDetail }) {
  const critiques = r.rounds.filter((x) => x.round === "critique");
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {critiques.map((x) => {
        const labels = x.labels as { A: ReviewModel; B: ReviewModel } | null;
        const out = x.output as Critique;
        return (
          <section key={x.model} className="flex flex-col gap-2">
            <h3 className="font-semibold">{MODEL_LABEL[x.model]}&apos;s critique</h3>
            {out.reviews.map((k) => {
              const of = labels ? labels[k.label] : null;
              return (
                <div key={k.label} className="text-sm">
                  <p className="font-medium">
                    Of {of ? `${MODEL_LABEL[of]}'s review` : `review ${k.label}`} (seen as “Review {k.label}”)
                  </p>
                  <p>{k.comment}</p>
                  {k.unsupported.length > 0 && <p>Can&apos;t be seen: {k.unsupported.join("; ")}</p>}
                  {k.errors.length > 0 && (
                    <p>Errors: {k.errors.map((e) => `${e.point}: ${e.reason}`).join("; ")}</p>
                  )}
                  {k.missed.length > 0 && <p>Missed: {k.missed.join("; ")}</p>}
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

function Rebuttals({ r }: { r: VideoReviewDetail }) {
  const rebuttals = r.rounds.filter((x) => x.round === "rebuttal");
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {rebuttals.map((x) => (
        <section key={x.model} className="flex flex-col gap-1 text-sm">
          <h3 className="font-semibold">{MODEL_LABEL[x.model]}&apos;s replies</h3>
          <ul className="flex flex-col gap-1 pl-5 list-disc">
            {(x.output as Rebuttal).replies.map((p, i) => (
              <li key={i}>
                <span className="font-medium">{p.response === "concede" ? "Concedes" : "Defends"}</span> “
                {p.point}”: {p.argument}
                {p.at && <JumpTo at={p.at} />}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
