import { api, readJson } from "@/server/http";
import { createSource, createSourceInput, listSources } from "@/server/sources";

export const GET = api(async ({ db }) => Response.json({ sources: await listSources(db) }));

export const POST = api(async ({ db, request }) => {
  const input = await readJson(request, createSourceInput);
  return Response.json(await createSource(db, input), { status: 201 });
});
