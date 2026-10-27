"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { call } from "@/components/calendar/api";
import {
  MAX_QUESTION_CHARS,
  SPORT_LABEL,
  sportText,
  VIDEO_SPORTS,
  type VideoSport,
} from "@/domain/video-constants";
import { answerPoints, timelinePoints } from "@/domain/review-timeline";
import { formatClockTime } from "@/domain/video-links";
import type { Review } from "@/server/video/prompts";
import type { VideoQuestion } from "@/server/video/questions";
import type { VideoReviewDetail } from "@/server/video/store";
import { inProgress, STATUS_LABEL, statusTone } from "./history";
import { JumpTo, PlaybackProvider, ReviewPlayer, usePlayback, usePlayer } from "./review-player";

const muted = "text-neutral-600 dark:text-neutral-400";
const card = "rounded-md border border-neutral-200 p-3 dark:border-neutral-800";

type Point = Review["good"][number];

export function ReviewView({ initial }: { initial: VideoReviewDetail }) {
  const router = useRouter();
  const [r, setR] = useState(initial);
  const [message, setMessage] = useState<string | null>(null);
  const running = inProgress(r.status);
  const answering = r.questions.some((q) => q.status === "queued" || q.status === "answering");
  const advice = r.status === "done" ? (r.combinedReview as Review | null) : null;
  // The review's points and the follow-up answers' (intent 0026, ASK-4).
  const points = useMemo(() => {
    const answers = r.questions.flatMap((q) => (q.status === "done" && q.answer ? [q.answer] : []));
    return [...(advice ? timelinePoints(advice) : []), ...answerPoints(answers)].sort(
      (a, b) => a.sec - b.sec,
    );
  }, [advice, r.questions]);
  const playback = usePlayback(points);
  const hasPlayer = r.status === "done" && r.hasPlayback;

  // VID-5: progress while the job runs; intent 0026, ASK-3: and while a
  // question is being answered.
  useEffect(() => {
    if (!running && !answering) return;
    const timer = setInterval(async () => {
      const res = await fetch(`/api/v1/videos/${r.id}`);
      if (res.ok) setR((await res.json()) as VideoReviewDetail);
    }, 3000);
    return () => clearInterval(timer);
  }, [running, answering, r.id]);

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
            <p className={`text-xs ${muted}`}>A review takes a minute or two.</p>
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
                onDeleted={async () => {
                  // Read again: no copy also means no more questions (intent 0026, ASK-1).
                  const res = await fetch(`/api/v1/videos/${r.id}`);
                  setR(res.ok ? ((await res.json()) as VideoReviewDetail) : { ...r, hasPlayback: false });
                }}
              />
            )}
            {advice && <ReviewCard review={advice} />}
            <Questions r={r} onChanged={setR} />
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
            {SPORT_LABEL[pending]}? That runs the whole review again.
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

// The point at the video's current time is highlighted (intent 0003,
// PLAY-5). Keys match timelinePoints.
function PointList({
  points,
  ranked,
  section,
}: {
  points: Point[];
  ranked?: boolean;
  section: "good" | "fix";
}) {
  const player = usePlayer();
  const List = ranked ? "ol" : "ul";
  return (
    <List className={`flex flex-col gap-2 pl-5 ${ranked ? "list-decimal" : "list-disc"}`}>
      {points.map((p, i) => (
        <li
          key={i}
          data-active={player?.activeKey === `${section}-${i}` ? "" : undefined}
          className="rounded data-[active]:bg-yellow-100 dark:data-[active]:bg-yellow-950"
        >
          <span className="font-medium">{p.text}</span>
          {p.at && <JumpTo at={p.at} />}
          <span className={`block ${muted}`}>{p.why}</span>
        </li>
      ))}
    </List>
  );
}

