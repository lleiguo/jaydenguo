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
  // The follow-up answer it comes from, counting from 1 (intent 0026, ASK-4).
  answer?: number;
};

type CitedPoint = { text: string; at: string | null };

export function timelinePoints(review: { good: CitedPoint[]; fix: CitedPoint[] }): TimelinePoint[] {
  const points: TimelinePoint[] = [];
  for (const kind of ["good", "fix"] as const) {
    review[kind].forEach((p, i) => {
      const sec = citedSeconds(p.at);
      if (sec !== null) points.push({ key: `${kind}-${i}`, kind, text: p.text, sec });
    });
  }
  return points.sort((a, b) => a.sec - b.sec);
}

// The points of the follow-up answers, keyed "q1-0", "q2-1"…, where n is
// the answer's place among the answered questions (intent 0026, ASK-4).
export function answerPoints(answers: { points: (CitedPoint & { good: boolean })[] }[]): TimelinePoint[] {
  const points: TimelinePoint[] = [];
  answers.forEach((a, n) =>
    a.points.forEach((p, i) => {
      const sec = citedSeconds(p.at);
      if (sec !== null)
        points.push({
          key: `q${n + 1}-${i}`,
          kind: p.good ? "good" : "fix",
          text: p.text,
          sec,
          answer: n + 1,
        });
    }),
  );
  return points;
}

// How long a point stays on screen after its time.
export const SHOW_FOR_SEC = 2;

// The point being shown at time t: the latest one whose window holds t.
export function activePoint(points: TimelinePoint[], t: number): TimelinePoint | null {
  let found: TimelinePoint | null = null;
  for (const p of points) if (p.sec <= t && t < p.sec + SHOW_FOR_SEC) found = p;
  return found;
}
