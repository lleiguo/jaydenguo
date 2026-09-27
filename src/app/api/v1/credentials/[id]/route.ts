import { z } from "zod";
import { defaultLauncher } from "@/server/jobs/launcher";
import { api, readJson } from "@/server/http";
import {
  getCredential,
  removeCredential,
  updateCredential,
  updateCredentialInput,
} from "@/server/credentials/store";

type Params = { id: string };
const id = (p: Params) => z.uuid().parse(p.id);

export const GET = api<Params>(async ({ db, params }) => Response.json(await getCredential(db, id(params))));

export const PATCH = api<Params>(async ({ db, session, params, request }) => {
  const input = await readJson(request, updateCredentialInput);
  return Response.json(await updateCredential(db, session.email, id(params), input));
});

export const DELETE = api<Params>(async ({ db, session, params }) => {
  await removeCredential(db, session.email, id(params), defaultLauncher());
  return new Response(null, { status: 204 });
});
