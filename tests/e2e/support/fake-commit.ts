import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { CommitRaw } from "../../../src/adapters/commit-swim/extract";
import { FAKE_COMMIT_PORT } from "./fake-commit-port";

// A stand-in for team.commitswimming.com (SP-3) for integration and e2e
// tests: a sign-in page and a team dashboard whose `window.Meteor` answers
// the same methods the real site does, from the scrubbed fixture. Another
// family's swimmer is mixed in, to prove the extractor only returns ours.
// Loopback only, like the fake Google server.

export const FAKE_COMMIT_LOGIN = { username: "parent@example.test", password: "fixture-password" };
export const OTHER_FAMILY_NAME = "Otherkid Private";

type Options = {
  raw?: CommitRaw;
  // Pretend "now" for splitting upcoming and past sign-ups.
  now?: () => Date;
  requireCode?: boolean;
};

function commitShape(raw: CommitRaw, now: Date) {
  const ME = "ath-ours";
  const OTHER = "ath-other";
  const statics: { _id: string; distance: number; stroke: string; course: string; type: string }[] = [];
  const staticId = (distance: number, stroke: string, course: string) => {
    let s = statics.find((x) => x.distance === distance && x.stroke === stroke && x.course === course);
    if (!s)
      statics.push((s = { _id: `se${statics.length + 1}`, distance, stroke, course, type: "individual" }));
    return s._id;
  };
  const signups = raw.signups.map((s) => ({
    _id: s.id,
    userTitle: s.title,
    startDateTime: s.start,
    endDateTime: s.end,
    meetTimezone: s.timeZone ?? undefined,
    course: s.course,
    locationDetails: s.venue,
    city: s.city,
    invitedAthleteIds: [OTHER, ME],
    commitments: [
      { athleteId: OTHER, overallAnswer: "yes", commitmentLog: [{ name: OTHER_FAMILY_NAME }] },
      ...(s.answer ? [{ athleteId: ME, overallAnswer: s.answer }] : []),
    ],
    listOfEventsEventsFile: s.isMeet ? [{}] : [],
    events: s.isMeet
      ? [
          ...s.entries.map((e, i) => ({
            _id: `${s.id}-e${i}`,
            distance: e.distance,
            stroke: e.stroke,
            course: e.course,
            day: e.day,
            sessionStartTime: e.sessionStart,
            individualOrRelay: "I",
            activeEntries: [
              { athleteId: ME, entryType: "I", ...(e.seedTime ? { seedTime: e.seedTime } : {}) },
            ],
          })),
          {
            _id: `${s.id}-other`,
            distance: 400,
            stroke: "Free",
            course: s.course,
            individualOrRelay: "I",
            activeEntries: [{ athleteId: OTHER, seedTime: 123456 }],
          },
        ]
      : [],
  }));
  const results = raw.swims.map((w) => ({
    _id: w.id,
    athleteId: ME,
    meetId: w.meetId,
    dateTime: w.date,
    staticEventId: staticId(w.distance, w.stroke, w.course),
    eventId: `ev-${w.id}`,
    raceTime: w.raceTime,
    seedTime: w.seedTime,
    place: w.place,
    heatNum: w.heat,
    laneNum: w.lane,
    dqReason: w.dq,
    raceType: w.relay ? "R" : "I",
  }));
  results.push({ ...results[0], _id: "other-swim", athleteId: OTHER });
  return {
    users: [
      { _id: ME, parentIds: ["parent-1"], roles: ["athlete"], profile: { firstName: "Sam" } },
      { _id: OTHER, parentIds: ["parent-2"], roles: ["athlete"], profile: { firstName: OTHER_FAMILY_NAME } },
    ],
    statics,
    upcoming: signups.filter((s) => new Date(s.startDateTime) >= now),
    past: signups.filter((s) => new Date(s.startDateTime) < now),
    oneAthlete: {
      results,
      events: raw.swims.map((w) => ({ _id: `ev-${w.id}`, stage: w.stage })),
      splits: raw.splits,
      meets: raw.meets.map((m) => ({
        _id: m.id,
        name: m.name,
        startDateTime: m.start,
        endDateTime: m.end,
        course: m.course,
        city: m.city,
      })),
    },
  };
}

