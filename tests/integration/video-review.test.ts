import { createServer, type Server } from "node:http";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { credentials, notifications, videoReviewRounds, videoReviews } from "@db/schema";
import { createDb, createPool, type PoolHandle } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import type { JobLauncher } from "@/server/jobs/launcher";
import { createLogger } from "@/server/log";
import { LlmError, type StructuredModel } from "@/server/llm/types";
import { fakeModel } from "@/server/video/fake";
import { localMediaStore, playbackKey, type MediaStore } from "@/server/video/media-store";
import {
  changeVideoSport,
  createVideoReview,
  deletePlayback,
  deleteVideoReview,
  getVideoReview,
  listVideoReviews,
  playbackOf,
  restoreVideoReview,
  retryVideoReview,
} from "@/server/video/store";
import { HttpError } from "@/server/errors";
import { videoReviewJob, type ReviewDeps } from "@/worker/video/review";
import { createGoogleMediaFake } from "../e2e/support/fake-google-media";

// Video reviews end to end in the worker (plan M5.2-M5.5): link saved,
// video fetched from a fake Drive or Photos, media prepared with ffmpeg,
// the review run with a stand-in model, every call stored, temp files gone.
// Each job really runs ffmpeg, which takes ~4 s on CI: more than vitest's
// default 5 s once a test runs two jobs.

