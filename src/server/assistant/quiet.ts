import { z } from "zod";
import { api, HttpError, type ApiContext } from "../http";

// CSEC-7: Cookie's logs hold no words. A database error's message quotes
// the failed query's values (a question, an answer, a fact), so Cookie's
// routes and tools log only what kind of error it was.

export function errorKind(err: unknown): string {
  const e = err as { name?: unknown; code?: unknown; cause?: { name?: unknown; code?: unknown } } | null;
  const parts = [e?.name, e?.code, e?.cause?.name, e?.cause?.code].filter(
    (p): p is string => typeof p === "string" && /^[\w.-]{1,40}$/.test(p),
  );
  return [...new Set(parts)].join(" ") || "error";
}

// `api`, but an unexpected error is logged by kind only.
export function quietApi<P = Record<string, never>>(handler: (ctx: ApiContext<P>) => Promise<Response>) {
  return api<P>(async (ctx) => {
    try {
      return await handler(ctx);
    } catch (err) {
      if (err instanceof HttpError || err instanceof z.ZodError) throw err;
      console.error(
        JSON.stringify({ severity: "ERROR", message: "assistant api error", error: errorKind(err) }),
      );
      return Response.json({ error: "internal error" }, { status: 500 });
    }
  });
}

// A path's `{id}`: anything that isn't an ID is simply not found.
export function idOf(params: { id: string }): string {
  if (!z.uuid().safeParse(params.id).success) throw new HttpError(404, "not found");
  return params.id;
}
