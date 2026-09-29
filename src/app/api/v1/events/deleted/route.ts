import { loadDeleted } from "@/server/calendar/load";
import { api } from "@/server/http";

// The "Deleted" view (CAL-6): deleted events, for restoring.
export const GET = api(async ({ db }) => Response.json({ events: await loadDeleted(db) }));
