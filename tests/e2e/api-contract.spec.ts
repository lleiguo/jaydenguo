import { expect, test } from "./support/test";
import { checkResponse } from "./support/contract";
import { OWNER } from "./support/env";
import { signInAs } from "./support/session";

// intent 0004, API-4: every GET route without path parameters answers with a
// body that matches openapi.json (routes with parameters are checked by the
// specs that use them, through the suite-wide contract check).

const now = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();

const routes = [
  "/api/v1/me",
  "/api/v1/sessions",
  "/api/v1/settings",
  "/api/v1/people",
  "/api/v1/today",
  "/api/v1/school/today",
  `/api/v1/events?from=${iso(now - 7 * 86_400_000)}&to=${iso(now + 30 * 86_400_000)}`,
  "/api/v1/events/deleted",
  "/api/v1/changes?since=0",
  "/api/v1/clashes",
  "/api/v1/calendar-copy",
  "/api/v1/sources",
  "/api/v1/credentials",
  "/api/v1/costs",
  "/api/v1/suggestions",
  "/api/v1/suggestions?status=decided",
  "/api/v1/swim/meets",
  "/api/v1/swim/pbs",
  "/api/v1/swim/results",
  "/api/v1/tennis/tournaments",
  "/api/v1/tennis/results",
  "/api/v1/tennis/accuracy",
  "/api/v1/videos",
  "/api/v1/videos?deleted=1",
  "/api/v1/videos/settings",
];

test("every GET route matches openapi.json", async ({ context }, info) => {
  test.skip(info.project.name !== "desktop", "the API is the same on every device");
  await signInAs(context, OWNER);
  const problems: string[] = [];
  for (const route of routes) {
    const res = await context.request.get(route);
    expect(res.status(), route).toBe(200);
    const problem = checkResponse("GET", new URL(route, "http://x").pathname, res.status(), await res.json());
    if (problem) problems.push(problem);
  }
  expect(problems).toEqual([]);
});
