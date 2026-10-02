import { forgetMemory, memoryPatch, updateMemory } from "@/server/assistant/memory";
import { api, readJson } from "@/server/http";

// MEM-4: edit a fact.
export const PATCH = api<{ id: string }>(async ({ db, request, session, params }) =>
  Response.json(await updateMemory(db, session.userId, params.id, await readJson(request, memoryPatch))),
);

// Forget it; it can be restored for 30 days.
export const DELETE = api<{ id: string }>(async ({ db, params }) =>
  Response.json(await forgetMemory(db, params.id)),
);
