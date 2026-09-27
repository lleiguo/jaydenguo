import { eq } from "drizzle-orm";
import { eventSeries, locationBuffers, locations, sources } from "@db/schema";
import type { Category } from "../domain/constants";
import { addDays, localDate, weekday, zonedToUtc } from "../domain/time";
import type { SourceRecord } from "../domain/upsert";
import { createSeries } from "../server/calendar/mutations";
import { getHomeTimeZone } from "../server/settings";
import { syncSwim } from "../server/swim/apply";
import { syncRecords } from "../server/sync/apply";
import type { Stroke } from "../domain/swim-constants";
import type { SwimMeetRecord, SwimResultRecord } from "../domain/swim-upsert";
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

  const source = async (name: string, kind: string, category: Category) => {
    const [existing] = await db.select().from(sources).where(eq(sources.name, name));
    if (existing) return existing.id;
    const [row] = await db
      .insert(sources)
      .values({ name, kind, enabled: false, categoryMapping: { default: category } })
      .returning({ id: sources.id });
    return row.id;
  };

  type Draft = Pick<SourceRecord, "externalId" | "title" | "startUtc" | "endUtc" | "allDay" | "locationName">;
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

  const school = await source("School calendar (sample)", "ical", "school_class");
  const pdDay = addDays(monday, 7 + 4); // next Friday
  await syncRecords(
    db,
    { sourceId: school },
    [
      ...records("school_class", (w, mon) =>
        [0, 1, 2, 3, 4]
          .map((d) => addDays(mon, d))
          .filter((d) => d !== pdDay)
          .map((d) => ({
            externalId: `school-${d}`,
            title: "School",
            startUtc: at(d, "08:30"),
            endUtc: at(d, "15:10"),
            allDay: false,
            locationName: "Elm Street School",
          })),
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
  // 10 minutes after tennis at a place 30 minutes away: a travel clash.
  await series("Fitness class", {
    ...common,
    category: "fitness",
    locationName: "Cedar Rec Centre",
    startDate: addDays(monday, -7),
    startTime: "17:40",
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
  await series("Grandparents' dinner (parent)", {
    ...common,
    attendance: "parent_only",
    category: "other",
    locationName: null,
    startDate: addDays(monday, -7),
    startTime: "18:00",
    durationMin: 120,
    weekdays: [0],
    intervalWeeks: 2,
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
      { distance: 200, stroke: "im", course: "SCM", seedTimeMs: 232000 },
      { distance: 50, stroke: "free", course: "SCM", seedTimeMs: 42100 },
    ],
  });
  await syncSwim(db, swim, { meets, results, window }, { actor: "seed" });

  ctx.log("seeded", { weeks: WEEKS, from: monday });
}
