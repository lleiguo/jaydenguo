import { api, readJson } from "@/server/http";
import { createCredential, createCredentialInput, listCredentials } from "@/server/credentials/store";

// Connected accounts (CRED-1..7). Responses never include secret values.
export const GET = api(async ({ db }) => Response.json({ credentials: await listCredentials(db) }));

export const POST = api(async ({ db, session, request }) => {
  const input = await readJson(request, createCredentialInput);
  return Response.json(await createCredential(db, session.email, input), { status: 201 });
});
