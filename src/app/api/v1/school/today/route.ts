import { loadSchoolDays } from "@/server/calendar/school-day";
import { api } from "@/server/http";
import { listPeople } from "@/server/people";

// SCH-1 "Today at school": today's periods, or the next school day's once
// today's are over. `schoolDays` has every child with classes this week;
// `schoolDay` is the primary person's (null when he has none).
export const GET = api(async ({ db }) => {
  const schoolDays = await loadSchoolDays(db);
  const primary = (await listPeople(db)).find((p) => p.isPrimary)?.id;
  return Response.json({ schoolDay: schoolDays.find((d) => d.person.id === primary) ?? null, schoolDays });
});
