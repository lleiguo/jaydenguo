// Review points on the playback copy's timeline (intent 0003, PLAY-4,
// PLAY-5). Times are the clip's clock (PLAY-6).

// The first "m:ss" in a cited time. Models sometimes write a span
// ("0:04-0:06") or pad the minutes ("00:04"); the start is what matters.
export function citedSeconds(at: string | null | undefined): number | null {
  const m = at ? /(\d+):([0-5]\d(?:\.\d+)?)/.exec(at) : null;
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export type TimelinePoint = {
  key: string; // "good-0", "fix-2": the section and the point's place in it
  kind: "good" | "fix";
  text: string;
  sec: number;
  disputed: boolean;
};

type CitedPoint = { text: string; at: string | null; status?: "agreed" | "disputed" };

export function timelinePoints(review: { good: CitedPoint[]; fix: CitedPoint[] }): TimelinePoint[] {
  const points: TimelinePoint[] = [];
  for (const kind of ["good", "fix"] as const) {
    review[kind].forEach((p, i) => {
      const sec = citedSeconds(p.at);
      if (sec !== null)
        points.push({ key: `${kind}-${i}`, kind, text: p.text, sec, disputed: p.status === "disputed" });
    });
  }
  return points.sort((a, b) => a.sec - b.sec);
}

// How long a point stays on screen after its time.
export const SHOW_FOR_SEC = 2;

// The point being shown at time t: the latest one whose window holds t.
export function activePoint(points: TimelinePoint[], t: number): TimelinePoint | null {
  let found: TimelinePoint | null = null;
  for (const p of points) if (p.sec <= t && t < p.sec + SHOW_FOR_SEC) found = p;
  return found;
}
