import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  credentials,
  emailMessages,
  emailSuggestions,
  eventOverrides,
  eventRevisions,
  events,
  sources,
  syncRuns,
} from "@db/schema";
import { aadFor } from "@/server/credentials/aad";
import { seal } from "@/server/crypto/envelope";
import { defaultKeyWrapper } from "@/server/crypto/key-wrapper";
import { createDb, createPool, type PoolHandle } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { approveSuggestion, listSuggestions, rejectSuggestion } from "@/server/email/suggestions";
import { createLogger } from "@/server/log";
import { syncSource } from "@/worker/sync";
import { createGmailFake } from "../e2e/support/fake-gmail";

// Suggestions from email (plan M5.8, EML-1..3): a Gmail source syncs
// against a fake Gmail; the stand-in extractor (EMAIL_LLM=fake) turns each
// allowed email into a suggestion; nothing reaches the calendar until the
// owner approves, and each email is read once.

describe("email suggestions", () => {
  let handle: PoolHandle;
  let db: ReturnType<typeof createDb>;
  let server: Server;
  let base = "";
  const gmail = createGmailFake((t) => t === "gmail-access");
  const log = createLogger((l) => process.env.DEBUG_LOG && console.log(l));
  const now = () => new Date("2028-06-01T12:00:00Z");
  let sourceId: string;
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    await runMigrations();
    handle = await createPool();
    db = createDb(handle.pool);
    server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", base);
      if (url.pathname === "/.well-known/openid-configuration") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(
          JSON.stringify({
            issuer: base,
            authorization_endpoint: `${base}/authorize`,
            token_endpoint: `${base}/token`,
            jwks_uri: `${base}/jwks`,
            response_types_supported: ["code"],
          }),
        );
      }
      if (url.pathname === "/token") {
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(
          JSON.stringify({ access_token: "gmail-access", token_type: "Bearer", expires_in: 300 }),
        );
      }
      if (gmail.handle(req, res, base)) return;
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    for (const k of [
      "OIDC_ISSUER",
      "GOOGLE_API_BASE",
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "EMAIL_LLM",
      "SYNC_MIN_GAP_MINUTES",
    ])
      saved[k] = process.env[k];
    Object.assign(process.env, {
      OIDC_ISSUER: base,
      GOOGLE_API_BASE: base,
      GOOGLE_CLIENT_ID: "test-client",
      GOOGLE_CLIENT_SECRET: "test-secret",
      EMAIL_LLM: "fake",
      SYNC_MIN_GAP_MINUTES: "0",
    });
  });
  afterAll(async () => {
    for (const [k, v] of Object.entries(saved))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    await new Promise((r) => server.close(r));
    await handle.close();
  });

  beforeEach(async () => {
    const id = randomUUID();
    await db.insert(credentials).values({
      id,
      kind: "oauth",
      provider: "google",
      label: `Google (gmail-${id}@example.test)`,
      username: `gmail-${id}@example.test`,
      scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
      ...(await seal(defaultKeyWrapper(), `refresh-${id}`, aadFor(id))),
    });
    const [s] = await db
      .insert(sources)
      .values({
        kind: "gmail",
        name: "Coach emails",
        credentialId: id,
        config: { senders: ["*@club.example"], labels: ["Jayden"] },
        categoryMapping: { default: "other" },
      })
      .returning();
    sourceId = s.id;
  });

  const mine = async () => (await listSuggestions(db)).filter((s) => s.sourceId === sourceId);
  const eventsOf = () =>
    db
      .select()
      .from(events)
      .where(and(eq(events.sourceId, sourceId), isNull(events.deletedAt)));

  it("reads allowed emails once into pending suggestions, and adds nothing to the calendar", async () => {
    const first = await syncSource(db, sourceId, "manual", log, now);
    expect(first).toMatchObject({ status: "succeeded", added: 2 });
    // The newsletter isn't from an allowed sender or label.
    expect((await mine()).map((s) => s.subject).sort()).toEqual(["Extra practice", "Holiday party"]);
    expect(await eventsOf()).toEqual([]);

    // A second sync reads nothing new (each email once).
    const again = await syncSource(db, sourceId, "manual", log, now);
    expect(again).toMatchObject({ status: "succeeded", added: 0 });
    const messages = await db.select().from(emailMessages).where(eq(emailMessages.sourceId, sourceId));
    expect(messages.map((m) => m.gmailMessageId).sort()).toEqual(["msg-labelled", "msg-practice"]);
    // §7.2: the table has no place for the email's text.
    expect(Object.keys(messages[0])).not.toContain("text");
  });

  it("approving a new event adds it with its email source and a link to the message (EML-3)", async () => {
    await syncSource(db, sourceId, "manual", log, now);
    const practice = (await mine()).find((s) => s.subject === "Extra practice")!;
    expect(practice.extracted).toMatchObject({ date: "2028-06-14", startTime: "18:30" });
    const { eventId } = await approveSuggestion(db, "owner@example.test", practice.id, {
      title: "Extra practice",
      date: "2028-06-14",
      startTime: "18:30",
      endTime: "20:00",
      location: "East field",
      category: "soccer",
    });
    const [e] = await db.select().from(events).where(eq(events.id, eventId!));
    expect(e).toMatchObject({
      sourceId,
      title: "Extra practice",
      category: "soccer",
      locationName: "East field",
      sourceUrl: "https://mail.google.com/mail/u/0/#all/msg-practice",
      allDay: false,
    });
    // 18:30 in Toronto in June is 22:30 UTC.
    expect(e.startUtc.toISOString()).toBe("2028-06-14T22:30:00.000Z");
    expect(e.endUtc.toISOString()).toBe("2028-06-15T00:00:00.000Z");
    const revisions = await db.select().from(eventRevisions).where(eq(eventRevisions.eventId, e.id));
    expect(revisions).toHaveLength(1);
    // Decided once.
    await expect(approveSuggestion(db, "owner", practice.id, null)).rejects.toMatchObject({ status: 409 });

    // The next sync leaves the approved event alone.
    await syncSource(db, sourceId, "manual", log, now);
    const [still] = await db.select().from(events).where(eq(events.id, e.id));
    expect(still.status).toBe("active");
  });

  it("a date without a time becomes an all-day event", async () => {
    await syncSource(db, sourceId, "manual", log, now);
    const party = (await mine()).find((s) => s.subject === "Holiday party" && s.status === "pending")!;
    const { eventId } = await approveSuggestion(db, "owner", party.id, null);
    const [e] = await db.select().from(events).where(eq(events.id, eventId!));
    expect(e).toMatchObject({ allDay: true, title: "Holiday party" });
    expect(e.startUtc.toISOString()).toBe("2028-06-15T00:00:00.000Z");
  });

  it("a cancellation is approved as a skip of the event it's about", async () => {
    const [target] = await db
      .insert(events)
      .values({
        title: "Soccer practice",
        category: "soccer",
        startUtc: new Date("2028-06-12T22:00:00Z"),
        endUtc: new Date("2028-06-12T23:00:00Z"),
      })
      .returning();
    const [message] = await db
      .insert(emailMessages)
      .values({
        sourceId,
        gmailMessageId: `msg-cancel-${randomUUID()}`,
        receivedAt: now(),
        fromAddress: "coach@club.example",
        subject: "Cancelled",
      })
      .returning();
    const [s] = await db
      .insert(emailSuggestions)
      .values({
        sourceId,
        messageId: message.id,
        gmailMessageId: message.gmailMessageId,
        messageUrl: "https://mail.google.com/mail/u/0/#all/x",
        kind: "cancel",
        targetEventId: target.id,
        extracted: {
          title: "Soccer practice",
          date: "2028-06-12",
          startTime: null,
          endTime: null,
          location: null,
          category: "soccer",
          notes: null,
        },
        confidence: { overall: "high", title: "high", date: "high", time: "low", location: "low" },
        quote: "Practice on Monday is cancelled.",
      })
      .returning();
    await approveSuggestion(db, "owner", s.id, null);
    const [override] = await db
      .select()
      .from(eventOverrides)
      .where(and(eq(eventOverrides.eventId, target.id), isNull(eventOverrides.clearedAt)));
    expect(override.skip).toBe(true);
  });

  it("a rejected suggestion leaves the calendar alone", async () => {
    await syncSource(db, sourceId, "manual", log, now);
    const [first] = await mine();
    const before = (await db.select().from(events)).length;
    await rejectSuggestion(db, first.id);
    expect((await db.select().from(events)).length).toBe(before);
    await expect(rejectSuggestion(db, first.id)).rejects.toMatchObject({ status: 409 });
  });

  it("fails the run in plain words when Claude isn't set up, and reads the emails later", async () => {
    delete process.env.EMAIL_LLM;
    const vertex = process.env.VERTEX_PROJECT;
    delete process.env.VERTEX_PROJECT;
    try {
      const run = await syncSource(db, sourceId, "manual", log, now);
      expect(run).toMatchObject({ status: "failed" });
      const [last] = await db
        .select()
        .from(syncRuns)
        .where(eq(syncRuns.sourceId, sourceId))
        .orderBy(syncRuns.startedAt);
      expect(last.errorMessage).toMatch(/Claude on Vertex AI isn't set up/);
      expect(await db.select().from(emailMessages).where(eq(emailMessages.sourceId, sourceId))).toEqual([]);
    } finally {
      process.env.EMAIL_LLM = "fake";
      if (vertex) process.env.VERTEX_PROJECT = vertex;
    }
    expect(await syncSource(db, sourceId, "manual", log, now)).toMatchObject({
      status: "succeeded",
      added: 2,
    });
  });
});
