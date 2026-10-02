import { restoreMemory } from "@/server/assistant/memory";
import { idOf, quietApi } from "@/server/assistant/quiet";

// MEM-4: bring a forgotten fact back.
export const POST = quietApi<{ id: string }>(async ({ db, params }) =>
  Response.json(await restoreMemory(db, idOf(params))),
);
