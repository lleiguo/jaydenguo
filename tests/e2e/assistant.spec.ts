import { expect, test } from "./support/test";
import { apiSend } from "./support/api";
import { APP_URL, OWNER } from "./support/env";
import { signInAs } from "./support/session";

// Cookie's API through the built server (intent 0007, plan K2.5), with the
// stand-in model (ASSISTANT_LLM=fake): it looks at Today for "today",
// greets, and barks at anything else. Every response is checked against
// openapi.json by `apiSend`.

test("Cookie answers, barks, keeps history and settings, and clears the chat", async ({ context }, info) => {
  test.skip(info.project.name !== "desktop", "one shared chat; one project is enough");
  await signInAs(context, OWNER);
  await apiSend(context, "DELETE", "/api/v1/assistant/turns");

  const today = await apiSend(context, "POST", "/api/v1/assistant/ask", { text: "What's on today?" });
  expect(today).toMatchObject({
    outcome: "answer",
    heard: "What's on today?",
    language: "en",
    sources: [{ kind: "hub", label: "Today" }],
  });

  // A follow-up in the same conversation keeps its id.
  const hello = await apiSend(context, "POST", "/api/v1/assistant/ask", {
    conversationId: today.conversationId,
    text: "你好",
  });
  expect(hello).toMatchObject({ outcome: "answer", language: "zh", conversationId: today.conversationId });

  const unknown = await apiSend(context, "POST", "/api/v1/assistant/ask", { text: "What's his shoe size?" });
  expect(unknown).toMatchObject({ outcome: "bark", sources: [] });
  expect(unknown.text).toMatch(/^Woof!/);

  const history = await apiSend(context, "GET", "/api/v1/assistant/turns?limit=10");
  expect(history.turns.map((t: { heard: string }) => t.heard)).toEqual([
    "What's on today?",
    "你好",
    "What's his shoe size?",
  ]);
  expect(history.more).toBe(false);

  const settings = await apiSend(context, "GET", "/api/v1/assistant/settings");
  expect(settings).toMatchObject({ speak: true, web: false });
  expect(settings.monthSpendUsd).toBeGreaterThan(0);
  const changed = await apiSend(context, "PATCH", "/api/v1/assistant/settings", {
    monthlyCapUsd: settings.monthlyCapUsd + 1,
  });
  expect(changed.monthlyCapUsd).toBe(settings.monthlyCapUsd + 1);
  await apiSend(context, "PATCH", "/api/v1/assistant/settings", { monthlyCapUsd: settings.monthlyCapUsd });

  await apiSend(context, "DELETE", "/api/v1/assistant/turns");
  expect((await apiSend(context, "GET", "/api/v1/assistant/turns")).turns).toEqual([]);
  // The costs stay after the words are cleared.
  expect((await apiSend(context, "GET", "/api/v1/assistant/settings")).monthSpendUsd).toBe(
    settings.monthSpendUsd,
  );
});

test("Cookie refuses an empty or over-long question (LIM-3)", async ({ context }) => {
  await signInAs(context, OWNER);
  for (const text of ["   ", "a".repeat(501)]) {
    const res = await context.request.post("/api/v1/assistant/ask", {
      data: { text },
      headers: { origin: APP_URL },
    });
    expect(res.status()).toBe(400);
  }
});