describe("video reviews", { timeout: 60_000 }, () => {
  let handle: PoolHandle;
  let db: ReturnType<typeof createDb>;
  let server: Server;
  let base: string;
  const google = createGoogleMediaFake((t) => t === "good-token");
  const log = createLogger((l) => process.env.DEBUG_LOG && console.log(l));
  const started: string[][] = [];
  const launcher: JobLauncher = { start: async (args) => void started.push(args) };
  const deps = (over: Partial<ReviewDeps> = {}): ReviewDeps => ({
    model: () => fakeModel(),
    accessToken: async () => "good-token",
    sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 50))),
    ...over,
  });
  const ctx = () => ({ log, db: async () => db });
  // A model whose `purpose` step fails.
  const failingAt = (purpose: string): StructuredModel => {
    const model = fakeModel();
    return {
      ...model,
      call: async (req) => {
        if (req.purpose === purpose) throw new LlmError("unavailable", "Gemini is busy.");
        return model.call(req);
      },
    };
  };
  const tempDirs = async () => (await readdir(tmpdir())).filter((d) => d.startsWith("video-review-"));

  const input = (url: string | null, over: Record<string, unknown> = {}) => ({
    url,
    sport: "tennis" as const,
    filmedOn: "2026-09-20",
    note: "forehand",
    segmentStart: null,
    segmentEnd: null,
    ...over,
  });

  beforeAll(async () => {
    await runMigrations();
    handle = await createPool();
    db = createDb(handle.pool);
    server = createServer((req, res) => {
      if (!google.handle(req, res, base)) {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.GOOGLE_API_BASE = base;
    process.env.PHOTOS_PICKER_BASE = base;
  });
  afterAll(async () => {
    await new Promise((r) => server.close(r));
    await handle.close();
  });
  beforeEach(async () => {
    await db.delete(videoReviewRounds);
    await db.delete(videoReviews);
    started.length = 0;
  });

  // The web app checks the Google grant; these tests go straight to the table.
  async function saved(values: Partial<typeof videoReviews.$inferInsert>) {
    const [row] = await db
      .insert(videoReviews)
      .values({ sport: "tennis", provider: "drive", filmedOn: "2026-09-20", status: "queued", ...values })
      .returning();
    return row.id;
  }

  it("reviews a Drive video and keeps the model call", async () => {
    const before = await tempDirs();
    const id = await saved({
      url: "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view",
      note: "forehand",
    });
    await videoReviewJob([id], ctx(), deps());
    const r = (await getVideoReview(db, id))!;
    expect(r.status).toBe("done");
    expect(r.errorMessage).toBeNull();
    expect(r.mediaName).toBe("forehand.mp4");
    expect(r.durationSec).toBeCloseTo(6, 0);
    expect(r.rounds.map((x) => `${x.round}:${x.model}`)).toEqual(["review:gemini"]);
    expect(r.combinedReview).toEqual(r.rounds[0].output);
    expect(r.costUsd).toBeCloseTo(0.01, 5);
    // PUSH-1: the review is done.
    const [done] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.target, `videos/${id}`));
    expect(done).toMatchObject({
      kind: "video",
      title: "Video review ready",
      body: "Tennis video from 2026-09-20.",
    });
    // VID-2: nothing kept after the review.
    expect(await tempDirs()).toEqual(before);
  });

  it("fails in plain words when the Drive file can't be opened, and cleans up", async () => {
    const before = await tempDirs();
    const id = await saved({ url: "https://drive.google.com/file/d/missing12345678/view" });
    await videoReviewJob([id], ctx(), deps());
    const r = (await getVideoReview(db, id))!;
    expect(r.status).toBe("failed");
    expect(r.errorMessage).toMatch(/Can't open this link/);
    expect(await tempDirs()).toEqual(before);
  });

  it("fails when a Drive file isn't a video", async () => {
    const id = await saved({ url: "https://drive.google.com/file/d/notvideo12345678/view" });
    await videoReviewJob([id], ctx(), deps());
    expect((await getVideoReview(db, id))!.errorMessage).toBe("That Drive file isn't a video.");
  });

  it("says why when the model fails", async () => {
    const broken = {
      ...fakeModel(),
      call: async () => {
        throw new LlmError("quota", "Gemini is busy or over its quota on Vertex AI.");
      },
    };
    const id = await saved({ url: "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view" });
    await videoReviewJob([id], ctx(), deps({ model: () => broken }));
    const r = (await getVideoReview(db, id))!;
    expect(r.status).toBe("failed");
    expect(r.errorMessage).toBe("Gemini is busy or over its quota on Vertex AI.");
  });

  it("waits for the owner to pick in Google Photos, then reviews", async () => {
    const id = await saved({ provider: "photos", status: "picking", url: null });
    const job = videoReviewJob([id], ctx(), deps());
    // The page shows the picker link; the owner opens it and picks.
    let pickerUri: string | null = null;
    for (let i = 0; i < 100 && !pickerUri; i++) {
      await new Promise((r) => setTimeout(r, 50));
      pickerUri = (await getVideoReview(db, id))!.pickerUri;
    }
    expect(pickerUri).toMatch(/\/photos-picker\/session-.*\/autoclose$/);
    await fetch(pickerUri!);
    await job;
    const r = (await getVideoReview(db, id))!;
    expect(r.status).toBe("done");
    expect(r.mediaName).toBe("serve.mp4");
    expect(r.pickerUri).toBeNull();
    const session = pickerUri!.split("/")[4];
    expect(google.deleted.has(session)).toBe(true);
  });

  it("waits while Google Photos is still processing the picked video", async () => {
    google.processing = 2;
    google.notReady = 1;
    const id = await saved({ provider: "photos", status: "picking", url: null });
    const job = videoReviewJob([id], ctx(), deps());
    let pickerUri: string | null = null;
    for (let i = 0; i < 100 && !pickerUri; i++) {
      await new Promise((r) => setTimeout(r, 50));
      pickerUri = (await getVideoReview(db, id))!.pickerUri;
    }
    await fetch(pickerUri!);
    await job;
    expect((await getVideoReview(db, id))!.status).toBe("done");
    expect(google.processing).toBeLessThanOrEqual(0);
    expect(google.notReady).toBeLessThanOrEqual(0);
  });

  it("says the video is still processing when Google Photos takes too long", async () => {
    process.env.PHOTOS_PROCESSING_TIMEOUT_MS = "-1";
    google.notReady = 5;
    try {
      const id = await saved({ provider: "photos", status: "picking", url: null });
      const job = videoReviewJob([id], ctx(), deps());
      let pickerUri: string | null = null;
      for (let i = 0; i < 100 && !pickerUri; i++) {
        await new Promise((r) => setTimeout(r, 50));
        pickerUri = (await getVideoReview(db, id))!.pickerUri;
      }
      await fetch(pickerUri!);
      await job;
      const r = (await getVideoReview(db, id))!;
      expect(r.status).toBe("failed");
      expect(r.errorMessage).toMatch(/still processing this video/);
    } finally {
      delete process.env.PHOTOS_PROCESSING_TIMEOUT_MS;
      google.notReady = 0;
    }
  });

  // Intent 0014, WVR-6: retrying after the picker session expired.
  it("asks for a new pick when the old picker session has expired", async () => {
    const id = await saved({
      provider: "photos",
      status: "queued",
      url: null,
      pickerSessionId: "expired-1",
      mediaItemId: "item-old",
    });
    const job = videoReviewJob([id], ctx(), deps());
    let pickerUri: string | null = null;
    for (let i = 0; i < 100 && !pickerUri; i++) {
      await new Promise((r) => setTimeout(r, 50));
      pickerUri = (await getVideoReview(db, id))!.pickerUri;
    }
    expect(pickerUri).toMatch(/\/photos-picker\/session-.*\/autoclose$/);
    await fetch(pickerUri!);
    await job;
    expect((await getVideoReview(db, id))!.status).toBe("done");
  });

  it("gives up when nothing is picked in time", async () => {
    process.env.PHOTOS_PICK_TIMEOUT_MS = "300";
    try {
      const id = await saved({ provider: "photos", status: "picking", url: null });
      await videoReviewJob([id], ctx(), deps());
      const r = (await getVideoReview(db, id))!;
      expect(r.status).toBe("failed");
      expect(r.errorMessage).toMatch(/Nothing was picked/);
    } finally {
      delete process.env.PHOTOS_PICK_TIMEOUT_MS;
    }
  });

  it("saves YouTube links without reviewing them (F-3)", async () => {
    const r = await createVideoReview(db, input("https://youtu.be/dQw4w9WgXcQ"), launcher);
    expect(r.status).toBe("saved");
    expect(started).toEqual([]);
  });

  it("needs Drive access before a Drive link is saved", async () => {
    // Other tests may have connected Google; hide those grants in a
    // transaction that is rolled back.
    const rollback = new Error("rollback");
    await expect(
      db.transaction(async (tx) => {
        await tx.update(credentials).set({ status: "removing" }).where(eq(credentials.provider, "google"));
        await expect(
          createVideoReview(
            tx as unknown as typeof db,
            input("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view"),
            launcher,
          ),
        ).rejects.toBeInstanceOf(HttpError);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });

  it("lists newest first per sport", async () => {
    const a = await saved({
      url: "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view",
      filmedOn: "2026-09-01",
    });
    const b = await saved({
      url: "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view",
      filmedOn: "2026-09-10",
    });
    await saved({ sport: "swimming", url: "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view" });
    await videoReviewJob([a], ctx(), deps());
    expect((await listVideoReviews(db, { sport: "tennis" })).map((r) => r.id)).toEqual([b, a]);
  });

  it("tries a failed review again", async () => {
    const id = await saved({ url: "https://drive.google.com/file/d/missing12345678/view" });
    await videoReviewJob([id], ctx(), deps());
    await retryVideoReview(db, id, launcher);
    expect(started).toEqual([["video:review", id]]);
    expect((await getVideoReview(db, id))!.status).toBe("queued");
  });

  // Intent 0005: the sport worked out from the video, and changed later.
  describe("sport", () => {
    const DRIVE = "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view";
    const detecting = { url: DRIVE, sport: "other" as const, sportSource: "detecting" };

    it("works out the sport before the review (SPT-2)", async () => {
      const model = fakeModel({ detect: { sport: "swimming", sure: true, reason: "A pool." } });
      const id = await saved(detecting);
      await videoReviewJob([id], ctx(), deps({ model: () => model }));
      const r = (await getVideoReview(db, id))!;
      expect(r.status).toBe("done");
      expect(r).toMatchObject({ sport: "swimming", sportSource: "detected" });
      expect(r.rounds[0]).toMatchObject({ round: "detect", model: "gemini" });
      expect(r.costUsd).toBeCloseTo(0.02, 5);
      // The review used the swimming checklist.
      const review = model.requests.find((q) => q.purpose === "review")!;
      expect(review.prompt).toContain("Sport: swimming.");
      expect(model.requests[0].media).toMatchObject({ kind: "video", fps: 1 });
    });

    it("carries on as Other when unsure, or when detection fails (SPT-3)", async () => {
      const unsure = fakeModel({ detect: { sport: "tennis", sure: false, reason: "Too dark." } });
      const a = await saved(detecting);
      await videoReviewJob([a], ctx(), deps({ model: () => unsure }));
      expect(await getVideoReview(db, a)).toMatchObject({
        status: "done",
        sport: "other",
        sportSource: "unsure",
      });

      const b = await saved(detecting);
      await videoReviewJob([b], ctx(), deps({ model: () => failingAt("detect") }));
      const r = (await getVideoReview(db, b))!;
      expect(r).toMatchObject({ status: "done", sport: "other", sportSource: "unsure" });
      expect(r.rounds.some((x) => x.round === "detect")).toBe(false);
    });

    it("skips detection when the owner sets the sport first (SPT-5)", async () => {
      const model = fakeModel();
      const id = await saved(detecting);
      await changeVideoSport(db, id, { sport: "hockey", reviewAgain: false }, launcher);
      await videoReviewJob([id], ctx(), deps({ model: () => model }));
      const r = (await getVideoReview(db, id))!;
      expect(r).toMatchObject({ status: "done", sport: "hockey", sportSource: "chosen" });
      expect(model.requests.some((q) => q.purpose === "detect")).toBe(false);
    });

    it("saves an auto link it can't watch as Other, not set (SPT-1)", async () => {
      const r = await createVideoReview(
        db,
        input("https://youtu.be/dQw4w9WgXcQ", { sport: "auto" }),
        launcher,
      );
      expect(await getVideoReview(db, r.id)).toMatchObject({ sport: "other", sportSource: "unsure" });
    });

    it("refuses a change while the review runs, and relabels a finished one (SPT-5)", async () => {
      const running = await saved({ url: DRIVE, status: "analysing" });
      await expect(
        changeVideoSport(db, running, { sport: "soccer", reviewAgain: false }, launcher),
      ).rejects.toMatchObject({ status: 409 });

      const id = await saved({ url: DRIVE });
      await videoReviewJob([id], ctx(), deps());
      const changed = await changeVideoSport(db, id, { sport: "soccer", reviewAgain: false }, launcher);
      expect(changed).toMatchObject({ sport: "soccer", sportSource: "chosen", status: "done" });
      expect((await getVideoReview(db, id))!.rounds).toHaveLength(1);
      expect(started).toEqual([]);
    });

    it("takes a new sport on a failed review, and can try it again", async () => {
      const id = await saved({ url: "https://drive.google.com/file/d/missing12345678/view" });
      await videoReviewJob([id], ctx(), deps());
      const r = await changeVideoSport(db, id, { sport: "swimming", reviewAgain: true }, launcher);
      expect(r).toMatchObject({ sport: "swimming", status: "queued" });
      expect(started).toEqual([["video:review", id]]);
    });

    it("runs a finished review again from the playback copy (SPT-6, SPT-7)", async () => {
      const dir = await mkdtemp(`${tmpdir()}/media-`);
      try {
        const store = localMediaStore(dir);
        const id = await saved({ url: DRIVE });
        await videoReviewJob([id], ctx(), deps({ media: () => store }));
        const r = await changeVideoSport(db, id, { sport: "swimming", reviewAgain: true }, launcher);
        expect(r).toMatchObject({ status: "queued", sport: "swimming" });
        expect(started).toEqual([["video:review", id]]);
        expect((await getVideoReview(db, id))!.rounds).toEqual([]);

        // The Drive file is gone: the copy must be what's reviewed.
        await db
          .update(videoReviews)
          .set({ url: "https://drive.google.com/file/d/missing12345678/view" })
          .where(eq(videoReviews.id, id));
        const model = fakeModel();
        await videoReviewJob([id], ctx(), deps({ media: () => store, model: () => model }));
        const again = (await getVideoReview(db, id))!;
        expect(again).toMatchObject({ status: "done", sport: "swimming", hasPlayback: true });
        expect(again.rounds).toHaveLength(1);
        expect(model.requests[0].prompt).toContain("Sport: swimming.");
        // Both runs count.
        expect(again.costUsd).toBeCloseTo(0.02, 5);
        const all = await db.select().from(videoReviewRounds).where(eq(videoReviewRounds.reviewId, id));
        expect(all).toHaveLength(2);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it("picks again when a Photos review has no copy", async () => {
      const id = await saved({ provider: "photos", url: null, status: "done", mediaItemId: "item-1" });
      const r = await changeVideoSport(db, id, { sport: "tennis", reviewAgain: true }, launcher);
      expect(r).toMatchObject({ status: "picking" });
    });

    it("keeps a failed attempt's rounds when it's tried again", async () => {
      // The sport is worked out, then the review fails.
      const id = await saved(detecting);
      await videoReviewJob([id], ctx(), deps({ model: () => failingAt("review") }));
      expect((await getVideoReview(db, id))!.status).toBe("failed");
      await retryVideoReview(db, id, launcher);
      expect((await getVideoReview(db, id))!.rounds).toEqual([]);
      const all = await db.select().from(videoReviewRounds).where(eq(videoReviewRounds.reviewId, id));
      expect(all.map((x) => x.round)).toEqual(["detect"]);
    });
  });

  // Intent 0003: a playback copy of the reviewed clip.
  describe("playback copy", () => {
    let dir: string;
    let store: MediaStore;
    const DRIVE = "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view";
    beforeAll(async () => {
      dir = await mkdtemp(`${tmpdir()}/media-`);
      store = localMediaStore(dir);
    });
    afterAll(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it("keeps the clip when the review works (PLAY-1), until the owner deletes it (PLAY-7)", async () => {
      const id = await saved({ url: DRIVE });
      await videoReviewJob([id], ctx(), deps({ media: () => store }));
      const r = (await getVideoReview(db, id))!;
      expect(r.status).toBe("done");
      expect(r.hasPlayback).toBe(true);
      const size = await store.size(playbackKey(id));
      expect(size).toBeGreaterThan(1000);
      const [row] = await db.select().from(videoReviews).where(eq(videoReviews.id, id));
      expect(row.playbackBytes).toBe(size);

      // A deleted review keeps its copy for a restore, but doesn't serve it.
      await deleteVideoReview(db, id);
      expect(await playbackOf(db, id)).toBeNull();
      await restoreVideoReview(db, id);
      expect(await playbackOf(db, id)).toBe(playbackKey(id));

      await deletePlayback(db, store, id);
      expect(await store.size(playbackKey(id))).toBeNull();
      const after = (await getVideoReview(db, id))!;
      expect(after.hasPlayback).toBe(false);
      expect(after.combinedReview).not.toBeNull();
      await expect(deletePlayback(db, store, id)).rejects.toMatchObject({ status: 404 });
    });

    it("keeps nothing when the review fails", async () => {
      const id = await saved({ url: DRIVE });
      await videoReviewJob([id], ctx(), deps({ model: () => failingAt("review"), media: () => store }));
      expect((await getVideoReview(db, id))!.status).toBe("failed");
      expect(await store.size(playbackKey(id))).toBeNull();
    });

    it("finishes the review when the copy can't be saved", async () => {
      const failing: MediaStore = {
        ...store,
        put: async () => {
          throw new Error("bucket unavailable");
        },
      };
      const id = await saved({ url: DRIVE });
      await videoReviewJob([id], ctx(), deps({ media: () => failing }));
      const r = (await getVideoReview(db, id))!;
      expect(r.status).toBe("done");
      expect(r.hasPlayback).toBe(false);
    });
  });
});
