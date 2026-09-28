import { z } from "zod";
import { parseRange } from "@/domain/byte-range";
import { api, HttpError } from "@/server/http";
import { mediaStore } from "@/server/video/media-store";
import { deletePlayback, playbackOf } from "@/server/video/store";

// The review's playback copy (intent 0003, PLAY-2, PLAY-3): streamed to the
// signed-in owner only, with range requests so the player can seek.
export const GET = api<{ id: string }>(async ({ db, params, request }) => {
  const key = await playbackOf(db, z.uuid().parse(params.id));
  const store = mediaStore();
  const size = key && store ? await store.size(key) : null;
  if (!key || !store || size === null) throw new HttpError(404, "not found");

  const headers = new Headers({
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
  });
  const range = parseRange(request.headers.get("range"), size);
  if (range === "unsatisfiable") {
    headers.set("Content-Range", `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }
  headers.set("Content-Length", String(range ? range.end - range.start + 1 : size));
  if (range) headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
  return new Response(await store.read(key, range), { status: range ? 206 : 200, headers });
});

// PLAY-7: delete the copy for good, keep the review.
export const DELETE = api<{ id: string }>(async ({ db, params }) => {
  const store = mediaStore();
  if (!store) throw new HttpError(404, "not found");
  await deletePlayback(db, store, z.uuid().parse(params.id));
  return new Response(null, { status: 204 });
});
