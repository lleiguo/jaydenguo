import { and, eq, inArray, or } from "drizzle-orm";
import {
  conflicts,
  emailMessages,
  emailSuggestions,
  eventOverrides,
  eventRevisions,
  events,
  eventSeries,
  locationBuffers,
  locations,
  people,
  sources,
  tennisEntries,
} from "@db/schema";
import type { Category } from "../domain/constants";
import { addDays, localDate, weekday, zonedToUtc } from "../domain/time";
import type { SourceRecord } from "../domain/upsert";
import { createSeries } from "../server/calendar/mutations";
import { getHomeTimeZone } from "../server/settings";
import { syncSwim } from "../server/swim/apply";
import { syncRecords } from "../server/sync/apply";
import type { Stroke } from "../domain/swim-constants";
import type { SwimMeetRecord, SwimResultRecord } from "../domain/swim-upsert";
import type { TennisMatchRecord, TennisTournamentRecord } from "../domain/tennis-upsert";
import { syncTennis } from "../server/tennis/apply";
import type { JobContext } from "./context";

// `pnpm seed` (plan M1.14, spec §5.2): a realistic fake season so the app
// is usable without connecting any real account. Every name and place is
// made up. Safe to run again: sources and series are matched by name.

const WEEKS = 10;

export async function seedJob(_args: string[], ctx: JobContext) {
  if (process.env.K_SERVICE || process.env.CLOUD_RUN_JOB)
    throw new Error("seed is for local development only");
  const db = await ctx.db();
  const tz = await getHomeTimeZone(db);
  const today = localDate(new Date(), tz);
  const monday = addDays(today, -((weekday(today) + 6) % 7));
  const at = (date: string, hhmm: string) => {
    const [y, m, d] = date.split("-").map(Number);
    const [h, mi] = hhmm.split(":").map(Number);
    return zonedToUtc({ year: y, month: m, day: d, hour: h, minute: mi, second: 0 }, tz);
  };

  // Places and travel times (CON-1).
  const place = async (name: string, match: string[]) => {
    const [row] = await db
      .insert(locations)
      .values({ name, match })
      .onConflictDoUpdate({ target: locations.name, set: { match } })
      .returning({ id: locations.id });
    return row.id;
  };
  const club = await place("Maple Tennis Club", ["maple tennis"]);
  const rec = await place("Cedar Rec Centre", ["cedar rec"]);
  const pool = await place("Birch Aquatic Centre", ["birch aquatic"]);
  const pair = (a: string, b: string, minutes: number) => {
    const [fromId, toId] = a < b ? [a, b] : [b, a];
    return db
      .insert(locationBuffers)
      .values({ fromId, toId, minutes })
      .onConflictDoUpdate({
        target: [locationBuffers.fromId, locationBuffers.toId],
        set: { minutes },
      });
  };
  await pair(club, rec, 30);
  await pair(club, pool, 25);
  await pair(rec, pool, 20);

  // People (owner, 2026-09-28): the primary person comes from the
  // migrations; a made-up parent and brother share the calendar.
  const person = async (name: string) => {
    const [existing] = await db.select().from(people).where(eq(people.name, name));
    if (existing) return existing.id;
    const [row] = await db.insert(people).values({ name }).returning({ id: people.id });
    return row.id;
  };
  const parent = await person("Parent");
  const brother = await person("Brother");

  const source = async (name: string, kind: string, category: Category) => {
    const [existing] = await db.select().from(sources).where(eq(sources.name, name));
    if (existing) return existing.id;
    const [row] = await db
      .insert(sources)
      .values({ name, kind, enabled: false, categoryMapping: { default: category } })
      .returning({ id: sources.id });
    return row.id;
  };

  type Draft = Pick<
    SourceRecord,
    "externalId" | "title" | "startUtc" | "endUtc" | "allDay" | "locationName"
  > &
    Partial<Pick<SourceRecord, "notes" | "sourceUrl">>;
  const records = (category: Category, make: (week: number, monday: string) => Draft[]): SourceRecord[] => {
    const out: SourceRecord[] = [];
    for (let w = -1; w < WEEKS; w++) {
      for (const r of make(w, addDays(monday, w * 7))) {
        out.push({ category, attendance: "required", notes: null, sourceUrl: null, ...r });
      }
    }
    return out;
  };
  const window = { from: null, to: null };

  const soccer = await source("Soccer team (sample)", "ical", "soccer");
  await syncRecords(
    db,
    { sourceId: soccer },
    records("soccer", (w, mon) => [
      {
        externalId: `practice-${w}`,
        title: "Soccer practice",
        startUtc: at(addDays(mon, 1), "17:00"),
        endUtc: at(addDays(mon, 1), "18:30"),
        allDay: false,
        locationName: "Oak Park Field 2",
      },
      {
        externalId: `game-${w}`,
        title: `Game vs ${["Red Rockets", "Green Giants", "Blue Jays"][((w % 3) + 3) % 3]}`,
        startUtc: at(addDays(mon, 5), "10:00"),
        endUtc: at(addDays(mon, 5), "11:30"),
        allDay: false,
        locationName: "Oak Park Field 1",
      },
    ]),
    window,
    { actor: "seed" },
  );

  const hockey = await source("Hockey team (sample)", "ical", "hockey");
  await syncRecords(
    db,
    { sourceId: hockey },
    records("hockey", (w, mon) => [
      {
        externalId: `ice-${w}`,
        title: "Hockey ice time",
        startUtc: at(addDays(mon, 3), "18:00"),
        endUtc: at(addDays(mon, 3), "19:00"),
        allDay: false,
        locationName: "Pine Arena",
      },
      {
        externalId: `hgame-${w}`,
        title: "Hockey game",
        startUtc: at(addDays(mon, 6), "09:00"),
        endUtc: at(addDays(mon, 6), "10:15"),
        allDay: false,
        locationName: "Pine Arena",
      },
    ]),
    window,
    { actor: "seed" },
  );

  // School (SCH-1): a sample Veracross portal with four classes a day, so
  // "Today at school" has periods, rooms and teachers. Enabled because the
  // school day reads only enabled Veracross sources; nothing syncs it
  // locally unless `sync all` is run (it would fail: no login).
  const school = await source("School calendar (sample)", "veracross", "school_class");
  await db.update(sources).set({ kind: "veracross", enabled: true }).where(eq(sources.id, school));
  const pdDay = addDays(monday, 7 + 4); // next Friday
  const periods: [string, string, string, string, string][] = [
    ["Math", "08:30", "09:40", "Room 12", "Ms Rivera"],
    ["English", "09:45", "10:55", "Room 4", "Mr Okafor"],
    ["Science", "11:40", "12:50", "Lab 2", "Dr Chen"],
    ["French", "13:55", "15:10", "Room 9", "Mme Laurent"],
  ];
  await syncRecords(
    db,
    { sourceId: school },
    [
      ...records("school_class", (w, mon) =>
        [0, 1, 2, 3, 4]
          .map((d) => addDays(mon, d))
          .filter((d) => d !== pdDay)
          .flatMap((d) =>
            periods.map(([title, start, end, room, teacher], i) => ({
              externalId: `school-${d}-${i}`,
              title,
              startUtc: at(d, start),
              endUtc: at(d, end),
              allDay: false,
              locationName: `Elm Street School, ${room}`,
              notes: `With ${teacher}`,
              sourceUrl: `https://example.test/portal/classes/${i + 1}`,
            })),
          ),
      ),
      {
        externalId: `pd-${pdDay}`,
        category: "school_closure",
        attendance: "required",
        title: "PD day: no school",
        notes: null,
        sourceUrl: null,
        locationName: null,
        allDay: true,
        startUtc: new Date(`${pdDay}T00:00:00Z`),
        endUtc: new Date(`${addDays(pdDay, 1)}T00:00:00Z`),
      },
    ],
    window,
    { actor: "seed" },
  );

  // Manual repeating events (CAL-5), including clashes to resolve.
  const series = async (title: string, input: Omit<Parameters<typeof createSeries>[2], "title">) => {
    const [existing] = await db.select().from(eventSeries).where(eq(eventSeries.title, title));
    if (!existing) await createSeries(db, "seed", { title, ...input });
  };
  const common = {
    attendance: "required" as const,
    notes: null,
    allDay: false,
    untilDate: addDays(monday, WEEKS * 7),
    intervalWeeks: 1,
    timeZone: tz,
  };
  await series("Tennis lesson", {
    ...common,
    category: "tennis",
    locationName: "Maple Tennis Club",
    startDate: addDays(monday, -7),
    startTime: "16:30",
    durationMin: 60,
    weekdays: [3],
  });
  // Starts 20 minutes before tennis ends: a clash (over the 15-minute tolerance).
  await series("Fitness class", {
    ...common,
    category: "fitness",
    locationName: "Cedar Rec Centre",
    startDate: addDays(monday, -7),
    startTime: "17:10",
    durationMin: 45,
    weekdays: [3],
  });
  await series("Swim squad", {
    ...common,
    category: "swimming",
    locationName: "Birch Aquatic Centre",
    startDate: addDays(monday, -7),
    startTime: "06:00",
    durationMin: 90,
    weekdays: [1, 5],
  });
  await series("Math tutoring", {
    ...common,
    category: "math",
    locationName: "Library room B",
    startDate: addDays(monday, -7),
    startTime: "17:00",
    durationMin: 60,
    weekdays: [1],
  });
  // Overlaps the Saturday soccer game.
  await series("Chinese school", {
    ...common,
    category: "chinese",
    locationName: "Willow Community Hall",
    startDate: addDays(monday, -7),
    startTime: "10:00",
    durationMin: 120,
    weekdays: [6],
  });
  await series("Grandparents' dinner", {
    ...common,
    ownerIds: [parent],
    category: "other",
    locationName: null,
    startDate: addDays(monday, -7),
    startTime: "18:00",
    durationMin: 120,
    weekdays: [0],
    intervalWeeks: 2,
  });
  // His brother's lesson overlaps his math tutoring: not a clash, since
  // they're different people's.
  await series("Piano lesson", {
    ...common,
    ownerIds: [brother],
    category: "other",
    locationName: "Aspen Music Studio",
    startDate: addDays(monday, -7),
    startTime: "17:00",
    durationMin: 45,
    weekdays: [1],
  });

  // Swimming (SWM): a year of made-up meets with steadily faster times, one
  // long course meet (kept apart from short course), and an upcoming meet.
  const swim = await source("Swim club (sample)", "commit_swim", "swimming");
  const meets: SwimMeetRecord[] = [];
  const results: SwimResultRecord[] = [];
  const base: [number, Stroke, number][] = [
    [50, "free", 46000],
    [50, "back", 54000],
    [50, "breast", 60000],
    [100, "im", 118000],
    [200, "im", 255000],
  ];
  const meetNames = [
    "Autumn Splash",
    "Winter Invitational",
    "Spring Sprint",
    "Development Meet",
    "Summer Open",
  ];
  for (let i = 0; i < 7; i++) {
    const date = addDays(today, -400 + i * 60);
    const course = i === 5 ? "LCM" : "SCM";
    const externalId = `seed-meet-${i}`;
    meets.push({
      externalId,
      name: `${meetNames[i % meetNames.length]} (sample)`,
      course,
      startDate: date,
      endDate: date,
      venue: "Birch Aquatic Centre",
      city: "Springfield",
      signup: "yes",
      sourceUrl: null,
      entries: null,
    });
    base.forEach(([distance, stroke, ms], j) => {
      if ((i + j) % 4 === 3) return;
      // About 1.5% faster each meet, with some off days; long course is slower.
      const wobble = [0, 0.012, -0.004, 0.018, -0.002, 0.006, 0][(i + j) % 7];
      const time = ms * Math.pow(0.985, i) * (1 + wobble) * (course === "LCM" ? 1.04 : 1);
      results.push({
        externalId: `seed-${i}-${distance}-${stroke}`,
        meetExternalId: externalId,
        swimDate: date,
        distance,
        stroke,
        course,
        timeMs: Math.round(time / 10) * 10,
        place: 1 + ((i * 7 + j * 3) % 12),
        heat: 1 + (j % 4),
        lane: 1 + ((i + j) % 8),
        stage: "Final",
        dqReason: null,
        splits: [],
      });
    });
  }
  const next = addDays(today, 21);
  meets.push({
    externalId: "seed-meet-next",
    name: "Fall Classic (sample)",
    course: "SCM",
    startDate: next,
    endDate: addDays(next, 1),
    venue: "Birch Aquatic Centre",
    city: "Springfield",
    signup: "yes",
    sourceUrl: null,
    entries: [
      { distance: 200, stroke: "im", course: "SCM", seedTimeMs: 232000, meetDay: 1, sessionStart: "08:30" },
      { distance: 50, stroke: "free", course: "SCM", seedTimeMs: 42100, meetDay: 2, sessionStart: "16:00" },
    ],
  });
  await syncSwim(db, swim, { meets, results, window }, { actor: "seed" });

  // Tennis (TEN): a season of made-up tournaments and matches, one coming
  // up with his draw and next opponent, and one found for him to enter.
  const tennis = await source("Tennis site (sample)", "tennis_tc", "tennis");
  const self = "91000";
  const rivals: [string, string][] = [
    ["92001", "Riley Stone"],
    ["92002", "Morgan Vale"],
    ["92003", "Casey Brook"],
    ["92004", "Jordan Pike"],
    ["92005", "Quinn Marsh"],
    ["92006", "Avery Holt"],
  ];
  const tournaments: TennisTournamentRecord[] = [];
  const matches: TennisMatchRecord[] = [];
  const tournament = (externalId: string, name: string, start: string): TennisTournamentRecord => ({
    externalId,
    name,
    startDate: start,
    endDate: addDays(start, 2),
    venue: "Maple Tennis Club",
    city: "Springfield",
    region: null,
    entryDeadline: null,
    categories: ["U12 Boys Singles"],
    entered: true,
    sourceUrl: null,
  });
  const tNames = ["Maple Open", "Harvest Cup", "Frost Classic", "Thaw Invitational", "Blossom Open"];
  const rounds = ["Round of 16", "Quarter final", "Semi final", "Final"];
  for (let i = 0; i < 5; i++) {
    const start = addDays(today, -330 + i * 70);
    const externalId = `seed-t-${i}`;
    tournaments.push(tournament(externalId, `${tNames[i]} (sample)`, start));
    // Goes deeper as the season goes on, and wins the last one.
    const deepest = Math.min(3, 1 + Math.floor(i / 2));
    for (let r = 0; r <= deepest; r++) {
      const won = r < deepest || i === 4;
      matches.push({
        externalId: `seed-m-${i}-${r}`,
        tournamentExternalId: externalId,
        drawNo: "1",
        eventName: "U12 Boys Singles",
        round: rounds[r],
        matchDate: addDays(start, Math.min(r, 2)),
        scheduledAt: null,
        side1: [self],
        side2: [rivals[(i * 2 + r) % rivals.length][0]],
        winner: won ? 1 : 2,
        sets: won
          ? [
              [6, (i + r) % 5],
              [6, 1 + (r % 4)],
            ]
          : [
              [4 - (r % 3), 6],
              [6, 4],
              [3, 6],
            ],
        outcome: "played",
      });
    }
  }
  const upcoming = addDays(today, 12);
  tournaments.push(tournament("seed-t-next", "Autumn Championship (sample)", upcoming));
  const [nextId, nextName] = rivals[1];
  await syncTennis(
    db,
    tennis,
    {
      selfMemberId: self,
      players: [
        {
          memberId: self,
          name: "Sam Sample",
          club: "Maple Tennis Club",
          profileId: null,
          isSelf: true,
          profileFetched: true,
        },
        ...rivals.map(([memberId, name], i) => ({
          memberId,
          name,
          club: ["Cedar Racquet Club", "Birch Tennis Centre"][i % 2],
          profileId: null,
          isSelf: false,
          profileFetched: true,
        })),
      ],
      tournaments,
      draws: [
        {
          tournamentExternalId: "seed-t-next",
          drawNo: "1",
          eventName: "U12 Boys Singles",
          drawName: "Main draw",
          kind: "bracket",
          size: 16,
          position: 5,
          seed: "3",
          nextMatch: {
            status: "next",
            round: "Round of 16",
            opponent: { name: nextName, memberId: nextId, tournamentPlayerId: null },
            feeders: null,
            date: upcoming,
            time: "10:30",
          },
          sourceUrl: null,
        },
      ],
      matches,
      window,
    },
    { actor: "seed" },
  );
  const found = addDays(today, 40);
  await db
    .insert(tennisEntries)
    .values({
      sourceId: tennis,
      tournamentExternalId: "seed-t-found",
      tournamentName: "Winter Warm-up (sample)",
      startDate: found,
      endDate: addDays(found, 1),
      venue: "Birch Tennis Centre",
      city: "Springfield",
      entryDeadline: addDays(today, 20),
      eventNo: "1",
      eventName: "U12 Boys Singles",
      driveMinutes: 25,
      status: "found",
      tournamentUrl: "https://example.test/tournament/seed-t-found",
      entryUrl: "https://example.test/tournament/seed-t-found/enter",
    })
    .onConflictDoNothing();

  // Email suggestions (EML): a new practice and a moved game from a made-up
  // coach, back to pending on every run so the app's tests can use them.
  const gmail = await source("Coach email (sample)", "gmail", "soccer");
  // Approving a suggestion adds an event from this source, which the app
  // can't delete (source events are only skipped): clear those so a fresh
  // seed starts over.
  await db.transaction(async (tx) => {
    const fromMail = (await tx.select({ id: events.id }).from(events).where(eq(events.sourceId, gmail))).map(
      (e) => e.id,
    );
    if (!fromMail.length) return;
    await tx
      .delete(conflicts)
      .where(or(inArray(conflicts.eventA, fromMail), inArray(conflicts.eventB, fromMail)));
    await tx.delete(eventOverrides).where(inArray(eventOverrides.eventId, fromMail));
    await tx.delete(eventRevisions).where(inArray(eventRevisions.eventId, fromMail));
    await tx.delete(events).where(inArray(events.id, fromMail));
  });
  const [game] = await db
    .select({ id: events.id, start: events.startUtc })
    .from(events)
    .where(and(eq(events.sourceId, soccer), eq(events.externalId, "game-1")));
  const wednesday = addDays(monday, 7 + 2);
  const suggestions = [
    {
      key: "seed-mail-1",
      subject: "Extra practice next week",
      kind: "new",
      target: null,
      extracted: {
        title: "Extra soccer practice",
        date: wednesday,
        startTime: "18:00",
        endTime: "19:30",
        location: "Oak Park Field 2",
        category: "soccer",
        notes: null,
      },
      confidence: { title: "high", date: "high", time: "medium", location: "low", overall: "medium" },
      quote: "We'll add an extra practice next Wednesday, 6 to 7:30, probably at Oak Park.",
    },
    {
      key: "seed-mail-2",
      subject: "Saturday's game moved",
      kind: "change",
      target: game?.id ?? null,
      extracted: {
        title: "Game vs Green Giants",
        date: game ? localDate(game.start, tz) : addDays(monday, 12),
        startTime: "11:00",
        endTime: "12:30",
        location: "Oak Park Field 2",
        category: "soccer",
        notes: null,
      },
      confidence: { title: "high", date: "high", time: "high", location: "medium", overall: "high" },
      quote: "Heads up: Saturday's game is now at 11am, same field.",
    },
  ];
  for (const sg of suggestions) {
    const [message] = await db
      .insert(emailMessages)
      .values({
        sourceId: gmail,
        gmailMessageId: sg.key,
        receivedAt: new Date(),
        fromAddress: "coach@example.test",
        subject: sg.subject,
        suggestions: 1,
      })
      .onConflictDoUpdate({
        target: [emailMessages.sourceId, emailMessages.gmailMessageId],
        set: { subject: sg.subject },
      })
      .returning({ id: emailMessages.id });
    const values = {
      kind: sg.kind,
      targetEventId: sg.target,
      extracted: sg.extracted,
      confidence: sg.confidence,
      quote: sg.quote,
      status: "pending",
      eventId: null,
      decidedAt: null,
    };
    const [existing] = await db
      .select({ id: emailSuggestions.id })
      .from(emailSuggestions)
      .where(eq(emailSuggestions.messageId, message.id));
    if (existing) await db.update(emailSuggestions).set(values).where(eq(emailSuggestions.id, existing.id));
    else
      await db.insert(emailSuggestions).values({
        sourceId: gmail,
        messageId: message.id,
        gmailMessageId: sg.key,
        messageUrl: `https://mail.google.com/mail/u/0/#inbox/${sg.key}`,
        ...values,
      });
  }

  ctx.log("seeded", { weeks: WEEKS, from: monday });
}
