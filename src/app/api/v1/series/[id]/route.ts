import { z } from "zod";
import { deleteSeries, getSeries, seriesInput, updateSeries } from "@/server/calendar/mutations";
import { api, readJson } from "@/server/http";

type P = { id: string };
const id = (p: P) => z.uuid().parse(p.id);

export const GET = api<P>(async ({ db, params }) => Response.json(await getSeries(db, id(params))));

export const PATCH = api<P>(async ({ db, session, params, request }) => {
  await updateSeries(db, session.email, id(params), await readJson(request, seriesInput));
  return new Response(null, { status: 204 });
});

export const DELETE = api<P>(async ({ db, session, params }) => {
  await deleteSeries(db, session.email, id(params));
  return new Response(null, { status: 204 });
});