// The page script: a tiny Meteor with only what the site's pages use.
const meteorShim = (requireCode: boolean) => `
const D = window.__COMMIT;
const toDate = (v) => (typeof v === "string" && /^\\d{4}-\\d\\d-\\d\\dT/.test(v) ? new Date(v) : v);
const dates = (o) => Array.isArray(o) ? o.map(dates) : o && typeof o === "object"
  ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "string" ? toDate(v) : dates(v)])) : o;
const coll = (docs) => ({
  find: (q = {}) => {
    const hits = docs.filter((d) => Object.entries(q).every(([k, v]) => [].concat(d[k]).includes(v)));
    return { fetch: () => hits, count: () => hits.length };
  },
  findOne: (q = {}) => docs.find((d) => Object.entries(q).every(([k, v]) => d[k] === v)),
});
const page = (list, p, n) => ({ meets: dates(list.slice((p - 1) * n, p * n)), total: list.length, page: p,
  totalPages: Math.max(1, Math.ceil(list.length / n)) });
const methods = {
  getUpcomingMeetsForParent: (team, p, n) => page(D.upcoming, p, n),
  getPastMeetsForParent: (team, p, n) => page(D.past, p, n),
  oneAthleteResultsPartialAccountAgnostic: (args) => {
    if (args.accountId !== "acc-1") throw { error: 403, reason: "Access denied" };
    return dates(D.oneAthlete);
  },
};
window.Meteor = {
  status: () => ({ connected: true }),
  userId: () => localStorage.getItem("uid"),
  users: coll(D.users),
  loginWithPassword(u, p, cb) {
    setTimeout(() => {
      if (${requireCode}) return cb({ error: "no-2fa-code", reason: "2FA code must be informed" });
      if (u !== D.login.username) return cb({ error: 403, reason: "User not found" });
      if (p !== D.login.password) return cb({ error: 403, reason: "Incorrect password" });
      localStorage.setItem("uid", "parent-1");
      cb();
      location.assign("/app/fixtureteam");
    }, 50);
  },
  call(name, ...args) {
    const cb = args.pop();
    setTimeout(() => {
      if (!localStorage.getItem("uid")) return cb({ error: 403, reason: "not signed in" });
      try { cb(undefined, methods[name](...args)); } catch (e) { cb(e); }
    }, 10);
  },
  connection: { _mongo_livedata_collections: {
    REventsStatic: coll(D.statics),
    SuperTeams: coll([{ _id: "fixtureteam", accountId: "acc-1" }]),
  } },
};
`;

export function createFakeCommit(opts: Options = {}): Server {
  const raw =
    opts.raw ?? (JSON.parse(readFileSync("tests/fixtures/commit-swim/athlete.json", "utf8")) as CommitRaw);
  return createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const data = { ...commitShape(raw, opts.now?.() ?? new Date()), login: FAKE_COMMIT_LOGIN };
    // Signed-in pages and the sign-in page all load the same app, as on the real site.
    if (url.pathname === "/sign-in" || url.pathname.startsWith("/app")) {
      const json = JSON.stringify(data).replace(/</g, "\\u003c");
      res.writeHead(200, { "content-type": "text/html" });
      res.end(
        `<!doctype html><title>Commit Swimming (fake)</title><main>Fake</main>` +
          `<script>window.__COMMIT = ${json};${meteorShim(!!opts.requireCode)}</script>`,
      );
      return;
    }
    res.writeHead(404).end();
  });
}

if (process.argv[1]?.endsWith("fake-commit.ts")) {
  const server = createFakeCommit({
    now: () => new Date(process.env.FAKE_COMMIT_NOW ?? "2024-09-29T12:00:00Z"),
  });
  server.listen(FAKE_COMMIT_PORT, "127.0.0.1", () =>
    console.log(`fake Commit Swimming on http://127.0.0.1:${FAKE_COMMIT_PORT}`),
  );
}
