// Connected accounts and stored credentials (plan M1.2-M1.3, spec CRED-1..7,
// §7.3). Secrets are only ever stored sealed: `ciphertext` is AES-256-GCM
// under a per-row data key, and `wrapped_dek` is that key wrapped by Cloud
// KMS. The web service can write these rows but can't decrypt them.
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });

export const credentials = pgTable(
  "credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // oauth: a Google refresh token; password: a site login;
    // secret_url: a private calendar feed link (anyone with it can read it).
    kind: text("kind").notNull(),
    // Which service it signs in to, e.g. google, teamsnap, spordle, veracross.
    provider: text("provider").notNull(),
    label: text("label").notNull(),
    // Not secret, shown in the UI: a login name or the Google account email.
    username: text("username"),
    // Google scopes granted so far (scopes are requested only when needed).
    scopes: text("scopes").array(),
    // Non-secret facts about the account, e.g. its Google calendars (id and
    // name), so the web app can offer them without the token.
    meta: jsonb("meta").notNull().default({}),
    ciphertext: bytea("ciphertext").notNull(),
    wrappedDek: bytea("wrapped_dek").notNull(),
    keyVersion: text("key_version").notNull(),
    // active, or removing while the worker revokes an OAuth grant.
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    lastTestAt: timestamp("last_test_at", { withTimezone: true }),
    lastTestOk: boolean("last_test_ok"),
    // Plain language, never contains the secret (CRED-5).
    lastError: text("last_error"),
  },
  (t) => [
    index("credentials_provider_idx").on(t.provider),
    check("credentials_kind_chk", sql`${t.kind} in ('oauth', 'password', 'secret_url')`),
    check("credentials_status_chk", sql`${t.status} in ('active', 'removing')`),
  ],
);

// Sealed extras for a password credential whose site asks for a sign-in
// code (Veracross, plan M4.2): `browser` is the headless browser's saved
// cookies (with the site's "remember this device" mark), written by the
// worker; `code` is a code the owner typed on the Accounts page, written
// (sealed) by the web app and deleted by the worker once used. Same envelope
// as `credentials`; never returned by the API.
export const credentialSessions = pgTable(
  "credential_sessions",
  {
    credentialId: uuid("credential_id")
      .notNull()
      .references(() => credentials.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    ciphertext: bytea("ciphertext").notNull(),
    wrappedDek: bytea("wrapped_dek").notNull(),
    keyVersion: text("key_version").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.credentialId, t.kind] }),
    check("credential_sessions_kind_chk", sql`${t.kind} in ('browser', 'code')`),
  ],
);

// Pending "connect a Google account" requests: state, nonce and PKCE
// verifier, bound to the session that started them.
export const oauthRequests = pgTable("oauth_requests", {
  id: text("id").primaryKey(), // HMAC of the `state` parameter
  sessionId: text("session_id").notNull(),
  nonce: text("nonce").notNull(),
  codeVerifier: text("code_verifier").notNull(),
  scopes: text("scopes").array().notNull(),
  returnTo: text("return_to").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
