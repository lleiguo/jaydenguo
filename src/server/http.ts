import { z } from "zod";
import { currentApiSession } from "./auth/current";
import type { SessionUser } from "./auth/session";
import { getDb } from "./db";
import type { Db } from "./db/client";
import { HttpError } from "./errors";
import { nudgeHouseholdSync } from "./household-sync";
import { defaultLauncher } from "./jobs/launcher";

// Shared shape for /api/v1 route handlers: checks the session (again, after
// the proxy), turns validation errors into 400s and never leaks internals.

export { HttpError };

export type ApiContext<P> = { request: Request; session: SessionUser; db: Db; params: P };

export function api<P = Record<string, never>>(handler: (ctx: ApiContext<P>) => Promise<Response>) {
  return async (request: Request, route?: { params?: Promise<P> }): Promise<Response> => {
    const session = await currentApiSession();
    if (!session) return Response.json({ error: "unauthorised" }, { status: 401 });
    return withErrors(async () => {
      const params = ((await route?.params) ?? {}) as P;
      const db = await getDb();
      const response = await handler({ request, session, db, params });
      if (response.ok && changesCalendar(request)) await nudge(db);
      return response;
    });
  };
}

// Intent 0020, TWO-3: a change on the calendar reaches the household
// Google Calendar. Never fails the change itself.
const CALENDAR_CHANGES = /^\/api\/v1\/(events|series|overrides|suggestions)(\/|$)/;
const changesCalendar = (request: Request) =>
  request.method !== "GET" && CALENDAR_CHANGES.test(new URL(request.url).pathname);

async function nudge(db: Db) {
  try {
    await nudgeHouseholdSync(db, defaultLauncher());
  } catch (err) {
    console.error(
      JSON.stringify({ severity: "WARNING", message: "household sync not started", error: String(err) }),
    );
  }
}

// For the few public API routes (intent 0004: the app's code exchange),
// which authenticate by what's in the body instead of a session.
export function publicApi(handler: (ctx: { request: Request; db: Db }) => Promise<Response>) {
  return async (request: Request): Promise<Response> =>
    withErrors(async () => handler({ request, db: await getDb() }));
}

async function withErrors(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
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
