import { api, readJson } from "@/server/http";
import { addPerson, listPeople, personInput } from "@/server/people";

// People whose events the calendar holds (owner, 2026-09-28).
export const GET = api(async ({ db }) => Response.json({ people: await listPeople(db) }));

export const POST = api(async ({ db, request }) => {
  const { name } = await readJson(request, personInput);
  return Response.json({ id: await addPerson(db, name) }, { status: 201 });
});
