// Runtime settings for the web app, read from the environment. Production
// values come from Cloud Run (infra/cloud_run.tf) and Secret Manager.

const isProduction = process.env.NODE_ENV === "production";

// The site's public origin. Behind Firebase Hosting, Cloud Run sees its own
// host name, so redirects and the OAuth redirect URI must not be built from
// the request.
export function appUrl(): URL {
  return new URL(process.env.APP_URL ?? "http://localhost:3000");
}

// Spec AUTH-1: the owner's Google account only.
const OWNER_EMAIL = "lleiguo@gmail.com";

export function allowedEmails(): string[] {
  const raw = process.env.ALLOWED_EMAILS ?? OWNER_EMAIL;
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

// Key for hashing session tokens before they are stored.
export function authSecret(): string {
  const secret = process.env.AUTH_SECRET?.trim();
  if (secret) return secret;
  if (isProduction) throw new Error("AUTH_SECRET must be set");
  return "dev-only-auth-secret-not-for-production";
}

export type OidcSettings = { issuer: URL; clientId: string; clientSecret: string };

export function oidcSettings(): OidcSettings {
  // Trimmed: a value pasted into Secret Manager can carry a stray newline.
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set");
  // OIDC_ISSUER exists so end-to-end tests can sign in against a fake
  // provider on localhost; see isLocalIssuer.
  return {
    issuer: new URL(process.env.OIDC_ISSUER ?? "https://accounts.google.com"),
    clientId,
    clientSecret,
  };
}

// Plain-HTTP issuers are only accepted on the loopback interface.
export function isLocalIssuer(issuer: URL): boolean {
  return issuer.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(issuer.hostname);
}
