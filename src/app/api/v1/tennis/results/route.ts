import { api } from "@/server/http";
import { loadResults } from "@/server/tennis/load";

// TEN-7: his matches with a running W–L; `?season=2024` filters by year.
export const GET = api(async ({ db, request }) => {
  const raw = new URL(request.url).searchParams.get("season");
  const season = raw && /^\d{4}$/.test(raw) ? Number(raw) : null;
  const { seasons, rows, total, singles } = await loadResults(db, season);
  return Response.json({ seasons, season, rows, total, singles });
});
