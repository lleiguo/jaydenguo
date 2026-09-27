// A minimal OpenID Connect provider standing in for Google in end-to-end
// tests. Its "account chooser" lists test accounts as buttons, like Google's.
// It checks PKCE and signs ID tokens, so the app's real sign-in code runs.
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { SignJWT, exportJWK, generateKeyPair } from "jose";

import { FAKE_OIDC_PORT } from "./fake-oidc-port";
const issuer = `http://127.0.0.1:${FAKE_OIDC_PORT}`;
const accounts = [
  "owner@example.test",
  "intruder@example.test",
  // Data-source Google accounts, one per Playwright project.
  "calendar-desktop@example.test",
  "calendar-phone@example.test",
  "household-desktop@example.test",
  "household-phone@example.test",
];

type Pending = {
  email: string;
  clientId: string;
  nonce: string;
  challenge: string;
  redirectUri: string;
  offline: boolean;
  scope: string;
};

// Calendar data served to the adapters, dated relative to today so the
// calendar always has something upcoming. Names and places are made up.
const day = (offset: number, hour: number) => {
  const d = new Date();
  d.setUTCHours(hour, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offset);
  return d;
};
const icsTime = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");

function teamFeed(): string {
  const events = [
    ["practice-1", "Practice", day(1, 1), day(1, 2)],
    ["game-1", "Game vs Red Rockets", day(3, 18), day(3, 19)],
    ["game-2", "Game vs Green Giants", day(8, 18), day(8, 19)],
  ] as const;
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//test//EN",
    ...events.flatMap(([uid, title, start, end]) => [
      "BEGIN:VEVENT",
      `UID:${uid}@example.test`,
      `DTSTAMP:${icsTime(new Date())}`,
      `DTSTART:${icsTime(start)}`,
      `DTEND:${icsTime(end)}`,
      `SUMMARY:${title}`,
      "LOCATION:Maple Park Field 3",
      "END:VEVENT",
    ]),
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

const FEEDS: Record<string, () => string> = { "team.ics": teamFeed };

const CALENDARS = [
  { id: "primary-test@example.test", summary: "Personal", primary: true },
  { id: "family-test@group.calendar.example.test", summary: "Family" },
];

function familyEvents() {
  return [
    {
      id: "fam-1",
      summary: "Swim practice",
      start: { dateTime: day(2, 14).toISOString() },
      end: { dateTime: day(2, 15).toISOString() },
    },
    {
      id: "fam-2",
      summary: "Math class",
      start: { dateTime: day(4, 23).toISOString() },
      end: { dateTime: day(5, 0).toISOString() },
    },
    { id: "fam-3", status: "cancelled", start: { date: "2020-01-01" }, end: { date: "2020-01-02" } },
  ];
}

async function main() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "test", alg: "RS256", use: "sig" };
  const codes = new Map<string, Pending>();
  const refreshTokens = new Set<string>();
  const accessTokens = new Set<string>();
  const newAccessToken = () => {
    const t = randomUUID();
    accessTokens.add(t);
    return t;
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", issuer);
    const send = (status: number, body: unknown, type = "application/json") => {
      res.writeHead(status, { "content-type": type });
      res.end(typeof body === "string" ? body : JSON.stringify(body));
    };

    if (url.pathname === "/.well-known/openid-configuration") {
      return send(200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        revocation_endpoint: `${issuer}/revoke`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
      });
    }
    if (url.pathname === "/jwks") return send(200, { keys: [jwk] });

    if (url.pathname.startsWith("/ical/")) {
      const feed = FEEDS[url.pathname.slice("/ical/".length)];
      return feed ? send(200, feed(), "text/calendar") : send(404, "gone", "text/plain");
    }

    // A sliver of the Google Calendar API.
    if (url.pathname.startsWith("/calendar/v3/")) {
      const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
      if (!accessTokens.has(token)) return send(401, { error: "unauthenticated" });
      if (url.pathname === "/calendar/v3/users/me/calendarList") return send(200, { items: CALENDARS });
      const m = url.pathname.match(/^\/calendar\/v3\/calendars\/([^/]+)\/events$/);
      if (m && decodeURIComponent(m[1]) === CALENDARS[1].id) return send(200, { items: familyEvents() });
      return send(404, { error: "not found" });
    }

    const readForm = async () => {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      return new URLSearchParams(raw);
    };

    if (url.pathname === "/revoke" && req.method === "POST") {
      const token = (await readForm()).get("token") ?? "";
      return send(refreshTokens.delete(token) ? 200 : 400, {});
    }

    if (url.pathname === "/authorize") {
      const p = url.searchParams;
      if (p.get("code_challenge_method") !== "S256" || !p.get("code_challenge") || !p.get("nonce")) {
        return send(400, "PKCE and nonce are required", "text/plain");
      }
      const chosen = p.get("choose");
      if (!chosen) {
        const buttons = accounts
          .map((a) => {
            const next = new URL(url);
            next.searchParams.set("choose", a);
            return `<a href="${next.pathname}${next.search.replace(/&/g, "&amp;")}">${a}</a>`;
          })
          .join("<br>");
        return send(200, `<!doctype html><title>Choose an account</title>${buttons}`, "text/html");
      }
      const code = randomUUID();
      codes.set(code, {
        email: chosen,
        clientId: p.get("client_id")!,
        nonce: p.get("nonce")!,
        challenge: p.get("code_challenge")!,
        redirectUri: p.get("redirect_uri")!,
        offline: p.get("access_type") === "offline",
        scope: p.get("scope") ?? "",
      });
      const back = new URL(p.get("redirect_uri")!);
      back.searchParams.set("code", code);
      back.searchParams.set("state", p.get("state") ?? "");
      res.writeHead(303, { location: back.href });
      return res.end();
    }

    if (url.pathname === "/token" && req.method === "POST") {
      const form = await readForm();
      if (form.get("grant_type") === "refresh_token") {
        return refreshTokens.has(form.get("refresh_token") ?? "")
          ? send(200, { access_token: newAccessToken(), token_type: "Bearer", expires_in: 300 })
          : send(400, { error: "invalid_grant" });
      }
      const pending = codes.get(form.get("code") ?? "");
      codes.delete(form.get("code") ?? "");
      const verifier = form.get("code_verifier") ?? "";
      const challenge = createHash("sha256").update(verifier).digest("base64url");
      if (!pending || challenge !== pending.challenge || form.get("redirect_uri") !== pending.redirectUri) {
        return send(400, { error: "invalid_grant" });
      }
      const idToken = await new SignJWT({ email: pending.email, email_verified: true, nonce: pending.nonce })
        .setProtectedHeader({ alg: "RS256", kid: "test" })
        .setIssuer(issuer)
        .setAudience(pending.clientId)
        .setSubject(createHash("sha256").update(pending.email).digest("hex").slice(0, 20))
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(privateKey);
      const refreshToken = pending.offline ? `refresh-${randomUUID()}` : undefined;
      if (refreshToken) refreshTokens.add(refreshToken);
      return send(200, {
        access_token: newAccessToken(),
        token_type: "Bearer",
        expires_in: 300,
        id_token: idToken,
        refresh_token: refreshToken,
        scope: pending.scope,
      });
    }

    send(404, { error: "not found" });
  });
  server.listen(FAKE_OIDC_PORT, "127.0.0.1");
}

void main();
