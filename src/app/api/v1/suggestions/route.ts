import { api } from "@/server/http";
import { listSuggestions, pendingCount } from "@/server/email/suggestions";

// EML-2: suggestions from email waiting for the owner (?status=decided for
// the latest decided ones).
export const GET = api(async ({ db, request }) => {
  const status = new URL(request.url).searchParams.get("status") === "decided" ? "decided" : "pending";
  return Response.json({ suggestions: await listSuggestions(db, status), pending: await pendingCount(db) });
});
