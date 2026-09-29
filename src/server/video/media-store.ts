import { createReadStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import type { ByteRange } from "../../domain/byte-range";

// Where playback copies of reviewed clips live (intent 0003, PLAY-1, PLAY-2,
// PLAY-8): a private Cloud Storage bucket in production (MEDIA_BUCKET), a
// local folder in development and tests (MEDIA_DIR), or nowhere. The worker
// saves; the web service streams and deletes.

export type MediaStore = {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  // The object's size, or null if it isn't there.
  size(key: string): Promise<number | null>;
  read(key: string, range: ByteRange | null): Promise<ReadableStream<Uint8Array>>;
  delete(key: string): Promise<void>;
};

export const playbackKey = (reviewId: string) => `reviews/${reviewId}.mp4`;

// Keys are made by playbackKey, never taken from a request.
const KEY = /^reviews\/[0-9a-f-]{36}\.mp4$/;
function checked(key: string) {
  if (!KEY.test(key)) throw new Error("bad media key");
  return key;
}

export function localMediaStore(dir: string): MediaStore {
  const path = (key: string) => join(dir, checked(key));
  return {
    async put(key, data) {
      await mkdir(dirname(path(key)), { recursive: true });
      await writeFile(path(key), data);
    },
    async size(key) {
      const file = path(key);
      try {
        return (await stat(file)).size;
      } catch {
        return null;
      }
    },
    async read(key, range) {
      const stream = createReadStream(path(key), range ? { start: range.start, end: range.end } : {});
      return Readable.toWeb(stream) as ReadableStream<Uint8Array>;
    },
    async delete(key) {
      await rm(path(key), { force: true });
    },
  };
}

type TokenSource = () => Promise<string>;

async function serviceToken(): Promise<string> {
  const { GoogleAuth } = await import("google-auth-library");
  const client = await new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/devstorage.read_write"],
  }).getClient();
  const { token } = await client.getAccessToken();
  if (!token) throw new Error("no access token for Cloud Storage");
  return token;
}

// The Cloud Storage JSON API with the service's own identity.
export function gcsMediaStore(bucket: string, token: TokenSource = serviceToken): MediaStore {
  const api = "https://storage.googleapis.com";
  const object = (key: string) =>
    `${api}/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(checked(key))}`;
  const auth = async (extra: Record<string, string> = {}) => ({
    authorization: `Bearer ${await token()}`,
    ...extra,
  });
  return {
    async put(key, data, contentType) {
      const url = new URL(`${api}/upload/storage/v1/b/${encodeURIComponent(bucket)}/o`);
      url.searchParams.set("uploadType", "media");
      url.searchParams.set("name", checked(key));
      const res = await fetch(url, {
        method: "POST",
        headers: await auth({ "content-type": contentType }),
        body: new Uint8Array(data),
      });
      if (!res.ok) throw new Error(`Cloud Storage upload failed (${res.status})`);
    },
    async size(key) {
      const res = await fetch(object(key), { headers: await auth() });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`Cloud Storage lookup failed (${res.status})`);
      return Number(((await res.json()) as { size: string }).size);
    },
    async read(key, range) {
      const headers = await auth(range ? { range: `bytes=${range.start}-${range.end}` } : {});
      const res = await fetch(`${object(key)}?alt=media`, { headers });
      if (!res.ok || !res.body) throw new Error(`Cloud Storage read failed (${res.status})`);
      return res.body;
    },
    async delete(key) {
      const res = await fetch(object(key), { method: "DELETE", headers: await auth() });
      if (!res.ok && res.status !== 404) throw new Error(`Cloud Storage delete failed (${res.status})`);
    },
  };
}

export function mediaStore(): MediaStore | null {
  if (process.env.MEDIA_BUCKET) return gcsMediaStore(process.env.MEDIA_BUCKET);
  if (process.env.MEDIA_DIR) return localMediaStore(process.env.MEDIA_DIR);
  return null;
}
