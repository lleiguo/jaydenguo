import { z } from "zod";
import { api, readJson } from "@/server/http";
import { personInput, removePerson, renamePerson } from "@/server/people";

export const PATCH = api<{ id: string }>(async ({ db, params, request }) => {
  const { name } = await readJson(request, personInput);
  await renamePerson(db, z.uuid().parse(params.id), name);
  return Response.json({ ok: true });
});

export const DELETE = api<{ id: string }>(async ({ db, params }) => {
  await removePerson(db, z.uuid().parse(params.id));
  return Response.json({ ok: true });
});
