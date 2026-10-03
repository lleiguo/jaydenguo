import { readFileSync } from "node:fs";
import { expect, test } from "./support/test";
import { apiSend } from "./support/api";
import { APP_URL, OWNER } from "./support/env";
import { signInAs } from "./support/session";

// Cookie's API through the built server (intent 0007, plan K2.5), with the
// stand-in model (ASSISTANT_LLM=fake): it looks at Today for "today",
// greets, and barks at anything else. Every response is checked against
// openapi.json by `apiSend`.

// One chat and one memory for the account: the tests take turns.
test.describe.configure({ mode: "serial" });

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

test("Cookie remembers, recalls, forgets and restores a fact (MEM-1..5)", async ({ context }, info) => {
  test.skip(info.project.name !== "desktop", "one shared memory; one project is enough");
  await signInAs(context, OWNER);
  for (const m of (await apiSend(context, "GET", "/api/v1/assistant/memories")).memories)
    await apiSend(context, "DELETE", `/api/v1/assistant/memories/${m.id}`);

  const told = await apiSend(context, "POST", "/api/v1/assistant/ask", {
    text: "Remember that the spare key is under the blue pot.",
  });
  expect(told).toMatchObject({
    outcome: "answer",
    sources: [{ kind: "memory", label: "Memory" }],
    saved: { text: "the spare key is under the blue pot", via: "chat", savedBy: OWNER },
    forgot: null,
  });
  const asked = await apiSend(context, "POST", "/api/v1/assistant/ask", { text: "Where is the spare key?" });
  expect(asked).toMatchObject({ outcome: "answer", saved: null });
  expect(asked.text).toContain("under the blue pot");

  // A password is refused, by chat and by hand (MEM-6).
  const secret = await apiSend(context, "POST", "/api/v1/assistant/ask", {
    text: "Remember that the wifi password is tulip-7781.",
  });
  expect(secret.saved).toBeNull();
  const refused = await context.request.post("/api/v1/assistant/memories", {
    data: { text: "The alarm passcode is 4410" },
    headers: { origin: APP_URL },
  });
  expect(refused.status()).toBe(400);
  expect((await refused.json()).error).toMatch(/doesn't keep passwords/);

  // By hand: add, edit.
  const added = await apiSend(context, "POST", "/api/v1/assistant/memories", {
    text: "Recycling goes out on Tuesday",
  });
  expect(added).toMatchObject({ via: "settings", forgottenAt: null });
  const edited = await apiSend(context, "PATCH", `/api/v1/assistant/memories/${added.id}`, {
    text: "Recycling goes out on Wednesday",
  });
  expect(edited.text).toBe("Recycling goes out on Wednesday");
  expect((await apiSend(context, "GET", "/api/v1/assistant/memories")).memories).toHaveLength(2);

  // Forget by chat, find it under forgotten, restore it.
  const forgot = await apiSend(context, "POST", "/api/v1/assistant/ask", { text: "Forget the spare key" });
  expect(forgot).toMatchObject({ outcome: "answer", forgot: { id: told.saved.id }, saved: null });
  expect(
    (await apiSend(context, "POST", "/api/v1/assistant/ask", { text: "Where is the spare key?" })).outcome,
  ).toBe("bark");
  const forgotten = await apiSend(context, "GET", "/api/v1/assistant/memories?forgotten=true");
  expect(forgotten.memories.map((m: { id: string }) => m.id)).toContain(told.saved.id);
  const restored = await apiSend(context, "POST", `/api/v1/assistant/memories/${told.saved.id}/restore`);
  expect(restored.forgottenAt).toBeNull();
  expect((await apiSend(context, "GET", "/api/v1/assistant/memories")).memories).toHaveLength(2);
});

test("Cookie uses the web only when it is switched on (TOOL-11, TOOL-12, TOOL-17)", async ({
  context,
}, info) => {
  test.skip(info.project.name !== "desktop", "one shared setting; one project is enough");
  await signInAs(context, OWNER);
  await apiSend(context, "PATCH", "/api/v1/assistant/settings", { web: false, privateTerms: [] });
  const off = await apiSend(context, "POST", "/api/v1/assistant/ask", {
    text: "Search for pool opening hours",
  });
  expect(off.outcome).toBe("bark");

  const on = await apiSend(context, "PATCH", "/api/v1/assistant/settings", {
    web: true,
    privateTerms: ["Maple School"],
  });
  expect(on).toMatchObject({ web: true, privateTerms: ["Maple School"] });
  try {
    const found = await apiSend(context, "POST", "/api/v1/assistant/ask", {
      text: "Search for pool opening hours",
    });
    expect(found).toMatchObject({
      outcome: "answer",
      text: "A made-up web answer about pool opening hours.",
      sources: [
        { kind: "web", label: "example.com", url: "https://example.com/found" },
        { kind: "web", label: "Google: pool opening hours" },
      ],
    });
    // A search naming something on the private list is refused (CSEC-3).
    const named = await apiSend(context, "POST", "/api/v1/assistant/ask", {
      text: "Search for Maple School term dates",
    });
    expect(named.outcome).toBe("bark");
    // A link in the question is read, and named as the source.
    const page = await apiSend(context, "POST", "/api/v1/assistant/ask", {
      text: "What are the hours on https://pool.example/hours",
    });
    expect(page).toMatchObject({
      outcome: "answer",
      sources: [{ kind: "web", label: "A made-up page", url: "https://pool.example/hours" }],
    });
  } finally {
    await apiSend(context, "PATCH", "/api/v1/assistant/settings", { web: false, privateTerms: [] });
  }
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

test("Cookie hears a spoken question and reads her answer aloud (VOX-1..5)", async ({ context }, info) => {
  test.skip(info.project.name !== "desktop", "one shared chat; one project is enough");
  await signInAs(context, OWNER);
  // Synthetic speech. The stand-in transcriber hears "What's on today?" in any clip.
  const data = readFileSync("tests/fixtures/assistant/question.m4a").toString("base64");
  const spoken = await apiSend(context, "POST", "/api/v1/assistant/ask", {
    audio: { data, mimeType: "audio/mp4" },
  });
  expect(spoken).toMatchObject({ outcome: "answer", heard: "What's on today?", language: "en" });
  const history = await apiSend(context, "GET", "/api/v1/assistant/turns?limit=1");
  expect(history.turns[0]).toMatchObject({ id: spoken.turnId, mode: "voice" });

  const speech = await context.request.get(`/api/v1/assistant/turns/${spoken.turnId}/speech`);
  expect(speech.status()).toBe(200);
  expect(speech.headers()["content-type"]).toBe("audio/mpeg");
  expect(speech.headers()["cache-control"]).toContain("no-store");
  expect((await speech.body()).length).toBeGreaterThan(100);

  // Someone else's turn, or none: nothing to read.
  const missing = await context.request.get(
    "/api/v1/assistant/turns/00000000-0000-4000-8000-000000000000/speech",
  );
  expect(missing.status()).toBe(404);
  // Switched off: the app reads it with the phone's voice.
  await apiSend(context, "PATCH", "/api/v1/assistant/settings", { speak: false });
  try {
    const off = await context.request.get(`/api/v1/assistant/turns/${spoken.turnId}/speech`);
    expect(off.status()).toBe(409);
  } finally {
    await apiSend(context, "PATCH", "/api/v1/assistant/settings", { speak: true });
  }
});

test("Cookie refuses a recording she can't use, and a question that is both or neither (LIM-3)", async ({
  context,
}) => {
  await signInAs(context, OWNER);
  const clip = readFileSync("tests/fixtures/assistant/question.m4a").toString("base64");
  for (const data of [
    { audio: { data: clip, mimeType: "video/mp4" } },
    { audio: { data: "AAAA", mimeType: "audio/mp4" } },
    { audio: { data: clip, mimeType: "audio/mp4" }, text: "and typed too" },
    {},
  ]) {
    const res = await context.request.post("/api/v1/assistant/ask", { data, headers: { origin: APP_URL } });
    expect(res.status()).toBe(400);
  }
});

test("an ID that isn't one is simply not found", async ({ context }) => {
  await signInAs(context, OWNER);
  const headers = { origin: APP_URL };
  expect((await context.request.delete("/api/v1/assistant/memories/not-an-id", { headers })).status()).toBe(
    404,
  );
  expect(
    (await context.request.post("/api/v1/assistant/memories/not-an-id/restore", { headers })).status(),
  ).toBe(404);
  expect((await context.request.get("/api/v1/assistant/turns/not-an-id/speech")).status()).toBe(404);
});

test("Cookie adds an event when asked, shows what she did, and takes it back (0008 ADD-1, ACT-1, ACT-3)", async ({
  context,
}, info) => {
  test.skip(info.project.name !== "desktop", "one shared chat; one project is enough");
  await signInAs(context, OWNER);
  const sources = await apiSend(context, "GET", "/api/v1/sources");
  const household = sources.sources.find((s: { name: string }) => s.name === "E2E household");
  const people = await apiSend(context, "GET", "/api/v1/people");
  const name: string = people.people[0].name;
  // Something that isn't one of the hub's Google calendars is refused.
  const bad = await context.request.patch("/api/v1/assistant/settings", {
    data: { addCalendarSourceId: "00000000-0000-4000-8000-000000000000" },
    headers: { origin: APP_URL },
  });
  expect(bad.status()).toBe(400);
  await apiSend(context, "PATCH", "/api/v1/assistant/settings", { addCalendarSourceId: household.id });
  try {
    const added = await apiSend(context, "POST", "/api/v1/assistant/ask", {
      text: `Add dentist for ${name} on 2028-03-28 at 18:00`,
    });
    expect(added).toMatchObject({
      outcome: "answer",
      did: {
        kind: "added",
        events: [{ title: `${name} dentist`, owners: [name], state: "adding", allDay: false }],
      },
    });
    expect(added.text).toMatch(/^Adding: /);
    expect(added.did.undoUntil).toBeTruthy();
    // The chat shows the same card after a restart.
    const history = await apiSend(context, "GET", "/api/v1/assistant/turns?limit=1");
    expect(history.turns[0]).toMatchObject({ id: added.turnId, did: { events: [{ state: "adding" }] } });

    const undone = await apiSend(context, "POST", `/api/v1/assistant/actions/${added.turnId}/undo`);
    expect(undone).toMatchObject({ undoUntil: null, events: [{ id: null, state: "undone" }] });
    const twice = await context.request.post(`/api/v1/assistant/actions/${added.turnId}/undo`, {
      headers: { origin: APP_URL },
    });
    expect(twice.status()).toBe(409);

    // A weekday that doesn't match the date is asked about, and nothing is added.
    const asked = await apiSend(context, "POST", "/api/v1/assistant/ask", {
      text: `Add dentist for ${name} on Monday 2028-03-28 at 18:00`,
    });
    expect(asked.did).toBeNull();
    expect(asked.text).toContain("is a Tuesday, not a Monday");
    // An ordinary question changes nothing.
    const plain = await apiSend(context, "POST", "/api/v1/assistant/ask", { text: "What's on today?" });
    expect(plain.did).toBeNull();
  } finally {
    await apiSend(context, "PATCH", "/api/v1/assistant/settings", { addCalendarSourceId: null });
  }
});