function ReviewCard({ review }: { review: Review }) {
  return (
    <section className={`${card} flex flex-col gap-3`}>
      <h2 className="text-lg font-semibold">The review</h2>
      <p>{review.summary}</p>
      <div>
        <h4 className="font-medium">What&apos;s good</h4>
        <PointList points={review.good} section="good" />
      </div>
      <div>
        <h4 className="font-medium">What to fix, most important first</h4>
        <PointList points={review.fix} section="fix" ranked />
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

// intent 0026, ASK-1..5: follow-up questions on the review, oldest first,
// and a box to ask the next one. Answers come from a job; the page polls.
function Questions({ r, onChanged }: { r: VideoReviewDetail; onChanged: (r: VideoReviewDetail) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const answered = r.questions.filter((q) => q.status === "done");

  async function send(url: string, body?: unknown) {
    setError(null);
    setBusy(true);
    try {
      await call(url, "POST", body);
      const res = await fetch(`/api/v1/videos/${r.id}`);
      if (res.ok) onChanged((await res.json()) as VideoReviewDetail);
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`${card} flex flex-col gap-3`} aria-label="Questions about this video">
      <h2 className="text-lg font-semibold">Ask about this video</h2>
      {r.questions.length > 0 && (
        <ol className="flex flex-col gap-3">
          {r.questions.map((q) => (
            <QuestionItem
              key={q.id}
              q={q}
              n={answered.indexOf(q) + 1}
              busy={busy}
              onRetry={() => send(`/api/v1/videos/${r.id}/questions/${q.id}/retry`)}
            />
          ))}
        </ol>
      )}
      {r.cannotAsk && !r.questions.some((q) => q.status === "queued" || q.status === "answering") ? (
        <p className={`text-sm ${muted}`}>{r.cannotAsk}</p>
      ) : (
        <form
          className="flex flex-col gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await send(`/api/v1/videos/${r.id}/questions`, { question: text })) setText("");
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            <span className={muted}>
              Gemini watches the video again to answer, so each question costs about as much as the review.
            </span>
            <textarea
              aria-label="Your question"
              value={text}
              maxLength={MAX_QUESTION_CHARS}
              rows={2}
              placeholder="Was his elbow high at 0:03?"
              onChange={(e) => setText(e.target.value)}
              className="rounded border px-2 py-1 dark:bg-neutral-900"
            />
          </label>
          <button
            type="submit"
            disabled={busy || !text.trim() || r.cannotAsk !== null}
            className="self-start rounded-md border bg-neutral-900 px-4 py-1.5 text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
          >
            Ask
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </section>
  );
}

function QuestionItem({
  q,
  n,
  busy,
  onRetry,
}: {
  q: VideoQuestion;
  n: number;
  busy: boolean;
  onRetry: () => void;
}) {
  const player = usePlayer();
  return (
    <li className="flex flex-col gap-1" data-testid="video-question">
      <p className="font-medium">{q.question}</p>
      <p className={`text-xs ${muted}`}>{new Date(q.createdAt).toLocaleString()}</p>
      {(q.status === "queued" || q.status === "answering") && (
        <p aria-live="polite" className={muted}>
          Answering… (usually under 2 minutes)
        </p>
      )}
      {q.status === "failed" && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-red-700 dark:text-red-400">{q.errorMessage ?? "The answer failed."}</p>
          <button
            type="button"
            disabled={busy}
            className="rounded border px-3 py-0.5 text-sm"
            onClick={onRetry}
          >
            Try again
          </button>
        </div>
      )}
      {q.status === "done" && q.answer && (
        <>
          <p>{q.answer.answer}</p>
          {q.answer.points.length > 0 && (
            <ul className="flex flex-col gap-1 pl-5 list-disc">
              {q.answer.points.map((p, i) => (
                <li
                  key={i}
                  data-active={player?.activeKey === `q${n}-${i}` ? "" : undefined}
                  className="rounded data-[active]:bg-yellow-100 dark:data-[active]:bg-yellow-950"
                >
                  <span className="font-medium">{p.text}</span>
                  {p.at && <JumpTo at={p.at} />}
                  <span className={`block ${muted}`}>{p.why}</span>
                </li>
              ))}
            </ul>
          )}
          {q.costUsd !== null && <p className={`text-xs ${muted}`}>About ${q.costUsd.toFixed(2)}</p>}
        </>
      )}
    </li>
  );
}
