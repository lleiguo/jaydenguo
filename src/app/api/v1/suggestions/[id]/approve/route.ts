import { z } from "zod";
import { api, HttpError } from "@/server/http";
import { approveInput, approveSuggestion } from "@/server/email/suggestions";

// EML-3: approve, optionally with corrected fields.
export const POST = api<{ id: string }>(async ({ db, session, params, request }) => {
  const text = await request.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new HttpError(400, "body must be JSON");
  }
  const input = body === null ? null : approveInput.parse(body);
  const result = await approveSuggestion(db, session.email, z.uuid().parse(params.id), input);
  return Response.json(result);
});
