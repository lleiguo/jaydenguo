import { createServer, type Server } from "node:http";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { credentials, settings, videoReviewRounds, videoReviews } from "@db/schema";
import { createDb, createPool, type PoolHandle } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import type { JobLauncher } from "@/server/jobs/launcher";
import { createLogger } from "@/server/log";
import { fakeModels } from "@/server/video/fake";
import { localMediaStore, playbackKey, type MediaStore } from "@/server/video/media-store";
import {
  createVideoReview,
  deletePlayback,
  deleteVideoReview,
  getVideoReview,
  listVideoReviews,
  playbackOf,
  restoreVideoReview,
  retryVideoReview,
  scoreboard,
  setReviewMode,
  voteVideoReview,
} from "@/server/video/store";
import { HttpError } from "@/server/errors";
import { videoReviewJob, type ReviewDeps } from "@/worker/video/review";
import { createGoogleMediaFake } from "../e2e/support/fake-google-media";

// Video reviews end to end in the worker (plan M5.2-M5.5): link saved,
// video fetched from a fake Drive or Photos, media prepared with ffmpeg,
// the debate run with stand-in models, every round stored, temp files gone.

describe("video reviews", () => {
  let handle: PoolHandle;
  let db: ReturnType<typeof createDb>;
  let server: Server;
  let base: string;
  const google = createGoogleMediaFake((t) => t === "good-token");
  const log = createLogger((l) => process.env.DEBUG_LOG && console.log(l));
  const started: string[][] = [];
  const launcher: JobLauncher = { start: async (args) => void started.push(args) };
  const deps = (over: Partial<ReviewDeps> = {}): ReviewDeps => ({
    models: () => fakeModels(),
    accessToken: async () => "good-token",
    sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 50))),
    ...over,
  });
  const ctx = () => ({ log, db: async () => db });
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
    await db.delete(settings).where(eq(settings.key, "video_review_mode"));
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

  it("reviews a Drive video in debate mode and keeps every round", async () => {
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
    expect(r.verdict?.winner).toBeDefined();
    expect(r.rounds.map((x) => x.round).sort()).toEqual(
      [
        "combine",
        "critique",
        "critique",
        "final_score",
        "final_score",
        "rebuttal",
        "rebuttal",
        "review",
        "review",
      ].sort(),
    );
    expect(r.costUsd).toBeCloseTo(0.09, 5);
    // VID-2: nothing kept after the review.
    expect(await tempDirs()).toEqual(before);
  });

  it("runs one model in single-model mode", async () => {
    await setReviewMode(db, "gemini");
    const id = await saved({ url: "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view", mode: "gemini" });
    await videoReviewJob([id], ctx(), deps());
    const r = (await getVideoReview(db, id))!;
    expect(r.status).toBe("done");
    expect(r.verdict).toBeNull();
    expect(r.rounds.map((x) => `${x.round}:${x.model}`)).toEqual(["review:gemini"]);
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

  it("keeps what a failed debate managed and says why", async () => {
    const models = fakeModels();
    const broken = {
      ...models,
      claude: {
        ...models.claude,
        call: async () => {
          const { LlmError } = await import("@/server/llm/types");
          throw new LlmError("quota", "Claude is over its quota on Vertex AI.");
        },
      },
    };
    const id = await saved({ url: "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view" });
    await videoReviewJob([id], ctx(), deps({ models: () => broken }));
    const r = (await getVideoReview(db, id))!;
    expect(r.status).toBe("failed");
    expect(r.errorMessage).toBe("Claude is over its quota on Vertex AI.");
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

  it("lists newest first per sport, and a vote is written once", async () => {
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

    await voteVideoReview(db, a, "claude");
    await expect(voteVideoReview(db, a, "gemini")).rejects.toMatchObject({ status: 409 });
    expect((await getVideoReview(db, a))!.parentVote).toBe("claude");
    // Not finished: no vote.
    await expect(voteVideoReview(db, b, "gemini")).rejects.toMatchObject({ status: 409 });

    const board = await scoreboard(db);
    expect(board).toHaveLength(1);
    expect(board[0]).toMatchObject({
      sport: "tennis",
      debates: 1,
      voted: 1,
      parentWins: { gemini: 0, claude: 1 },
    });
  });

  it("tries a failed review again", async () => {
    const id = await saved({ url: "https://drive.google.com/file/d/missing12345678/view" });
    await videoReviewJob([id], ctx(), deps());
    await retryVideoReview(db, id, launcher);
    expect(started).toEqual([["video:review", id]]);
    expect((await getVideoReview(db, id))!.status).toBe("queued");
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
      const models = fakeModels();
      const broken = {
        ...models,
        gemini: {
          ...models.gemini,
          call: async () => {
            throw new Error("boom");
          },
        },
      };
      const id = await saved({ url: DRIVE });
      await videoReviewJob([id], ctx(), deps({ models: () => broken, media: () => store }));
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
