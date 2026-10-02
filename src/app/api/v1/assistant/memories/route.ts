import { addMemory, listMemories, memoriesQuery, memoryInput } from "@/server/assistant/memory";
import { api, readJson } from "@/server/http";

// Cookie's memory (intent 0007, MEM-4): what she was told to remember.
export const GET = api(async ({ db, request }) => {
  const q = memoriesQuery.parse(Object.fromEntries(new URL(request.url).searchParams));
  return Response.json({ memories: await listMemories(db, { forgotten: q.forgotten === "true" }) });
});

// A fact added by hand in Settings.
export const POST = api(async ({ db, request, session }) => {
  const input = await readJson(request, memoryInput);
  return Response.json(await addMemory(db, session.userId, input, "settings"), { status: 201 });
});
