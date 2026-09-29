import { api } from "@/server/http";
import { loadToday } from "@/server/today";

// The iPhone app's Today screen and widgets (intent 0004, APP-2, EXT-1).
export const GET = api(async ({ db }) => Response.json(await loadToday(db)));
