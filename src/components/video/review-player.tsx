"use client";

import { createContext, useCallback, useContext, useRef, useState, type RefObject } from "react";
import { call } from "@/components/calendar/api";
import { formatClockTime } from "@/domain/video-links";
import { activePoint, citedSeconds, type TimelinePoint } from "@/domain/review-timeline";

// The playback copy next to its review (intent 0003, PLAY-3..5, PLAY-7):
// the video, a strip of markers for the advice's points, the point at the
// current time, slow motion and frame steps. Points anywhere on the page
// jump the video through PlayerContext.

const muted = "text-neutral-600 dark:text-neutral-400";
const card = "rounded-md border border-neutral-200 p-3 dark:border-neutral-800";
// The clip is at most 30 frames a second (src/worker/video/media.ts).
const FRAME_SEC = 1 / 30;
const SPEEDS = [0.25, 0.5, 1] as const;

type Player = { seek: (sec: number) => void; activeKey: string | null };
const PlayerContext = createContext<Player | null>(null);

export function usePlayback(points: TimelinePoint[]) {
  const ref = useRef<HTMLVideoElement>(null);
  const [time, setTime] = useState(0);
  const seek = useCallback((sec: number) => {
    const v = ref.current;
    if (!v) return;
    v.pause();
    v.currentTime = sec;
    setTime(sec);
    v.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);
  const active = activePoint(points, time);
  return { ref, time, setTime, seek, active };
}

export type Playback = ReturnType<typeof usePlayback>;

export function PlaybackProvider({
  playback,
  children,
}: {
  playback: Playback | null;
  children: React.ReactNode;
}) {
  const value = playback ? { seek: playback.seek, activeKey: playback.active?.key ?? null } : null;
  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export const usePlayer = () => useContext(PlayerContext);

// "at 0:04", as a button that shows that moment when there's a video.
export function JumpTo({ at }: { at: string }) {
  const player = usePlayer();
  const sec = citedSeconds(at);
  if (!player || sec === null) return <span className={muted}> (at {at})</span>;
  return (
    <>
      {" "}
      <button
        type="button"
        className="text-sm text-blue-700 underline dark:text-blue-400"
        aria-label={`Show ${formatClockTime(sec)} in the video`}
        onClick={() => player.seek(sec)}
      >
        at {at}
      </button>
    </>
  );
}

const pointLabel = (p: TimelinePoint) =>
  p.kind === "good" ? "Good" : `Fix ${Number(p.key.split("-")[1]) + 1}${p.disputed ? " (disputed)" : ""}`;

export function ReviewPlayer({
  reviewId,
  playback,
  points,
  durationSec,
  segmentStart,
  onDeleted,
}: {
  reviewId: string;
  playback: Playback;
  points: TimelinePoint[];
  durationSec: number | null;
  segmentStart: number | null;
  onDeleted: () => void;
}) {
  const { ref, time, setTime, seek, active } = playback;
  const [duration, setDuration] = useState(durationSec ?? 0);
  const [speed, setSpeed] = useState<number>(1);
  const [error, setError] = useState<string | null>(null);
  const pct = (sec: number) => (duration > 0 ? Math.min(100, (sec / duration) * 100) : 0);

  const step = (frames: number) => {
    const v = ref.current;
    if (!v) return;
    v.pause();
    v.currentTime = Math.max(0, Math.min(v.duration || duration, v.currentTime + frames * FRAME_SEC));
  };

  return (
    <section className={`${card} flex flex-col gap-2`} aria-label="The video">
      <Video
        videoRef={ref}
        src={`/api/v1/videos/${reviewId}/video`}
        onTime={setTime}
        onDuration={setDuration}
        onError={() => setError("The video couldn't be loaded.")}
      />
      {duration > 0 && (
        // Markers for the advice's points; the list below has the same
        // jumps as buttons for keyboards and screen readers.
        <svg className="h-5 w-full overflow-visible" aria-hidden="true" data-testid="point-markers">
          <line
            x1="0"
            x2="100%"
            y1="10"
            y2="10"
            className="stroke-neutral-300 dark:stroke-neutral-700"
            strokeWidth="2"
          />
          <line
            x1={`${pct(time)}%`}
            x2={`${pct(time)}%`}
            y1="2"
            y2="18"
            className="stroke-neutral-900 dark:stroke-white"
            strokeWidth="2"
          />
          {points.map((p) => (
            <circle
              key={p.key}
              cx={`${pct(p.sec)}%`}
              cy="10"
              r={active?.key === p.key ? 7 : 5}
              className={`cursor-pointer ${p.kind === "good" ? "fill-green-600" : "fill-amber-500"} ${p.disputed ? "stroke-neutral-900 dark:stroke-white" : ""}`}
              strokeWidth={p.disputed ? 2 : 0}
              strokeDasharray={p.disputed ? "2 2" : undefined}
              onClick={() => seek(p.sec)}
            >
              <title>{`${pointLabel(p)} at ${formatClockTime(p.sec)}: ${p.text}`}</title>
            </circle>
          ))}
        </svg>
      )}
      <p className="min-h-6" data-testid="current-point">
        {active ? (
          <>
            <span
              className={`font-medium ${active.kind === "good" ? "text-green-700 dark:text-green-400" : "text-amber-700 dark:text-amber-400"}`}
            >
              {pointLabel(active)}:
            </span>{" "}
            {active.text}
          </>
        ) : (
          <span className={muted}>
            {points.length > 0 ? "Points show here as the video reaches them." : "No points name a time."}
          </span>
        )}
      </p>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className={muted}>Speed</span>
        {SPEEDS.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={speed === s}
            className={`rounded border px-2 py-0.5 ${speed === s ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900" : ""}`}
            onClick={() => {
              setSpeed(s);
              if (ref.current) ref.current.playbackRate = s;
            }}
          >
            {s}×
          </button>
        ))}
        <span className={`ml-2 ${muted}`}>Frame</span>
        <button
          type="button"
          className="rounded border px-2 py-0.5"
          aria-label="Back one frame"
          onClick={() => step(-1)}
        >
          ◀
        </button>
        <button
          type="button"
          className="rounded border px-2 py-0.5"
          aria-label="Forward one frame"
          onClick={() => step(1)}
        >
          ▶
        </button>
        <span className={`tabular-nums ${muted}`} data-testid="video-time">
          {formatClockTime(time)}
        </span>
      </div>
      {segmentStart !== null && segmentStart > 0 && (
        <p className={`text-xs ${muted}`}>
          This is the part that was reviewed. Times count from its start ({formatClockTime(segmentStart)} in
          the original).
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={muted}>
          A private copy of the reviewed part, without sound, kept until you delete it.
        </span>
        <button
          type="button"
          className="rounded border px-2 py-0.5"
          onClick={async () => {
            if (!confirm("Delete the video copy? The review stays.")) return;
            try {
              await call(`/api/v1/videos/${reviewId}/video`, "DELETE");
              onDeleted();
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        >
          Delete video
        </button>
      </div>
      {error && (
        <p role="alert" className="text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </section>
  );
}

function Video({
  videoRef,
  src,
  onTime,
  onDuration,
  onError,
}: {
  videoRef: RefObject<HTMLVideoElement | null>;
  src: string;
  onTime: (t: number) => void;
  onDuration: (d: number) => void;
  onError: () => void;
}) {
  return (
    <video
      ref={videoRef}
      src={src}
      controls
      playsInline
      muted
      preload="metadata"
      className="max-h-[70vh] w-full rounded bg-black"
      onTimeUpdate={(e) => onTime(e.currentTarget.currentTime)}
      onSeeked={(e) => onTime(e.currentTarget.currentTime)}
      onLoadedMetadata={(e) =>
        Number.isFinite(e.currentTarget.duration) && onDuration(e.currentTarget.duration)
      }
      onError={onError}
    />
  );
}
