import { api, readJson } from "@/server/http";
import { defaultLauncher } from "@/server/jobs/launcher";
import { createSource, createSourceInput, listSources, startSenderCheck } from "@/server/sources";

export const GET = api(async ({ db }) => Response.json({ sources: await listSources(db) }));

export const POST = api(async ({ db, request }) => {
  const input = await readJson(request, createSourceInput);
  const row = await createSource(db, input);
  // A typo in the allow-list shows straight away (no email from it lately).
  if (input.kind === "gmail") await startSenderCheck(db, row.id, defaultLauncher());
  return Response.json(row, { status: 201 });
});
