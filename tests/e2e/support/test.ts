import { test as base, expect } from "@playwright/test";
import { checkResponse } from "./contract";

// The e2e `test`: Playwright's, plus a check that every /api/v1 JSON response
// a test's pages receive matches openapi.json (intent 0004, API-4).
export const test = base.extend<{ apiContract: void }>({
  apiContract: [
    async ({ context }, use) => {
      const problems: string[] = [];
      const pending: Promise<void>[] = [];
      context.on("response", (res) => {
        const url = new URL(res.url());
        if (!url.pathname.startsWith("/api/v1/")) return;
        if (!(res.headers()["content-type"] ?? "").includes("application/json")) return;
        pending.push(
          res
            .json()
            .then((body: unknown) => {
              const problem = checkResponse(res.request().method(), url.pathname, res.status(), body);
              if (problem) problems.push(problem);
            })
            // The page navigated away before the body arrived.
            .catch(() => {}),
        );
      });
      await use();
      // A body that never arrives (the page closed first) isn't checked.
      await Promise.race([Promise.all(pending), new Promise((resolve) => setTimeout(resolve, 2_000))]);
      expect(problems, "API responses match openapi.json").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
