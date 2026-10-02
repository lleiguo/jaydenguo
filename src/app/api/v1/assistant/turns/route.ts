import { clearHistory, listTurns, turnsQuery } from "@/server/assistant/turns";
import { quietApi } from "@/server/assistant/quiet";

// MEM-9: this account's chat with Cookie, newest last.
export const GET = quietApi(async ({ db, request, session }) => {
  const q = turnsQuery.parse(Object.fromEntries(new URL(request.url).searchParams));
  return Response.json(
    await listTurns(db, session.userId, {
      before: q.before ? new Date(q.before) : undefined,
      limit: q.limit,
    }),
  );
});

// "Clear history": removes the words of every turn.
export const DELETE = quietApi(async ({ db }) => {
  await clearHistory(db);
  return new Response(null, { status: 204 });
});
