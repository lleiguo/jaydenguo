import type { IncomingMessage, ServerResponse } from "node:http";

// A sliver of the Gmail API (plan M5.8) with made-up messages, served by the
// fake Google (fake-oidc.ts) and integration tests. It ignores the search
// query and lists every message, so the adapter's own allow-list check is
// tested too: the newsletter isn't from an allowed sender or label. The
// sender check (one result per search) does read the from: and label:
// terms, so a misspelt sender finds nothing.

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const headers = (from: string, subject: string) => [
  { name: "From", value: from },
  { name: "Subject", value: subject },
  { name: "Date", value: "Mon, 13 Dec 2027 09:00:00 -0500" },
];

export const GMAIL_MESSAGES = [
  {
    id: "msg-practice",
    threadId: "t-1",
    labelIds: ["INBOX"],
    internalDate: String(Date.parse("2027-12-13T14:00:00Z")),
    payload: {
      mimeType: "multipart/alternative",
      headers: headers("Coach Sam <coach@club.example>", "Extra practice"),
      parts: [
        {
          mimeType: "text/plain",
          body: { data: b64("Hi all,\n\nExtra practice on 2028-06-14 at 18:30 at the east field.\n\nSam") },
        },
        { mimeType: "text/html", body: { data: b64("<p>Hi all, extra practice…</p>") } },
      ],
    },
  },
  {
    id: "msg-labelled",
    threadId: "t-2",
    labelIds: ["INBOX", "Label_7"],
    internalDate: String(Date.parse("2027-12-13T15:00:00Z")),
    payload: {
      mimeType: "text/html",
      headers: headers("Parent Rep <rep@parents.example>", "Holiday party"),
      body: {
        data: b64(
          "<div>The holiday party is on 2028-06-15.</div><div>On Mon, Dec 13 someone wrote:</div><blockquote>old</blockquote>",
        ),
      },
    },
  },
  {
    id: "msg-newsletter",
    threadId: "t-3",
    labelIds: ["INBOX"],
    internalDate: String(Date.parse("2027-12-13T16:00:00Z")),
    payload: {
      mimeType: "text/plain",
      headers: headers("Shop <news@shop.example>", "Sale"),
      body: { data: b64("Big sale on 2028-06-16!") },
    },
  },
];

export const GMAIL_LABELS = [
  { id: "INBOX", name: "INBOX" },
  { id: "Label_7", name: "Jayden" },
];

// The messages a sender check's search finds: `{from:x label:y} newer_than:30d`.
function checked(q: string) {
  const from = [...q.matchAll(/from:"?([^\s"}]+)/g)].map((m) => m[1].toLowerCase());
  const labels = [...q.matchAll(/label:"?([^\s"}]+)/g)].map((m) => m[1].toLowerCase());
  const labelIds = GMAIL_LABELS.filter((l) => labels.includes(l.name.toLowerCase())).map((l) => l.id);
  return GMAIL_MESSAGES.filter((m) => {
    const sender = m.payload.headers.find((h) => h.name === "From")?.value.toLowerCase() ?? "";
    return from.some((f) => sender.includes(f)) || m.labelIds.some((id) => labelIds.includes(id));
  }).map((m) => ({ id: m.id, threadId: m.threadId }));
}

export function createGmailFake(isToken: (token: string) => boolean) {
  const requests: string[] = [];
  return {
    requests,
    handle(req: IncomingMessage, res: ServerResponse, origin: string): boolean {
      const url = new URL(req.url ?? "/", origin);
      if (!url.pathname.startsWith("/gmail/v1/users/me/")) return false;
      requests.push(`${url.pathname}${url.search}`);
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (!isToken((req.headers.authorization ?? "").replace(/^Bearer /, ""))) {
        send(401, { error: { code: 401 } });
        return true;
      }
      const rest = url.pathname.slice("/gmail/v1/users/me/".length);
      if (rest === "labels") send(200, { labels: GMAIL_LABELS });
      else if (rest === "messages" && url.searchParams.get("maxResults") === "1")
        send(200, { messages: checked(url.searchParams.get("q") ?? "").slice(0, 1) });
      else if (rest === "messages")
        send(200, { messages: GMAIL_MESSAGES.map((m) => ({ id: m.id, threadId: m.threadId })) });
      else {
        const m = GMAIL_MESSAGES.find((x) => `messages/${x.id}` === rest);
        if (m) send(200, m);
        else send(404, { error: { code: 404 } });
      }
      return true;
    },
  };
}
