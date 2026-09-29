// Sign-in state (plan M1.1, spec AUTH-1..4, F-14 option A).
import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./core";

// One row per `__session` cookie. The cookie holds a random token; the row id
// is an HMAC of it, so a database copy can't be replayed as a cookie.
// A row with no user is a pre-login session: it carries the OpenID Connect
// state, nonce and PKCE verifier between the redirect to Google and the
// callback, and is deleted when the callback uses it.
//
// `kind` (intent 0004, API-2): `browser` rows are cookies; `device` rows are
// the iPhone app's bearer tokens, which stay valid 30 days after last use;
// `handoff` rows are short web sessions the app opens for Google connect
// (API-5).
export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: uuid("user_id").references(() => users.id),
    loginState: jsonb("login_state").$type<LoginState>(),
    userAgent: text("user_agent"),
    kind: text("kind").notNull().default("browser"),
    // The phone's name, for the Sessions list (device rows only).
    deviceName: text("device_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    index("sessions_user_idx").on(t.userId),
    check("sessions_kind_chk", sql`(${t.userId} is null) <> (${t.loginState} is null)`),
    check("sessions_session_kind_chk", sql`${t.kind} in ('browser', 'device', 'handoff')`),
  ],
);

export type LoginState = {
  state: string;
  nonce: string;
  codeVerifier: string;
  returnTo: string;
  // Sign-in from the iPhone app (API-1): the app's PKCE challenge (S256) and
  // the phone's name.
  app?: { challenge: string; deviceName: string | null };
};

// Single-use codes (API-1, API-5), keyed by an HMAC of the code like
// sessions. `device`: the app swaps it, with its PKCE verifier, for a device
// token. `handoff`: the app opens it in a browser sheet to get a short web
// session for a flow that needs one (Google connect).
export const authCodes = pgTable(
  "auth_codes",
  {
    id: text("id").primaryKey(),
    purpose: text("purpose").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    challenge: text("challenge"),
    deviceName: text("device_name"),
    returnTo: text("return_to"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    index("auth_codes_expires_idx").on(t.expiresAt),
    check("auth_codes_purpose_chk", sql`${t.purpose} in ('device', 'handoff')`),
    check(
      "auth_codes_fields_chk",
      sql`(${t.purpose} = 'device' and ${t.challenge} is not null) or (${t.purpose} = 'handoff' and ${t.returnTo} is not null)`,
    ),
  ],
);

// Fixed-window counters for login rate limiting (NFR-2).
export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);
