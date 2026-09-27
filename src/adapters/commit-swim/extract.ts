// Runs INSIDE team.commitswimming.com (a Meteor app) through Playwright's
// page.evaluate, after sign-in. It calls the same read-only Meteor methods
// the parent pages call (see spikes.md SP-3) and returns only the fields
// this site needs, for one athlete. The site also sends other families'
// names, addresses and notes to the browser; none of that leaves this
// function.
//
// It must be self-contained: no imports and no closures over module scope,
// because Playwright serialises it into the page.

export type CommitSignupEvent = {
  distance: number;
  stroke: string;
  course: string | null;
  day: number | null;
  sessionStart: string | null; // e.g. "08:50AM", meet local time
  seedTime: number | null; // centiseconds
};

export type CommitSignup = {
  id: string;
  title: string;
  start: string; // ISO
  end: string; // ISO
  timeZone: string | null;
  course: string | null;
  venue: string | null;
  city: string | null;
  // Meets have an events list; team practices and socials don't.
  isMeet: boolean;
  answer: "yes" | "no" | null;
  // Only the events the athlete is entered in.
  entries: CommitSignupEvent[];
};

export type CommitResultMeet = {
  id: string;
  name: string;
  start: string | null;
  end: string | null;
  course: string | null;
  city: string | null;
};

export type CommitSwim = {
  id: string;
  meetId: string;
  date: string | null;
  distance: number;
  stroke: string;
  course: string;
  relay: boolean;
  stage: string | null;
  raceTime: number | null; // centiseconds
  seedTime: number | null;
  place: number | null;
  heat: number | null;
  lane: number | null;
  dq: string | null;
};

export type CommitSplit = { resultId: string; leg: number; distance: number; time: number | null };

export type CommitRaw = {
  // The team's pages on the site, for "open in Commit" links.
  siteUrl: string;
  signups: CommitSignup[];
  meets: CommitResultMeet[];
  swims: CommitSwim[];
  splits: CommitSplit[];
};

export type ExtractArgs = { athleteFirstName: string | null; gapMs: number };

export type ExtractResult = { ok: true; raw: CommitRaw } | { ok: false; problem: string };

