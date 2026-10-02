import { restoreMemory } from "@/server/assistant/memory";
import { api } from "@/server/http";

// MEM-4: bring a forgotten fact back.
export const POST = api<{ id: string }>(async ({ db, params }) =>
  Response.json(await restoreMemory(db, params.id)),
);
