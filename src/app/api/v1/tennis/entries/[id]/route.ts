import { z } from "zod";
import { HttpError } from "@/server/errors";
import { api } from "@/server/http";
import type { TennisEntryResponse } from "@/server/openapi/responses";
import { loadEntry } from "@/server/tennis/entry-list";

// Intent 0017, ACC-5: one of his entries and its acceptance list.
export const GET = api<{ id: string }>(async ({ db, params }) => {
  const entry = await loadEntry(db, z.uuid().parse(params.id));
  if (!entry) throw new HttpError(404, "not found");
  return Response.json(entry satisfies TennisEntryResponse);
});
