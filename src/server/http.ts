import { z } from "zod";
import { currentSession } from "./auth/current";
import type { SessionUser } from "./auth/session";
import { getDb } from "./db";
import type { Db } from "./db/client";
import { HttpError } from "./errors";

// Shared shape for /api/v1 route handlers: checks the session (again, after
// the proxy), turns validation errors into 400s and never leaks internals.

export { HttpError };

export type ApiContext<P> = { request: Request; session: SessionUser; db: Db; params: P };

export function api<P = Record<string, never>>(handler: (ctx: ApiContext<P>) => Promise<Response>) {
  return async (request: Request, route?: { params?: Promise<P> }): Promise<Response> => {
    const session = await currentSession();
    if (!session) return Response.json({ error: "unauthorised" }, { status: 401 });
    try {
      const params = ((await route?.params) ?? {}) as P;
      return await handler({ request, session, db: await getDb(), params });
    } catch (err) {
      if (err instanceof HttpError) return Response.json({ error: err.message }, { status: err.status });
      if (err instanceof z.ZodError) {
        // The first problem, in words the page can show as is.
        const first = err.issues[0];
        const message =
          first?.message && !first.message.startsWith("Invalid") ? first.message : "invalid request";
        return Response.json({ error: message, issues: z.flattenError(err) }, { status: 400 });
      }
      console.error(JSON.stringify({ severity: "ERROR", message: "api error", error: String(err) }));
      return Response.json({ error: "internal error" }, { status: 500 });
    }
  };
}

export async function readJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new HttpError(400, "body must be JSON");
  }
  return schema.parse(body);
}
