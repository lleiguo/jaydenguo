import { api } from "@/server/http";
import { listTournaments } from "@/server/tennis/load";

// TEN-2, TEN-3: tournaments in progress, coming up and past, and his next matches.
export const GET = api(async ({ db }) => {
  const { today, nextMatches, inProgress, upcoming, past } = await listTournaments(db);
  return Response.json({ today, nextMatches, inProgress, upcoming, past });
});