export async function extractInPage(args: ExtractArgs): Promise<ExtractResult> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const w = globalThis as any;
  const Meteor = w.Meteor;
  if (!Meteor?.connection) return { ok: false, problem: "not-meteor" };
  const userId = Meteor.userId();
  if (!userId) return { ok: false, problem: "signed-out" };
  const superTeamId = String(w.location.pathname.split("/")[2] ?? "");
  if (!superTeamId) return { ok: false, problem: "no-team" };

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const coll = (name: string) => Meteor.connection._mongo_livedata_collections?.[name];
  const call = (name: string, ...params: unknown[]) =>
    new Promise<any>((resolve, reject) =>
      Meteor.call(name, ...params, (err: unknown, res: unknown) => (err ? reject(err) : resolve(res))),
    );
  const iso = (d: unknown) => (d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString() : null);
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

  // The dashboard subscribes to the athlete list and the static event table
  // (distance, stroke, course). Wait for both.
  let kids: any[] = [];
  for (let i = 0; i < 60; i++) {
    kids = Meteor.users.find({ parentIds: userId, roles: "athlete" }).fetch();
    if (kids.length && coll("REventsStatic")?.find().count() > 0 && coll("SuperTeams")?.findOne()) break;
    await sleep(500);
  }
  if (!kids.length) return { ok: false, problem: "no-athlete" };
  const wanted = args.athleteFirstName?.trim().toLowerCase();
  const kid = wanted
    ? kids.find(
        (k) =>
          String(k.profile?.firstName ?? "").toLowerCase() === wanted ||
          String(k.profile?.preferredName ?? "").toLowerCase() === wanted,
      )
    : kids.length === 1
      ? kids[0]
      : null;
  if (!kid) return { ok: false, problem: kids.length > 1 ? "many-athletes" : "athlete-not-found" };
  const athleteId: string = kid._id;
  const superTeam = coll("SuperTeams").findOne({ _id: superTeamId }) ?? coll("SuperTeams").findOne();
  const staticEvents = coll("REventsStatic");

  // Meet sign-ups: upcoming, then past, paged.
  const signupDocs: any[] = [];
  for (const method of ["getUpcomingMeetsForParent", "getPastMeetsForParent"]) {
    for (let page = 1; page <= 20; page++) {
      const res = await call(method, superTeamId, page, 50, null);
      await sleep(args.gapMs);
      signupDocs.push(...(res?.meets ?? []));
      if (!res || page >= (res.totalPages ?? 1)) break;
    }
  }
  const signups: CommitSignup[] = [];
  for (const m of signupDocs) {
    const invited = (m.invitedAthleteIds ?? []).includes(athleteId);
    const commitment = (m.commitments ?? []).find((c: any) => c.athleteId === athleteId);
    if (!invited && !commitment) continue;
    const start = iso(m.startDateTime);
    const title = str(m.userTitle) ?? str(m.titleEventsFile);
    if (!start || !title) continue;
    const events: any[] = m.events ?? [];
    const entries: CommitSignupEvent[] = [];
    for (const e of events) {
      const entry = (e.activeEntries ?? []).find((a: any) => a.athleteId === athleteId);
      if (!entry || e.individualOrRelay === "R") continue;
      entries.push({
        distance: Number(e.distance),
        stroke: String(e.stroke),
        course: str(e.course),
        day: num(e.day),
        sessionStart: str(e.sessionStartTime),
        seedTime: entry.suppressSeed ? null : num(entry.seedTime),
      });
    }
    const answer = commitment?.overallAnswer;
    signups.push({
      id: String(m._id),
      title,
      start,
      end: iso(m.endDateTime) ?? start,
      timeZone: str(m.meetTimezone),
      course: str(m.course),
      venue: str(m.locationDetails),
      city: str(m.city),
      isMeet: events.length > 0 || (m.listOfEventsEventsFile ?? []).length > 0,
      answer: answer === "yes" || answer === "no" ? answer : null,
      entries,
    });
  }

  // Every result for the athlete, with splits, oldest first.
  const res = await call("oneAthleteResultsPartialAccountAgnostic", {
    athleteId,
    accountId: superTeam?.accountId,
    flatStartOnly: false,
    sortOrder: "date",
    maxResults: 5000,
  });
  const eventsById = new Map<string, any>((res?.events ?? []).map((e: any) => [e._id, e]));
  const swims: CommitSwim[] = [];
  for (const r of res?.results ?? []) {
    if (r.athleteId !== athleteId) continue;
    const se = staticEvents.findOne({ _id: r.staticEventId });
    if (!se) continue;
    swims.push({
      id: String(r._id),
      meetId: String(r.meetId),
      date: iso(r.dateTime),
      distance: Number(se.distance),
      stroke: String(se.stroke),
      course: String(se.course),
      relay: se.type === "relay" || r.raceType === "R",
      stage: str(eventsById.get(r.eventId)?.stage),
      raceTime: num(r.raceTime),
      seedTime: num(r.seedTime),
      place: num(r.place),
      heat: num(r.heatNum),
      lane: num(r.laneNum),
      dq: str(r.dqReason),
    });
  }
  const swimIds = new Set(swims.map((s) => s.id));
  const splits: CommitSplit[] = (res?.splits ?? [])
    .filter((s: any) => swimIds.has(s.resultId))
    .map((s: any) => ({
      resultId: String(s.resultId),
      leg: Number(s.leg),
      distance: Number(s.distance),
      time: num(s.time),
    }));
  const meetIds = new Set(swims.map((s) => s.meetId));
  const meets: CommitResultMeet[] = (res?.meets ?? [])
    .filter((m: any) => meetIds.has(m._id) || meetIds.has(m.meetId))
    .map((m: any) => ({
      id: String(meetIds.has(m._id) ? m._id : m.meetId),
      name: str(m.name) ?? "Meet",
      start: iso(m.startDateTime),
      end: iso(m.endDateTime),
      course: str(m.course),
      city: str(m.city),
    }));

  const siteUrl = `${w.location.origin}/app/${superTeamId}`;
  return { ok: true, raw: { siteUrl, signups, meets, swims, splits } };
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
