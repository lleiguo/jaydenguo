import { loadSchoolDay } from "@/server/calendar/school-day";
import { api } from "@/server/http";

// SCH-1 "Today at school": today's periods, or the next school day's once
// today's are over; null when none are coming up this week.
export const GET = api(async ({ db }) => Response.json({ schoolDay: await loadSchoolDay(db) }));
