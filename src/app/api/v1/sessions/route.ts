import { listSessions } from "@/server/auth/session";
import { api } from "@/server/http";

// Signed-in devices, for the settings page (AUTH-4).
export const GET = api(async ({ db, session }) =>
  Response.json({ sessions: await listSessions(db, session) }),
);
