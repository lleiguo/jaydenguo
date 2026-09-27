import * as client from "openid-client";
import { isLocalIssuer, oidcSettings, type OidcSettings } from "../config";

// Google sign-in with OpenID Connect: authorization code flow with PKCE,
// state and nonce (plan M1.1, F-14 option A). The state, nonce and PKCE
// verifier stay server-side in the pre-login session row.

let cached: { key: string; config: Promise<client.Configuration> } | undefined;

function configFor(settings: OidcSettings): Promise<client.Configuration> {
  const key = `${settings.issuer.href}|${settings.clientId}`;
  if (cached?.key !== key) {
    const config = client
      .discovery(
        settings.issuer,
        settings.clientId,
        undefined,
        client.ClientSecretPost(settings.clientSecret),
        isLocalIssuer(settings.issuer) ? { execute: [client.allowInsecureRequests] } : undefined,
      )
      .catch((err: unknown) => {
        cached = undefined;
        throw err;
      });
    cached = { key, config };
  }
  return cached.config;
}

export type AuthorizationRequest = {
  url: URL;
  state: string;
  nonce: string;
  codeVerifier: string;
};

export async function buildAuthorizationRequest(redirectUri: string): Promise<AuthorizationRequest> {
  const config = await configFor(oidcSettings());
  const codeVerifier = client.randomPKCECodeVerifier();
  const state = client.randomState();
  const nonce = client.randomNonce();
  const url = client.buildAuthorizationUrl(config, {
    redirect_uri: redirectUri,
    scope: "openid email",
    code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
    code_challenge_method: "S256",
    state,
    nonce,
    prompt: "select_account",
  });
  return { url, state, nonce, codeVerifier };
}

export type VerifiedIdentity = { email: string };

// Exchanges the code and checks the ID token (signature, issuer, audience,
// expiry, nonce). Only a verified Google email counts.
export async function completeAuthorization(
  callbackUrl: URL,
  expected: { state: string; nonce: string; codeVerifier: string },
): Promise<VerifiedIdentity> {
  const config = await configFor(oidcSettings());
  const tokens = await client.authorizationCodeGrant(config, callbackUrl, {
    pkceCodeVerifier: expected.codeVerifier,
    expectedState: expected.state,
    expectedNonce: expected.nonce,
    idTokenExpected: true,
  });
  const claims = tokens.claims();
  if (!claims || typeof claims.email !== "string" || claims.email_verified !== true) {
    throw new Error("ID token has no verified email");
  }
  return { email: claims.email };
}
