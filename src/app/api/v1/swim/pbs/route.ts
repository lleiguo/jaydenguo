import { api } from "@/server/http";
import { loadPersonalBests } from "@/server/swim/load";

// SWM-6: the current best for every event and course.
export const GET = api(async ({ db }) => Response.json({ pbs: await loadPersonalBests(db) }));
