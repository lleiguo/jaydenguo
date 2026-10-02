import { forgetMemory, memoryPatch, updateMemory } from "@/server/assistant/memory";
import { idOf, quietApi } from "@/server/assistant/quiet";
import { readJson } from "@/server/http";

// MEM-4: edit a fact.
export const PATCH = quietApi<{ id: string }>(async ({ db, request, session, params }) =>
  Response.json(await updateMemory(db, session.userId, idOf(params), await readJson(request, memoryPatch))),
);

// Forget it; it can be restored for 30 days.
export const DELETE = quietApi<{ id: string }>(async ({ db, params }) =>
  Response.json(await forgetMemory(db, idOf(params))),
);
