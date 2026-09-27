// A minimal OpenID Connect provider standing in for Google in end-to-end
// tests. Its "account chooser" lists test accounts as buttons, like Google's.
// It checks PKCE and signs ID tokens, so the app's real sign-in code runs.
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { SignJWT, exportJWK, generateKeyPair } from "jose";

import { FAKE_OIDC_PORT } from "./fake-oidc-port";
const issuer = `http://127.0.0.1:${FAKE_OIDC_PORT}`;
const accounts = ["owner@example.test", "intruder@example.test"];

type Pending = { email: string; clientId: string; nonce: string; challenge: string; redirectUri: string };

async function main() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "test", alg: "RS256", use: "sig" };
  const codes = new Map<string, Pending>();

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
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
      });
    }
    if (url.pathname === "/jwks") return send(200, { keys: [jwk] });

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
      });
      const back = new URL(p.get("redirect_uri")!);
      back.searchParams.set("code", code);
      back.searchParams.set("state", p.get("state") ?? "");
      res.writeHead(303, { location: back.href });
      return res.end();
    }

    if (url.pathname === "/token" && req.method === "POST") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const form = new URLSearchParams(raw);
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
      return send(200, {
        access_token: randomUUID(),
        token_type: "Bearer",
        expires_in: 300,
        id_token: idToken,
      });
    }

    send(404, { error: "not found" });
  });
  server.listen(FAKE_OIDC_PORT, "127.0.0.1");
}

void main();
