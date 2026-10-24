import { z } from "zod";
import { api, readJson } from "@/server/http";
import { emailsInput, setEmails } from "@/server/people";

// A person's Google emails (intent 0024, OWN-6).
export const POST = api<{ id: string }>(async ({ db, params, request }) => {
  const { emails } = await readJson(request, emailsInput);
  await setEmails(db, z.uuid().parse(params.id), emails);
  return Response.json({ ok: true });
});
