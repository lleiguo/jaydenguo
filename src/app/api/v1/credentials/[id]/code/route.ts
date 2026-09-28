import { z } from "zod";
import { signInCodeInput, submitSignInCode } from "@/server/credentials/store";
import { api, readJson } from "@/server/http";

// The sign-in code a site emailed, while "Test connection" waits for it.
export const POST = api<{ id: string }>(async ({ db, session, params, request }) => {
  const { code } = await readJson(request, signInCodeInput);
  await submitSignInCode(db, session.email, z.uuid().parse(params.id), code);
  return Response.json({ accepted: true }, { status: 202 });
});
