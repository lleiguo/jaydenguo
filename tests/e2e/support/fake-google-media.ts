import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";

// A sliver of Google Drive and the Google Photos Picker API for video
// reviews (plan M5.2), served by the fake Google (fake-oidc.ts) and by
// integration tests. Every video is the synthetic test-pattern clip.
// Drive file IDs: "missing…" is not found, "notvideo…" is a text file.
// A picker session is picked when its pickerUri is opened (as the owner
// would in Google Photos). Tests set `processing` (picks read as still
// processing) and `notReady` (downloads answered 404) to count down.

export const SAMPLE_VIDEO = "tests/fixtures/video/test-pattern-6s.mp4";

export function createGoogleMediaFake(isToken: (token: string) => boolean) {
  const picked = new Set<string>();
  const deleted = new Set<string>();
  let n = 0;

  const fake = {
    picked,
    deleted,
    processing: 0,
    notReady: 0,
    // Answers the request if it's one of ours; false otherwise.
    handle(req: IncomingMessage, res: ServerResponse, origin: string): boolean {
      const url = new URL(req.url ?? "/", origin);
      const send = (status: number, body: unknown, type = "application/json") => {
        res.writeHead(status, { "content-type": type });
        res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
      };
      const authorised = () => isToken((req.headers.authorization ?? "").replace(/^Bearer /, ""));
      const video = () => readFileSync(SAMPLE_VIDEO);

      // The owner "picks" in Google Photos.
      const pick = /^\/photos-picker\/([\w-]+)(\/autoclose)?$/.exec(url.pathname);
      if (pick) {
        picked.add(pick[1]);
        send(
          200,
          "<!doctype html><title>Google Photos</title><p>Picked. You can close this tab.</p>",
          "text/html",
        );
        return true;
      }

      const drive = /^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname);
      if (drive) {
        if (!authorised()) return (send(401, { error: { code: 401 } }), true);
        const id = decodeURIComponent(drive[1]);
        if (id.startsWith("missing")) return (send(404, { error: { code: 404 } }), true);
        if (url.searchParams.get("alt") === "media") return (send(200, video(), "video/mp4"), true);
        const isVideo = !id.startsWith("notvideo");
        send(200, {
          name: isVideo ? "forehand.mp4" : "notes.txt",
          mimeType: isVideo ? "video/mp4" : "text/plain",
          size: String(video().length),
        });
        return true;
      }

      if (url.pathname === "/v1/sessions" && req.method === "POST") {
        if (!authorised()) return (send(401, { error: { code: 401 } }), true);
        const id = `session-${++n}-${Date.now()}`;
        send(200, session(id, origin, false));
        return true;
      }
      const s = /^\/v1\/sessions\/([\w-]+)$/.exec(url.pathname);
      if (s) {
        if (!authorised()) return (send(401, { error: { code: 401 } }), true);
        if (req.method === "DELETE") {
          deleted.add(s[1]);
          send(200, {});
        } else send(200, session(s[1], origin, picked.has(s[1])));
        return true;
      }
      if (url.pathname === "/v1/mediaItems") {
        if (!authorised()) return (send(401, { error: { code: 401 } }), true);
        const id = url.searchParams.get("sessionId") ?? "";
        if (!picked.has(id))
          return (send(400, { error: { code: 400, status: "FAILED_PRECONDITION" } }), true);
        send(200, {
          mediaItems: [
            {
              id: `item-${id}`,
              type: "VIDEO",
              mediaFile: {
                baseUrl: `${origin}/photos-media/item-${id}`,
                mimeType: "video/mp4",
                filename: "serve.mp4",
                mediaFileMetadata: {
                  videoMetadata: { processingStatus: fake.processing-- > 0 ? "PROCESSING" : "READY" },
                },
              },
            },
          ],
        });
        return true;
      }
      if (/^\/photos-media\/[\w-]+=dv$/.test(url.pathname)) {
        if (!authorised()) return (send(401, { error: { code: 401 } }), true);
        if (fake.notReady-- > 0) return (send(404, "Not Found", "text/plain"), true);
        send(200, video(), "video/mp4");
        return true;
      }
      return false;
    },
  };
  return fake;
}

const session = (id: string, origin: string, set: boolean) => ({
  id,
  pickerUri: `${origin}/photos-picker/${id}`,
  pollingConfig: { pollInterval: "0.2s", timeoutIn: "600s" },
  mediaItemsSet: set,
  expireTime: new Date(Date.now() + 3600_000).toISOString(),
});
