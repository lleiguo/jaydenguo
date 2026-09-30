import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import { connect, type ClientHttp2Session } from "node:http2";
import type { ApnsEnvironment } from "../../domain/notifications";
import { registerSecret, type Logger } from "../log";

// Sending to Apple (intent 0004, PUSH-6, plan N7.2): token-based APNs, a
// JWT signed with the `.p8` key, over HTTP/2 with Node's own client. No
// SDK. Without the key (local development, CI) pushes are only logged.

export type PushTarget = { token: string; environment: ApnsEnvironment; topic: string };
// invalid: Apple says the token is dead; the caller drops the device.
export type PushResult = "sent" | "invalid" | "failed";

export interface PushSender {
  send(to: PushTarget, payload: Record<string, unknown>): Promise<PushResult>;
}

export type ApnsConfig = {
  key: string;
  keyId: string;
  teamId: string;
  // For tests: one base URL for both environments (a fake APNs over h2c).
  baseUrl?: string;
  log?: Logger;
  now?: () => number;
};

const HOST: Record<ApnsEnvironment, string> = {
  production: "https://api.push.apple.com",
  sandbox: "https://api.sandbox.push.apple.com",
};

// Apple wants a fresh token at least hourly and no more than every 20 minutes.
const JWT_LIFETIME_MS = 50 * 60_000;

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function apnsJwt(key: KeyObject, keyId: string, teamId: string, nowMs: number): string {
  const head = b64url(JSON.stringify({ alg: "ES256", kid: keyId }));
  const claims = b64url(JSON.stringify({ iss: teamId, iat: Math.floor(nowMs / 1000) }));
  const signature = sign("sha256", Buffer.from(`${head}.${claims}`), { key, dsaEncoding: "ieee-p1363" });
  return `${head}.${claims}.${b64url(signature)}`;
}

export function apnsSender(cfg: ApnsConfig): PushSender {
  const key = createPrivateKey(cfg.key);
  const now = cfg.now ?? Date.now;
  let jwt: { value: string; at: number } | null = null;
  const bearer = () => {
    if (!jwt || now() - jwt.at > JWT_LIFETIME_MS) {
      jwt = { value: apnsJwt(key, cfg.keyId, cfg.teamId, now()), at: now() };
      registerSecret(jwt.value);
    }
    return jwt.value;
  };

  // One connection per environment, kept while in use. It only holds the
  // process open while a request is in flight, so a job can exit.
  const sessions = new Map<string, { session: ClientHttp2Session; inFlight: number }>();
  const open = (base: string) => {
    const known = sessions.get(base);
    if (known && !known.session.closed && !known.session.destroyed) return known;
    const session = connect(base);
    session.on("error", () => sessions.delete(base));
    session.on("close", () => sessions.delete(base));
    session.setTimeout(5 * 60_000, () => session.close());
    const entry = { session, inFlight: 0 };
    sessions.set(base, entry);
    return entry;
  };

  return {
    async send(to, payload) {
      const base = cfg.baseUrl ?? HOST[to.environment];
      const conn = open(base);
      conn.inFlight++;
      conn.session.ref();
      try {
        const { status, body } = await new Promise<{ status: number; body: string }>((resolve, reject) => {
          const req = conn.session.request({
            ":method": "POST",
            ":path": `/3/device/${to.token}`,
            authorization: `bearer ${bearer()}`,
            "apns-topic": to.topic,
            "apns-push-type": "alert",
            "apns-priority": "10",
            // Worth delivering for a day; after that it's old news.
            "apns-expiration": String(Math.floor(now() / 1000) + 86_400),
            "content-type": "application/json",
          });
          let status = 0;
          let body = "";
          req.setEncoding("utf8");
          req.on("response", (h) => (status = Number(h[":status"])));
          req.on("data", (chunk: string) => (body += chunk));
          req.on("end", () => resolve({ status, body }));
          req.on("error", reject);
          req.setTimeout(15_000, () => req.close());
          req.end(JSON.stringify(payload));
        });
        if (status === 200) return "sent";
        const reason = safeReason(body);
        if (status === 410 || reason === "BadDeviceToken" || reason === "DeviceTokenNotForTopic")
          return "invalid";
        cfg.log?.("push refused", { status, reason }, "WARNING");
        return "failed";
      } catch (err) {
        cfg.log?.("push failed", { error: err }, "WARNING");
        return "failed";
      } finally {
        conn.inFlight--;
        if (conn.inFlight === 0 && !conn.session.destroyed) conn.session.unref();
      }
    },
  };
}

function safeReason(body: string): string | null {
  try {
    return (JSON.parse(body) as { reason?: string }).reason ?? null;
  } catch {
    return null;
  }
}

// No key: say what would have been sent (never the text: there is none here).
export function logSender(log: Logger): PushSender {
  return {
    async send(to, payload) {
      log("push not sent (no APNs key)", { environment: to.environment, kind: payload.kind, id: payload.id });
      return "sent";
    },
  };
}

let cached: PushSender | null = null;

// APNS_KEY (the .p8, from Secret Manager), APNS_KEY_ID and APNS_TEAM_ID.
export function defaultSender(log: Logger): PushSender {
  if (cached) return cached;
  const { APNS_KEY, APNS_KEY_ID, APNS_TEAM_ID, APNS_BASE_URL } = process.env;
  if (!APNS_KEY || !APNS_KEY_ID || !APNS_TEAM_ID) return logSender(log);
  registerSecret(APNS_KEY);
  cached = apnsSender({
    key: APNS_KEY,
    keyId: APNS_KEY_ID,
    teamId: APNS_TEAM_ID,
    baseUrl: APNS_BASE_URL,
    log,
  });
  return cached;
}
