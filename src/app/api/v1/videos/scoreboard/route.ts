import { api } from "@/server/http";
import { scoreboard } from "@/server/video/store";

// VID-3d: judge wins, parent-vote wins and how often they agree, per sport.
export const GET = api(async ({ db }) => Response.json({ sports: await scoreboard(db) }));
